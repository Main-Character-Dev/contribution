import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync, writeFileSync, readFileSync, existsSync, mkdirSync, renameSync, symlinkSync, linkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Journal } from '../packages/engine/dist/journal.js';
import { Repositories } from '../packages/engine/dist/repositories.js';
import { RepositoryRemoval } from '../packages/engine/dist/repository-removal.js';
import { Engine } from '../packages/engine/dist/service.js';
import { Lease } from '../packages/engine/dist/process.js';
import { git, repository, commit } from './integration/service.mjs';

async function fixture(hook = true) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ct-unenroll-'))), path = repository(root);
  commit(path); const store = new Journal(join(root, 'state')), engine = new Engine(store, { identity: 'fixture', node: process.execPath, cli: '/fixture/cli' });
  const repo = await engine.repos.add(path);
  if (hook) await engine.workflows.ensureHook(repo);
  return { root, store, engine, repo, hook: join(repo.commonDir, 'hooks/pre-push'), removal: new RepositoryRemoval(store, engine.repos),
    call: (command, args = { repo: repo.id }) => engine.dispatch({ schemaVersion: 1, command, args, cwd: path }),
    close: () => { store.close(); rmSync(root, { recursive: true }); } };
}

test('unenrollment removes only the exact owned hook while preserving dirty source, history, native tasks and records', async () => {
  const f = await fixture(); try {
    const task = join(f.root, 'task'); git(f.repo.path, 'worktree', 'add', '--detach', task, 'HEAD'); commit(task, 'task.txt');
    writeFileSync(join(f.repo.path, 'base.txt'), 'user edit'); writeFileSync(join(f.repo.path, 'staged.txt'), 'staged'); git(f.repo.path, 'add', 'staged.txt');
    writeFileSync(join(f.repo.path, 'contribution.json'), JSON.stringify(f.repo.config));
    const status = git(f.repo.path, 'status', '--porcelain=v1'), index = git(f.repo.path, 'ls-files', '--stage'), tip = git(f.repo.path, 'rev-parse', 'HEAD');
    const op = f.store.admit(randomUUID(), 'checks', f.repo.id, {}, 'fixture'); f.store.update(op, { state: 'failed', pinned: true }); f.store.log(op, 'retained evidence');
    const done = await f.call('repos.remove'); assert.equal(done.error, null, JSON.stringify(done)); assert.equal(done.result.ownedHookRemoved, true);
    assert(!existsSync(f.hook)); assert.equal(f.engine.repos.all().length, 0); assert.equal(git(f.repo.path, 'status', '--porcelain=v1'), status);
    assert.equal(git(f.repo.path, 'ls-files', '--stage'), index); assert.equal(git(f.repo.path, 'rev-parse', 'HEAD'), tip); assert(existsSync(join(task, 'task.txt')));
    assert.equal(f.store.logs(op), 'retained evidence'); assert.equal((await f.call('runs.get', { operationId: op.operationId })).operationState, 'failed');
    assert.deepEqual((await f.call('repos.remove')).result, done.result); assert.deepEqual((await f.call('repos.remove', { repo: f.repo.path })).result, done.result);
    assert.throws(() => f.store.admit(randomUUID(), 'checks', f.repo.id, {}, 'fixture'), { code: 'REPOSITORY_NOT_ENROLLED' });
    assert.throws(() => f.engine.repos.save(f.repo), { code: 'REPOSITORY_NOT_ENROLLED' });
    const reenrolled = await f.engine.repos.add(f.repo.path); assert.equal(reenrolled.id, f.repo.id);
    const again = await f.call('repos.remove'); assert.equal(again.error, null); assert.notEqual(again.result.removalId, done.result.removalId);
  } finally { f.close(); }
});

test('foreign hooks remain byte-for-byte untouched and an unborn repository can leave enrollment', async () => {
  const f = await fixture(false); try {
    writeFileSync(f.hook, '#!/bin/sh\n# foreign policy\nexit 7\n', { mode: 0o755 }); const before = readFileSync(f.hook);
    assert.equal((await f.call('repos.remove')).error, null); assert.deepEqual(readFileSync(f.hook), before);
    const unborn = repository(f.root, 'unborn'), repo = await f.engine.repos.add(unborn);
    assert.equal((await f.call('repos.remove', { repo: repo.id })).error, null); assert.equal(git(unborn, 'symbolic-ref', 'HEAD'), 'refs/heads/dev');
  } finally { f.close(); }
});

