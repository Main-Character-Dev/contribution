import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Journal } from '../packages/engine/dist/journal.js';
import { CoreDeviceBackend } from '../packages/engine/dist/device-coredevice.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ct-coredevice-readback-')), store = new Journal(join(root, 'state'));
  const receipt = JSON.parse(readFileSync(new URL('../packages/contracts/examples/device-operation.json', import.meta.url), 'utf8'));
  store.put('coreDeviceSelection', receipt.deviceId, { deviceId: receipt.deviceId, identifier: 'fixture-coredevice-identifier', udid: 'fixture-udid', paired: true, tunnel: 'connected' });
  const calls = []; let response = { apps: [] }, overrides = {};
  const backend = new CoreDeviceBackend(store, async (exe, args, options) => {
    calls.push({ exe, args, options });
    return { code: 0, signal: null, cancelled: false, timedOut: false, stdout: JSON.stringify({ result: response }), stderr: '', ...overrides };
  });
  return { store, backend, receipt, calls, result: (value, flags = {}) => { response = value; overrides = flags; }, cleanup: () => { store.close(); rmSync(root, { recursive: true }); } };
}

test('cached CoreDevice details cannot confirm connect; a bounded app query retains only scoped evidence', async () => {
  const f = fixture(); try {
    f.result({ hardwareProperties: { udid: 'fixture-udid' }, connectionProperties: { tunnelState: 'connected' } });
    await assert.rejects(f.backend.perform('connect', f.receipt, {}, new AbortController().signal), error => error.code === 'DEVICE_PROTOCOL_CHANGED');
    assert.equal(f.store.records('deviceReadback').length, 0);
    f.result({ apps: [{ bundleIdentifier: 'unrelated.private.app' }] });
    const result = await f.backend.perform('connect', f.receipt, {}, new AbortController().signal);
    assert.equal(result.state, 'succeeded'); assert.equal(result.certainty, 'confirmed');
    const evidence = f.store.record('deviceReadback', result.evidenceRefs[0]);
    assert.equal(evidence.value.deviceId, f.receipt.deviceId); assert.equal(evidence.value.appCount, 1);
    assert.equal(JSON.stringify(evidence).includes('unrelated.private.app'), false);
    assert.deepEqual(f.calls[1].args.slice(0, 6), ['devicectl', 'device', 'info', 'apps', '--device', 'fixture-coredevice-identifier']);
    assert.equal(f.calls[1].options.timeoutMs, 17000);
  } finally { f.cleanup(); }
});

test('CoreDevice zero exit after timeout, cancellation, signal or error never becomes success', async () => {
  const f = fixture(); try {
    for (const flags of [{ timedOut: true }, { cancelled: true }, { signal: 'SIGTERM' }, { code: 1 }, { stdout: JSON.stringify({ error: {}, result: { apps: [] } }) }]) {
      f.result({ apps: [] }, flags);
      await assert.rejects(f.backend.perform('connect', f.receipt, {}, new AbortController().signal));
    }
    f.result({ apps: [] }); const aborted = new AbortController(); aborted.abort();
    await assert.rejects(f.backend.perform('connect', f.receipt, {}, aborted.signal));
    assert.equal(f.store.records('deviceReadback').length, 0);
  } finally { f.cleanup(); }
});
