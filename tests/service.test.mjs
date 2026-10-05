import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fixture, repository, commit, git } from './integration/service.mjs';

test('installed service and CLI share durable jobs, paused queues, events and immutable request identity', async () => {
  const f = await fixture();
  try {
    const repo = repository(f.root); writeFileSync(join(repo, 'unrelated.txt'), 'leave untouched'); git(repo, 'add', 'unrelated.txt');
    const before = git(repo, 'ls-files', '--stage');
    const added = await f.call('repos.add', { path: repo }); const id = added.result.repository.id;
    assert.equal(git(repo, 'ls-files', '--stage'), before); assert.equal(existsSync(join(repo, 'contribution.json')), false);
    await f.call('service.pause');
    const requestId = randomUUID(), first = await f.call('repos.initialize', { repo: id, requestId });
    const duplicate = await f.call('repos.initialize', { repo: id, requestId }); assert.equal(first.operationId, duplicate.operationId);
    await f.stop(); await f.start();
    assert.equal((await f.call('runs.get', { operationId: first.operationId })).operationState, 'queued');
    await f.call('service.resume'); const finished = await f.wait(first.operationId); assert.equal(finished.operationState, 'succeeded', JSON.stringify(finished));
    assert.equal(readFileSync(join(repo, 'unrelated.txt'), 'utf8'), 'leave untouched');
    assert.match(git(repo, 'ls-files', '--stage'), /unrelated.txt/); assert.doesNotMatch(git(repo, 'ls-tree', '-r', 'HEAD'), /unrelated/);
    const events = await f.call('runs.events', { operationId: first.operationId }); assert.ok(events.result.events.length >= 3);
    assert.equal(new Set(events.result.events.map(event => event.sequence)).size, events.result.events.length);
    const cli = f.cli(['runs', 'get', first.operationId]); assert.equal(cli.status, 0, cli.stderr); assert.equal(JSON.parse(cli.stdout).operationId, first.operationId);
    assert.equal((await f.call('repos.initialize', { repo: id, requestId })).operationId, first.operationId);
  } finally { await f.cleanup(); }
});

test('detached committed task lands once while staged, unstaged, untracked and ignored source bytes survive', async () => {
  const f = await fixture();
  try {
    const repo = repository(f.root); const base = commit(repo); const task = join(f.root, 'detached'); git(repo, 'worktree', 'add', '--detach', task, base);
    const tip = commit(task, 'task.txt', 'completed task'); writeFileSync(join(task, 'base.txt'), 'unrelated edit');
    writeFileSync(join(task, 'staged.txt'), 'staged'); git(task, 'add', 'staged.txt'); writeFileSync(join(task, 'untracked.txt'), 'untracked');
    writeFileSync(join(task, '.gitignore'), 'ignored.txt\n'); writeFileSync(join(task, 'ignored.txt'), 'ignored');
    const before = git(task, 'status', '--porcelain=v1', '--ignored'), index = git(task, 'ls-files', '--stage');
    const id = (await f.call('repos.add', { path: repo })).result.repository.id;
    const input = { repo: id, requestId: randomUUID(), sourcePath: task, sourceTip: tip, base, metadata: { schemaVersion: 1 } };
    const accepted = await f.call('submit', input); const done = await f.wait(accepted.operationId);
    assert.equal(done.operationState, 'succeeded', JSON.stringify(done)); assert.equal(done.result.sourceTip, tip);
    assert.equal(readFileSync(join(repo, 'task.txt'), 'utf8'), 'completed task');
    assert.equal(git(task, 'status', '--porcelain=v1', '--ignored'), before); assert.equal(git(task, 'ls-files', '--stage'), index);
    assert.equal((await f.call('submit', input)).operationId, accepted.operationId);
    assert.equal((await f.call('submit', { ...input, metadata: { schemaVersion: 1, integrationMessage: 'changed' } })).error.code, 'REQUEST_ID_CONFLICT');
    assert.equal(readFileSync(join(task, 'ignored.txt'), 'utf8'), 'ignored');
  } finally { await f.cleanup(); }
});

test('managed push executes a real gate once, confirms delivery and preserves inactive/no-op distinctions', async () => {
  const f = await fixture();
  try {
    const repo = repository(f.root); commit(repo); const remote = join(f.root, 'remote.git'); mkdirSync(remote); git(remote, 'init', '--bare'); git(repo, 'remote', 'add', 'origin', remote);
    const added = (await f.call('repos.add', { path: repo })).result.repository, count = join(f.root, 'count');
    const config = structuredClone(added.config); config.publication.remote = 'origin'; config.publication.branch = 'dev';
    config.validation.gate = 'enabled'; config.validation.checks = [{ id: 'fixture', profiles: ['local-development'], argv: ['/bin/sh', '-c', `echo gate >> '${count}'`], cwd: '.', timeoutSeconds: 10, reuse: 'never' }];
    assert.equal((await f.call('repos.configure', { repo: added.id, config, expectedRevision: added.revision, requestId: randomUUID() })).error, null);
    const preview = await f.call('push', { repo: added.id, preview: true }); assert.equal(existsSync(count), false);
    const accepted = await f.call('push', { repo: added.id, expectedTip: preview.result.expectedTip, scopeToken: preview.result.scopeToken, requestId: randomUUID() });
    const done = await f.wait(accepted.operationId); assert.equal(done.operationState, 'succeeded', JSON.stringify(done));
    assert.equal(done.result.delivery, 'delivered'); assert.equal(done.result.gate.state, 'passed'); assert.equal(readFileSync(count, 'utf8').trim(), 'gate');
    const check = done.result.gate.checks[0];
    assert.deepEqual(check.argv, config.validation.checks[0].argv); assert.equal(check.profile, 'local-development');
    assert.ok(Number.isSafeInteger(check.durationMilliseconds) && check.durationMilliseconds >= 0);
    assert.ok(Date.parse(check.completedAt) >= Date.parse(check.startedAt)); assert.equal(check.reuse, 'never'); assert.equal(check.logMarker, '[fixture] started');
    const next = await f.call('push', { repo: added.id, preview: true });
    const noop = await f.call('push', { repo: added.id, expectedTip: next.result.expectedTip, scopeToken: next.result.scopeToken, requestId: randomUUID() });
    const noopResult = await f.wait(noop.operationId); assert.equal(noopResult.result.delivery, 'up_to_date'); assert.equal(noopResult.result.gate.state, 'not_run');
    assert.equal(readFileSync(count, 'utf8').trim(), 'gate');
  } finally { await f.cleanup(); }
});