test('changed hook content, routing, shared files and replaced paths are preserved', async () => {
  for (const change of ['content', 'link', 'shared', 'routing', 'directory']) {
    const f = await fixture(); try {
      if (change === 'content') writeFileSync(f.hook, 'user replacement');
      if (change === 'link') { renameSync(f.hook, `${f.hook}.original`); symlinkSync(`${f.hook}.original`, f.hook); }
      if (change === 'shared') linkSync(f.hook, `${f.hook}.shared`);
      if (change === 'routing') git(f.repo.path, 'config', 'core.hooksPath', 'user-hooks');
      if (change === 'directory') { renameSync(join(f.repo.commonDir, 'hooks'), join(f.repo.commonDir, 'hooks-original')); symlinkSync('hooks-original', join(f.repo.commonDir, 'hooks')); }
      const before = readFileSync(f.hook); const result = await f.call('repos.remove'); assert(result.error, change);
      assert.equal(f.engine.repos.all().length, 1, change); assert.deepEqual(readFileSync(f.hook), before, change);
    } finally { f.close(); }
  }
});

test('queued, interrupted, uncertain, live, adopted and paired states refuse unenrollment', async () => {
  for (const state of ['queued', 'interrupted', 'outcome_unknown', 'live', 'adopted', 'authority', 'mirror', 'legacy', 'writer']) {
    const f = await fixture(); let lease; try {
      if (['queued', 'interrupted', 'outcome_unknown', 'live'].includes(state)) {
        const op = f.store.admit(randomUUID(), 'checks', f.repo.id, {}, 'fixture');
        f.store.update(op, { state: state === 'live' ? 'succeeded' : state, result: state === 'live' ? { processes: [{ pid: process.pid, start: null }] } : {} });
      }
      if (state === 'adopted') f.store.put('adoptedHooks', f.repo.id, { fixture: true });
      if (state === 'authority') f.store.put('authority', f.repo.id, { phase: 'active' });
      if (state === 'mirror') f.engine.repos.save({ ...f.repo, canonicalHostId: randomUUID(), availability: 'both-macs' });
      if (state === 'legacy') mkdirSync(join(f.repo.commonDir, 'primary-checkout-mutation.lock'));
      if (state === 'writer') lease = new Lease(f.repo.commonDir, randomUUID());
      assert((await f.call('repos.remove')).error, state); assert(existsSync(f.hook), state); assert.equal(f.engine.repos.all().length, 1);
    } finally { lease?.release(); f.close(); }
  }
});

test('loss after unlink keeps admission fenced and restart resumes the same removal without repeating effects', async () => {
  const f = await fixture(); let second;
  try {
    const put = f.store.put.bind(f.store);
    f.store.put = (namespace, key, value) => { if (namespace === 'repositoryRemoval' && value.state === 'completed') throw new Error('fixture crash after unlink'); return put(namespace, key, value); };
    const failed = await f.call('repos.remove'); assert(failed.error); assert(!existsSync(f.hook)); assert.equal(f.engine.repos.all().length, 1);
    const intent = f.store.record('repositoryRemoval', f.repo.id); assert.equal(intent.state, 'unlinking');
    assert.throws(() => f.store.admit(randomUUID(), 'checks', f.repo.id, {}, 'fixture'), { code: 'REPOSITORY_REMOVAL_PENDING' });
    assert.equal((await f.call('repos.list', {})).result.pendingRemovals[0].repositoryId, f.repo.id);
    assert.equal((await f.call('repos.configure', { repo: f.repo.id, config: f.repo.config, expectedRevision: f.repo.revision, requestId: randomUUID() })).error.code, 'REPOSITORY_REMOVAL_PENDING');
    f.store.put = put;
    second = new Journal(f.store.directory); const repos = new Repositories(second), removal = new RepositoryRemoval(second, repos);
    const result = await removal.remove(await repos.get(f.repo.id)); assert.equal(result.removalId, intent.id); assert.equal(result.ownedHookRemoved, true); assert.equal(repos.all().length, 0);
  } finally { second?.close(); f.close(); }
});

test('a replacement after interrupted unlink survives, and concurrent removals have one retained owner', async () => {
  const f = await fixture(); try {
    const put = f.store.put.bind(f.store);
    f.store.put = (namespace, key, value) => { if (namespace === 'repositoryRemoval' && value.state === 'completed') throw new Error('fixture loss'); return put(namespace, key, value); };
    const responses = await Promise.all([f.call('repos.remove'), f.call('repos.remove')]);
    assert.equal(responses.filter(row => row.error?.code === 'REPOSITORY_BUSY').length, 1);
    assert.equal(f.store.record('repositoryRemoval', f.repo.id).state, 'unlinking'); f.store.put = put;
    writeFileSync(f.hook, 'replacement belongs to the user', { mode: 0o755 });
    const result = await f.call('repos.remove'); assert.equal(result.error.code, 'OWNED_HOOK_CHANGED');
    assert.equal(readFileSync(f.hook, 'utf8'), 'replacement belongs to the user'); assert.equal(f.engine.repos.all().length, 1);
  } finally { f.close(); }
});
