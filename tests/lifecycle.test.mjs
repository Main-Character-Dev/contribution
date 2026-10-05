import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture, repository } from './integration/service.mjs';
import { socketPath } from '../packages/engine/dist/ipc.js';
import { Journal } from '../packages/engine/dist/journal.js';
import { Engine } from '../packages/engine/dist/service.js';

test('idle restart replaces the service process and retains queued identity and pause state', async () => {
  const f = await fixture(); try {
    const repo = (await f.call('repos.add', { path: repository(f.root) })).result.repository;
    await f.call('service.pause'); const requestId = randomUUID();
    const accepted = await f.call('repos.initialize', { repo: repo.id, requestId });
    const payload = (await f.call('version')).result.payload;
    assert.equal((await f.call('service.restart', { whenIdle: true })).result.state, 'restart_ready');
    let ready = false;
    for (let i = 0; i < 150; i++) {
      await new Promise(resolve => setTimeout(resolve, 30));
      try { const status = await f.call('service.status'); if (status.result.state === 'running' && !status.result.maintenance) { ready = true; assert.equal(status.result.paused, true); break; } } catch { /* socket closes during exec */ }
    }
    assert.equal(ready, true, f.stderr()); assert.equal((await f.call('version')).result.payload, payload);
    const retained = await f.call('repos.initialize', { repo: repo.id, requestId });
    assert.equal(retained.operationId, accepted.operationId); assert.equal(retained.operationState, 'queued');
    await f.call('service.resume'); assert.equal((await f.wait(accepted.operationId)).operationState, 'succeeded');
  } finally { await f.cleanup(); }
});

test('IPC refuses a service socket exposed to other users before transmitting its credential', async () => {
  const f = await fixture(); try {
    chmodSync(socketPath(f.state), 0o666);
    await assert.rejects(f.call('version'), error => error.code === 'UNSAFE_SERVICE_ENDPOINT');
    chmodSync(socketPath(f.state), 0o600); assert.equal((await f.call('version')).error, null);
  } finally { await f.cleanup(); }
});

test('direct restart and update retain session blockers just like update maintenance', async () => {
  for (const state of ['backend-running', 'backend-unconfirmed', 'phone-owned', 'phone-unknown']) {
    const root = mkdtempSync(join(tmpdir(), 'ct-lifecycle-session-')), store = new Journal(root);
    try {
      const engine = new Engine(store, { identity: 'fixture', node: process.execPath, cli: '/fixture/cli' });
      const sessionId = randomUUID(), deviceId = 'fixture-device';
      if (state.startsWith('backend')) store.put('backendSession', sessionId, { sessionId, deviceId, state: state.slice(8), localProcess: 'unknown', dispatchGranted: true });
      else store.put('deviceOwnership', deviceId, { deviceId, ownerHostId: store.hostId, state: 'owned', priorSession: state === 'phone-owned' ? 'owned' : 'unknown' });
      for (const command of ['service.restart', 'update.apply']) {
        const result = await engine.dispatch({ schemaVersion: 1, command, args: { whenIdle: true }, cwd: root });
        assert.equal(result.error.code, 'RECONCILIATION_REQUIRED', state);
        assert.equal(result.result.blockers.backendSessions.length + result.result.blockers.deviceSessions.length, 1, state);
        assert.equal(engine.stopping, false); assert.equal(engine.restartRequested, false); assert.equal(store.getMeta('maintenance'), undefined);
      }
      assert.equal(engine.maintenance.isReady(engine.maintenance.blockers(0, false, 0)), false);
    } finally { store.close(); rmSync(root, { recursive: true }); }
  }
});
