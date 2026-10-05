import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Journal } from '../packages/engine/dist/journal.js';
import { Engine } from '../packages/engine/dist/service.js';
import { completionReceipt } from '../packages/engine/dist/peer-receipts.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ct-remote-log-retention-')), store = new Journal(root), hostId = randomUUID();
  let op = store.admit(randomUUID(), 'remote.checks', randomUUID(), {}, 'fixture', 'queued_local');
  const response = { schemaVersion: 1, requestStatus: 'completed', operationId: randomUUID(), operationState: 'succeeded', error: null,
    result: { attemptId: randomUUID(), kind: 'checks', completedAt: new Date().toISOString(), checks: [] } };
  op = store.update(op, { state: 'succeeded', result: { remoteOperationId: response.operationId, canonicalHostId: hostId, canonicalObservation: response } });
  const acknowledge = () => store.put('peerCompletionOutbox', op.operationId, { operationId: op.operationId, repositoryId: op.repositoryId, hostId,
    receipt: completionReceipt(response), state: 'acknowledged', retainedAt: new Date().toISOString() });
  acknowledge();
  return { root, store, op, hostId, response, acknowledge, close: () => { store.close(); rmSync(root, { recursive: true }); } };
}

test('remote cached text counts against raw retention and expires atomically without losing completion identity', () => {
  const f = fixture(); try {
    f.store.log(f.op, 'local\n'); f.store.retainRemoteLog(f.op, f.hostId, 'remote result\n', 'available');
    assert.equal(f.store.retention().totalBytes, Buffer.byteLength('local\nremote result\n'));
    const original = completionReceipt(f.store.response(f.op)), future = Date.now() + 31 * 86400000;
    const preview = f.store.retention(false, future); assert.equal(preview.eligibleBytes, preview.totalBytes);
    const result = f.store.retention(true, future); assert.equal(result.totalBytes, 0);
    assert.ok(result.removed.includes(`remote:${f.op.attemptId}`)); assert.equal(f.store.record('remoteLog', f.op.operationId), undefined);
    assert.throws(() => f.store.remoteLogs(f.op), { code: 'LOG_EXPIRED' });
    assert.deepEqual(completionReceipt(f.store.response(f.op)), original);
    assert.ok(f.store.response(f.op).result.logRetention.remoteExpired);
    f.store.retainRemoteLog(f.op, f.hostId, 'historical data returned again', 'available');
    assert.equal(f.store.record('remoteLog', f.op.operationId), undefined);
    assert.equal(f.store.existing(f.op.requestId, f.op.kind, f.op.repositoryId, f.op.input).operationId, f.op.operationId);
  } finally { f.close(); }
});

test('pinned, incomplete and unacknowledged remote logs remain protected beyond ordinary expiration', () => {
  for (const mode of ['pinned', 'queued_local', 'outcome_unknown', 'interrupted', 'pending', 'old-peer']) {
    const f = fixture(); try {
      f.store.retainRemoteLog(f.op, f.hostId, 'protected remote evidence', 'available');
      if (mode === 'pinned') f.store.update(f.op, { pinned: true });
      else if (['queued_local', 'outcome_unknown', 'interrupted'].includes(mode)) f.store.update(f.op, { state: mode });
      else if (mode === 'pending') f.store.put('peerCompletionOutbox', f.op.operationId, { state: 'pending' });
      else f.store.db.prepare("DELETE FROM records WHERE namespace='peerCompletionOutbox' AND key=?").run(f.op.operationId);
      const report = f.store.retention(true, Date.now() + 366 * 86400000);
      assert.equal(report.protectedBytes, Buffer.byteLength('protected remote evidence'), mode);
      assert.equal(f.store.remoteLogs(f.store.get(f.op.operationId)).text, 'protected remote evidence');
    } finally { f.close(); }
  }
});

test('remote cache refresh respects the shared log cap and UTF-8 boundaries with visible truncation', () => {
  const f = fixture(); try {
    f.store.setMeta('settings', { retention: { rawLogDays: 30, summaryDays: 365, maxLogBytes: 12 } });
    f.store.log(f.op, 'local'); f.store.retainRemoteLog(f.op, f.hostId, '🛠🛠🛠', 'available');
    const cached = f.store.record('remoteLog', f.op.operationId);
    assert.equal(cached.text, '🛠'); assert.equal(cached.retainedBytes, 4); assert.equal(cached.truncated, true);
    assert.equal(f.store.retention().totalBytes, 9); assert.match(f.store.remoteLogs(f.op).text, /truncated/);
    f.store.retainRemoteLog(f.op, f.hostId, 'x'.repeat(500), 'available');
    assert.equal(f.store.record('remoteLog', f.op.operationId).text, 'x'.repeat(7)); assert.equal(f.store.retention().totalBytes, 12);
    f.store.log(f.op, 'extra local'); assert.equal(f.store.retention().totalBytes, 12);
    assert.throws(() => f.store.admit(randomUUID(), 'checks', randomUUID(), {}, 'fixture'), { code: 'STORAGE_PRESSURE' });
    assert.throws(() => f.store.retainRemoteLog(f.op, randomUUID(), 'foreign', 'available'), { code: 'PEER_OPERATION_MISMATCH' });
    assert.throws(() => f.store.retainRemoteLog(f.op, f.hostId, 'x'.repeat(132001), 'available'), { code: 'PEER_LOG_TOO_LARGE' });
  } finally { f.close(); }
});

test('unavailable and expired origin logs remain distinct from a cached snapshot and an empty local file', async () => {
  const f = fixture(); try {
    const engine = new Engine(f.store, { identity: 'fixture', node: process.execPath, cli: 'unused' });
    const call = tail => engine.dispatch({ schemaVersion: 1, command: 'logs', args: { operationId: f.op.operationId, ...(tail === undefined ? {} : { tail }) }, cwd: f.root });
    assert.equal((await call()).error.code, 'LOG_UNAVAILABLE');
    f.store.retainRemoteLog(f.op, f.hostId, '', 'expired'); assert.equal((await call()).error.code, 'LOG_EXPIRED');
    f.store.retainRemoteLog(f.op, f.hostId, 'previous\ncached\n', 'available');
    const observedAt = f.store.record('remoteLog', f.op.operationId).observedAt;
    f.store.retainRemoteLog(f.op, f.hostId, '', 'unavailable');
    const response = await call(); assert.equal(response.error, null); assert.match(response.result.text, /previous/);
    assert.equal(response.result.freshness, 'cached'); assert.equal(response.result.observedAt, observedAt); assert.equal(response.result.sourceStatus.state, 'unavailable');
    for (const tail of [0, -1, 'not-a-number', 10001]) assert.equal((await call(tail)).error.code, 'INVALID_LOG_RANGE');
    f.store.retention(true, Date.now() + 31 * 86400000); assert.equal((await call()).error.code, 'LOG_EXPIRED');
  } finally { f.close(); }
});

test('unknown or malformed old cached records count as protected usage instead of disappearing', () => {
  const f = fixture(); try {
    const unknown = randomUUID(), malformed = randomUUID();
    f.store.put('remoteLog', unknown, { text: 'unowned snapshot' }); f.store.put('remoteLog', malformed, { text: null, note: 'preserve' });
    const report = f.store.retention(true, Date.now() + 366 * 86400000);
    assert.ok(report.protectedBytes >= Buffer.byteLength('unowned snapshot')); assert.ok(f.store.record('remoteLog', unknown)); assert.ok(f.store.record('remoteLog', malformed));
  } finally { f.close(); }
});
