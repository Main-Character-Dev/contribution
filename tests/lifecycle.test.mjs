import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmodSync } from 'node:fs';
import { fixture, repository } from './integration/service.mjs';
import { socketPath } from '../packages/engine/dist/ipc.js';

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
