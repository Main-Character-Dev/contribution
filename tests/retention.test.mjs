import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Journal } from '../packages/engine/dist/journal.js';

test('raw retention removes only expired completed unpinned logs and preserves replay identities', () => {
  const root = mkdtempSync(join(tmpdir(), 'ct-retention-')), journal = new Journal(root);
  try {
    const rows = ['succeeded', 'pinned', 'outcome_unknown', 'running', 'peer', 'interrupted'].map(kind => {
      let op = journal.admit(randomUUID(), 'checks', randomUUID(), { kind }, 'fixture'); journal.log(op, kind + '\n');
      op = journal.update(op, { state: ['pinned', 'peer'].includes(kind) ? 'succeeded' : kind, pinned: kind === 'pinned', result: { completedAt: new Date().toISOString() } });
      if (kind === 'peer') journal.put('peerOperation', op.operationId, { from: randomUUID() }); return op;
    });
    for (const op of rows) journal.update(op, { result: { completedAt: '2020-01-01T00:00:00.000Z' } });
    const report = journal.retention(true); assert.deepEqual(report.removed, [rows[0].attemptId]);
    for (const op of rows.slice(1)) assert(existsSync(journal.logPath(op)));
    assert.throws(() => journal.logs(rows[0]), error => error.code === 'LOG_EXPIRED');
    assert.equal(journal.admit(rows[0].requestId, rows[0].kind, rows[0].repositoryId, rows[0].input, 'new-payload').operationId, rows[0].operationId);
    assert(journal.response(rows[0]).result.logRetention.expired);
  } finally { journal.close(); rmSync(root, { recursive: true }); }
});

test('the log cap bounds running output and rejects every new admission while original requests remain readable', () => {
  const root = mkdtempSync(join(tmpdir(), 'ct-retention-')), journal = new Journal(root);
  try {
    journal.setMeta('settings', { retention: { rawLogDays: 30, summaryDays: 365, maxLogBytes: 100 } });
    const op = journal.admit(randomUUID(), 'device', randomUUID(), {}, 'fixture'); journal.log(op, 'x'.repeat(500)); journal.log(op, 'more');
    assert.equal(statSync(journal.logPath(op)).size, 100); assert.equal(journal.retention().admissionBlocked, true);
    assert.throws(() => journal.admit(randomUUID(), 'remote.push', randomUUID(), {}, 'fixture'), error => error.code === 'STORAGE_PRESSURE');
    assert.equal(journal.admit(op.requestId, op.kind, op.repositoryId, op.input, 'fixture').operationId, op.operationId);
    assert(journal.response(op).result.logRetention.truncated);
  } finally { journal.close(); rmSync(root, { recursive: true }); }
});

