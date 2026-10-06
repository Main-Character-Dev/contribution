import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, rmSync, statSync, cpSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { fixture, repository } from './integration/service.mjs';
import { Journal } from '../packages/engine/dist/journal.js';
import { Engine } from '../packages/engine/dist/service.js';

test('maintenance survives a crash, blocks new effects and releases unchanged queued identities on cancellation', async () => {
  const f = await fixture(); try {
    const repo = (await f.call('repos.add', { path: repository(f.root) })).result.repository;
    await f.call('service.pause'); const requestId = randomUUID();
    const accepted = await f.call('repos.initialize', { repo: repo.id, requestId });
    const beginId = randomUUID(), held = await f.call('maintenance.begin', { requestId: beginId });
    const windowId = held.result.window.id, payload = held.result.window.payload;
    assert.equal((await f.call('maintenance.begin', { requestId: beginId })).result.window.id, windowId);
    assert.equal((await f.call('maintenance.begin', { requestId: randomUUID() })).error.code, 'MAINTENANCE_HELD');
    assert.equal((await f.call('service.resume')).error.code, 'SERVICE_MAINTENANCE');
    assert.equal((await f.call('repos.initialize', { repo: repo.id, requestId: randomUUID() })).error.code, 'SERVICE_MAINTENANCE');
    await f.stop('SIGKILL'); await f.start();
    assert.equal((await f.call('service.status')).result.maintenance, true);
    assert.equal((await f.call('runs.get', { operationId: accepted.operationId })).operationState, 'queued');
    assert.equal((await f.call('maintenance.resume', { windowId, observedPayload: 'old-ui', outcome: 'cancelled' })).error.code, 'PAYLOAD_CHANGED');
    assert.equal((await f.call('maintenance.resume', { windowId, observedPayload: payload, outcome: 'cancelled' })).error, null);
    assert.equal((await f.call('service.status')).result.paused, true);
    const same = await f.call('repos.initialize', { repo: repo.id, requestId });
    assert.equal(same.operationId, accepted.operationId); assert.equal(same.result.attemptId, accepted.result.attemptId);
    await f.call('service.resume'); assert.equal((await f.wait(accepted.operationId)).operationState, 'succeeded');
  } finally { await f.cleanup(); }
});

test('stop checkpoints a private verified backup, exits the helper and retains the update hold on relaunch', async () => {
  const f = await fixture(); try {
    const repo = (await f.call('repos.add', { path: repository(f.root) })).result.repository;
    await f.call('service.pause'); const accepted = await f.call('repos.initialize', { repo: repo.id, requestId: randomUUID() });
    const window = (await f.call('maintenance.begin', { requestId: randomUUID() })).result.window;
    const stop = await f.call('maintenance.stop', { windowId: window.id });
    assert.equal(stop.result.helperStopped, false); assert.equal(stop.error, null);
    const receipt = stop.result.window.backup;
    assert.equal(receipt.operations, 1); assert.equal(statSync(receipt.path).mode & 0o777, 0o600);
    assert.equal(createHash('sha256').update(readFileSync(receipt.path)).digest('hex'), receipt.sha256);
    const db = new DatabaseSync(receipt.path, { readOnly: true });
    assert.equal(db.prepare('SELECT id FROM operations').get().id, accepted.operationId); db.close();
    // Observe process exit, not just socket disconnection, before any relaunch.
    for (let i = 0; i < 150; i++) {
      let alive = true; try { process.kill(f.pid(), 0); } catch { alive = false; }
      if (!alive) break;
      assert.ok(i < 149, 'helper did not stop'); await new Promise(r => setTimeout(r, 20));
    }
    const replacement = join(f.root, 'replacement'); cpSync(f.payload, replacement, { recursive: true });
    const manifestPath = join(replacement, 'manifest.json'), manifest = JSON.parse(readFileSync(manifestPath));
    const versionPath = join(replacement, 'version.json'), version = JSON.parse(readFileSync(versionPath));
    writeFileSync(versionPath, JSON.stringify({ ...version, build: '2' }));
    manifest.files['version.json'] = createHash('sha256').update(readFileSync(versionPath)).digest('hex');
    writeFileSync(manifestPath, JSON.stringify(manifest));
    await f.start(replacement); const status = (await f.call('service.status')).result;
    assert.notEqual(status.payload, window.payload);
    assert.equal(status.maintenanceWindow.phase, 'stopped'); assert.equal(status.maintenance, true);
    assert.equal((await f.call('maintenance.resume', { windowId: window.id, observedPayload: status.payload, outcome: 'cancelled' })).error.code, 'PAYLOAD_CHANGED');
    assert.equal((await f.call('maintenance.resume', { windowId: window.id, observedPayload: status.payload, outcome: 'activated' })).error, null);
    const queued = await f.call('runs.get', { operationId: accepted.operationId });
    assert.equal(queued.operationState, 'queued'); assert.equal(queued.result.attemptId, accepted.result.attemptId);
    await f.call('service.resume'); const completed = await f.wait(accepted.operationId);
    assert.equal(completed.operationState, 'succeeded'); assert.equal(completed.result.payload, status.payload);
  } finally { await f.cleanup(); }
});

test('maintenance counts asynchronous command work and refuses unresolved effects and owned sessions', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ct-maintenance-')), store = new Journal(root);
  try {
    const engine = new Engine(store, { identity: 'fixture', distribution: 'unsigned-development' });
    const repo = await engine.repos.add(repository(root));
    let release, started; const began = new Promise(resolve => { started = resolve; });
    engine.github.jobs = async () => { started(); await new Promise(resolve => { release = resolve; }); return {}; };
    const call = (command, args = {}) => engine.dispatch({ schemaVersion: 1, command, args, cwd: root });
    const working = call('github.jobs', { repo: repo.id, runId: 1, attempt: 1 }); await began;
    const window = (await call('maintenance.begin', { requestId: randomUUID() })).result.window;
    assert.equal((await call('maintenance.stop', { windowId: window.id })).error.code, 'MAINTENANCE_NOT_READY');
    release(); await working; assert.equal((await call('maintenance.status')).result.ready, true);
    const op = store.admit(randomUUID(), 'push', repo.id, {}, 'fixture', 'outcome_unknown');
    assert.deepEqual((await call('maintenance.status')).result.blockers.uncertainOperations, [op.operationId]);
    store.update(op, { state: 'failed' });
    store.put('deviceOwnership', 'fixture', { deviceId: 'fixture', ownerHostId: store.hostId, priorSession: 'unknown', state: 'blocked' });
    assert.equal((await call('maintenance.status')).result.ready, false);
    store.put('deviceOwnership', 'fixture', { deviceId: 'fixture', ownerHostId: store.hostId, priorSession: 'released', state: 'released' });
    assert.equal((await call('maintenance.status')).result.ready, true);
  } finally { store.close(); rmSync(root, { recursive: true }); }
});

test('an older engine refuses a newer journal without mutating its bytes or restoring a snapshot', () => {
  const root = mkdtempSync(join(tmpdir(), 'ct-newer-db-'));
  try {
    const journal = new Journal(root); journal.setMeta('acceptedWork', randomUUID()); journal.db.exec('PRAGMA user_version=4'); journal.close();
    const path = join(root, 'journal.sqlite'), before = readFileSync(path);
    assert.throws(() => new Journal(root), error => error.code === 'DATABASE_TOO_NEW');
    assert.deepEqual(readFileSync(path), before);
  } finally { rmSync(root, { recursive: true }); }
});
