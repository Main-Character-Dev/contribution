import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Journal } from '../packages/engine/dist/journal.js';
import { WorkPower } from '../packages/engine/dist/power.js';
import { Engine } from '../packages/engine/dist/service.js';
import { validateContract } from '../packages/contracts/dist/index.js';
import { fixture as serviceFixture } from './integration/service.mjs';

const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ct-power-')), store = new Journal(root), calls = []; let time = 0;
  const execute = async (command, argv, options) => new Promise(resolve => {
    const call = { command, argv, options, resolve: result => resolve({ code: 0, stdout: '', stderr: '', signal: null, cancelled: false, timedOut: false, ...result }) }; calls.push(call);
    options.signal.addEventListener('abort', () => call.resolve({ code: 130, cancelled: true }), { once: true }); options.started?.(12345, 'fixture-only');
  });
  const power = new WorkPower(store, execute, () => time);
  const configure = enabled => power.configure({ schemaVersion: 1, keepAwakeWhileWorking: enabled }, power.policy().revision, randomUUID());
  return { root, store, power, calls, configure, time: value => { time = value; }, cleanup: async () => { await power.close(); store.close(); rmSync(root, { recursive: true }); } };
}

test('keep-awake is disabled by default and creates only a finite parent-bound idle-sleep request for active work', async () => {
  const f = fixture(); try {
    f.power.refresh(true); assert.equal(f.calls.length, 0); assert.equal(f.power.status().state, 'inactive');
    f.power.refresh(false); f.configure(true); assert.equal(f.calls.length, 0);
    f.power.refresh(true); assert.equal(f.calls.length, 1); assert.equal(f.power.status().state, 'requested');
    const call = f.calls[0]; assert.equal(call.command, '/usr/bin/caffeinate'); assert.deepEqual(call.argv, ['-i', '-t', '45', '-w', String(process.pid)]); assert.equal(call.options.timeoutMs, 50000);
    for (let i = 0; i < 5; i++) f.power.refresh(true); assert.equal(f.calls.length, 1);
    f.power.refresh(false); await settle(); assert.equal(call.options.signal.aborted, true); assert.equal(f.power.status().state, 'inactive');
    f.power.refresh(true); assert.equal(f.calls.length, 2); f.configure(false); await settle(); assert.equal(f.calls[1].options.signal.aborted, true);
  } finally { await f.cleanup(); }
});

test('assertion failure stays visible, retries with backoff and shutdown prevents renewal', async () => {
  const f = fixture(); try {
    f.configure(true); f.power.refresh(true); f.calls[0].resolve({ code: 1 }); await settle();
    assert.equal(f.power.status().state, 'unavailable'); assert.equal(f.power.status().reason, 'POWER_ASSERTION_FAILED');
    f.power.refresh(true); assert.equal(f.calls.length, 1);
    f.time(30000); f.power.refresh(true); assert.equal(f.calls.length, 2);
    f.calls[1].resolve({}); await settle(); f.power.refresh(true); assert.equal(f.calls.length, 3);
    await f.power.close(); f.power.refresh(true); assert.equal(f.calls.length, 3); assert.equal(f.power.status().working, false);
  } finally { await f.cleanup(); }
});

test('power policy retains reviewed identities across restart and maintenance exposes reads only', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ct-power-policy-')); let store = new Journal(root);
  try {
    let engine = new Engine(store, { identity: 'fixture' });
    const call = (command, args = {}) => engine.dispatch({ schemaVersion: 1, command, args, cwd: root });
    const initial = await call('service.power-policy'), request = { config: { schemaVersion: 1, keepAwakeWhileWorking: true }, expectedRevision: initial.result.revision, requestId: randomUUID() };
    assert.equal(initial.result.policy.keepAwakeWhileWorking, false); assert.equal((await call('service.power-policy', request)).error, null);
    assert.equal(engine.power.status().state, 'inactive'); // No work means no native assertion.
    engine.stopping = true; await engine.power.close(); store.close(); store = new Journal(root); engine = new Engine(store, { identity: 'fixture' });
    assert.equal((await call('service.power-policy', request)).result.requestId, request.requestId);
    assert.equal((await call('service.power-policy', { ...request, config: { ...request.config, keepAwakeWhileWorking: false } })).error.code, 'REQUEST_ID_CONFLICT');
    assert.equal((await call('service.power-policy', { ...request, requestId: randomUUID() })).error.code, 'REVISION_CONFLICT');
    assert.equal(validateContract('power-policy', { ...request.config, preventDisplaySleep: true }).valid, false);
    store.setMeta('maintenance', true);
    assert.equal((await call('service.power-policy')).error, null);
    assert.equal((await call('service.power-policy', request)).error.code, 'SERVICE_MAINTENANCE');
    await engine.power.close();
  } finally { if (store.db.isOpen) store.close(); rmSync(root, { recursive: true }); }
});

test('installed CLI exposes explicit power preference without changing the host default', async () => {
  const f = await serviceFixture(); try {
    const result = f.cli(['service', 'power-policy']); assert.equal(result.status, 0, result.stderr);
    const response = JSON.parse(result.stdout); assert.equal(response.result.policy.keepAwakeWhileWorking, false); assert.equal(response.result.state, 'inactive');
    assert.equal((await f.call('service.status')).result.power.policy.keepAwakeWhileWorking, false);
  } finally { await f.cleanup(); }
});