test('a full protected cap permits one reviewed retention recovery without releasing paused repository work', async () => {
  const { fixture, repository, git, commit } = await import('./integration/service.mjs');
  const f = await fixture(); try {
    const path = repository(f.root), base = commit(path), repo = (await f.call('repos.add', { path })).result.repository;
    const task = join(f.root, 'task'); git(path, 'worktree', 'add', '--detach', task, base); const tip = commit(task, 'task.txt');
    await f.call('service.pause');
    const queued = await f.call('checks.run', { repo: repo.id, sourcePath: path, requestId: randomUUID() }); assert.equal(queued.error, null, JSON.stringify(queued));
    await f.stop(); const journal = new Journal(f.state), settings = journal.getMeta('settings');
    settings.retention.maxLogBytes = 100; journal.setMeta('settings', settings);
    const protectedOp = journal.admit(randomUUID(), 'checks', repo.id, { scope: 'retained' }, 'fixture');
    journal.update(protectedOp, { state: 'failed', pinned: true }); journal.log(protectedOp, 'protected evidence'.repeat(100)); journal.close();
    await f.start();
    const current = (await f.call('settings.get')).result, config = structuredClone(current.settings);
    const refused = await f.call('checks.run', { repo: repo.id, sourcePath: path, requestId: randomUUID() }); assert.equal(refused.error.code, 'STORAGE_PRESSURE');
    const capture = await f.call('submit', { repo: repo.id, requestId: randomUUID(), sourcePath: task, sourceTip: tip, base, metadata: { schemaVersion: 1 } });
    assert.equal(capture.error.code, 'STORAGE_PRESSURE'); assert.equal(git(path, 'for-each-ref', '--format=%(refname)', 'refs/contribution/outbox'), '');
    const createPath = join(f.root, 'new-project'), create = await f.call('repos.create', { path: createPath, requestId: randomUUID() });
    assert.equal(create.error.code, 'STORAGE_PRESSURE'); assert.equal(existsSync(createPath), false);
    config.retention.maxLogBytes = 10000;
    const unrelated = structuredClone(config); unrelated.notifications.success = !unrelated.notifications.success;
    assert.equal((await f.call('settings.apply', { config: unrelated, expectedRevision: current.revision, requestId: randomUUID() })).error.code, 'STORAGE_PRESSURE');
    assert.equal((await f.call('settings.apply', { config, expectedRevision: 'stale', requestId: randomUUID() })).error.code, 'STORAGE_PRESSURE');
    const request = { config, expectedRevision: current.revision, requestId: randomUUID() };
    const accepted = await f.call('settings.apply', request); assert.equal(accepted.error, null, JSON.stringify(accepted));
    const done = await f.wait(accepted.operationId); assert.equal(done.operationState, 'succeeded', JSON.stringify(done));
    assert.equal((await f.call('service.status')).result.paused, true);
    assert.equal((await f.call('runs.get', { operationId: queued.operationId })).operationState, 'queued');
    assert.equal((await f.call('settings.apply', request)).operationId, accepted.operationId);
    assert.equal((await f.call('doctor')).result.storage.admissionBlocked, false);
    assert.equal((await f.call('runs.get', { operationId: protectedOp.operationId })).operationState, 'failed');
    assert((await f.call('logs', { operationId: protectedOp.operationId })).result.text.includes('protected'));
  } finally { await f.cleanup(); }
});

test('storage recovery cannot enqueue a second bypass or use unreviewed host and configuration scope', async () => {
  const { Engine } = await import('../packages/engine/dist/service.js');
  const { digest } = await import('../packages/engine/dist/core.js');
  const root = mkdtempSync(join(tmpdir(), 'ct-recovery-reserve-')), store = new Journal(root);
  try {
    new Engine(store, { identity: 'fixture', node: process.execPath, cli: 'unused' });
    const previous = store.getMeta('settings'); previous.retention.maxLogBytes = 100; store.setMeta('settings', previous);
    const op = store.admit(randomUUID(), 'checks', randomUUID(), {}, 'fixture'); store.log(op, 'x'.repeat(100));
    const config = structuredClone(previous); config.retention.maxLogBytes = 1000;
    const input = { config, expectedRevision: digest(previous) };
    assert.throws(() => store.admit(randomUUID(), 'settings.apply', randomUUID(), input, 'fixture'), { code: 'STORAGE_PRESSURE' });
    const unbounded = structuredClone(input); unbounded.config.retention.maxLogBytes = 1e100;
    assert.throws(() => store.admit(randomUUID(), 'settings.apply', store.hostId, unbounded, 'fixture'), { code: 'STORAGE_PRESSURE' });
    const request = randomUUID(), accepted = store.admit(request, 'settings.apply', store.hostId, input, 'fixture');
    assert.throws(() => store.admit(randomUUID(), 'settings.apply', store.hostId, input, 'fixture'), { code: 'STORAGE_PRESSURE' });
    assert.equal(store.admit(request, 'settings.apply', store.hostId, input, 'fixture').operationId, accepted.operationId);
  } finally { store.close(); rmSync(root, { recursive: true }); }
});
