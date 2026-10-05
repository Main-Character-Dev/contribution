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
  const execute = async (exe, args, options) => {
    calls.push({ exe, args, options });
    const value = typeof response === 'function' ? await response(args, options) : response;
    return { code: 0, signal: null, cancelled: false, timedOut: false, stdout: JSON.stringify({ info: { outcome: 'success' }, result: value }), stderr: '', ...overrides };
  };
  const backend = new CoreDeviceBackend(store, execute);
  return { store, backend, receipt, calls, execute, result: (value, flags = {}) => { response = value; overrides = flags; }, cleanup: () => { store.close(); rmSync(root, { recursive: true }); } };
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
    for (const flags of [{ timedOut: true }, { cancelled: true }, { signal: 'SIGTERM' }, { code: 1 }, { outputLimited: true },
      { stdout: JSON.stringify({ error: {}, result: { apps: [] } }) }, { stdout: JSON.stringify({ info: { outcome: 'failed' }, result: { apps: [] } }) }]) {
      f.result({ apps: [] }, flags);
      await assert.rejects(f.backend.perform('connect', f.receipt, {}, new AbortController().signal));
    }
    f.result({ apps: [] }); const aborted = new AbortController(); aborted.abort();
    await assert.rejects(f.backend.perform('connect', f.receipt, {}, aborted.signal));
    assert.equal(f.store.records('deviceReadback').length, 0);
  } finally { f.cleanup(); }
});

const directory = 'file:///private/var/containers/Bundle/Application/fixture/Selected.app/';
function launchFixture(f, overrides = {}) {
  const app = { bundleIdentifier: f.receipt.intent.app.bundleId, version: f.receipt.intent.app.marketingVersion, bundleVersion: f.receipt.intent.app.buildVersion,
    teamIdentifier: f.receipt.intent.app.teamId, url: directory };
  const process = { processIdentifier: 41, executable: directory + 'Selected' };
  const state = { app, process, processes: [process], ...overrides };
  f.result(async args => {
    if (args.includes('apps')) return { apps: state.apps ?? [state.app, { bundleIdentifier: 'unrelated.private.app', url: 'file:///private/unrelated.app/' }] };
    if (args.includes('launch')) { if (state.failure) throw new Error('lost launch reply'); return { process: state.process }; }
    if (args.includes('processes')) { state.afterProcesses?.(); return state.inventory ?? { runningProcesses: state.processes }; }
    throw new Error('Unexpected command');
  }); return state;
}

test('launch confirms live selected process after independent app identity readback without inheriting child environment', async () => {
  const f = fixture(), saved = process.env.DEVICECTL_CHILD_PRIVATE_FLAG;
  process.env.DEVICECTL_CHILD_PRIVATE_FLAG = 'must-not-reach-app';
  try {
    launchFixture(f);
    const result = await f.backend.perform('launch', f.receipt, {}, new AbortController().signal);
    assert.equal(result.state, 'succeeded'); assert.equal(result.launchReadback.processState, 'running'); assert.equal(result.launchReadback.processId, 41);
    assert.equal(result.launchReadback.deviceId, f.receipt.deviceId); assert.equal(result.launchReadback.bundleId, f.receipt.intent.app.bundleId);
    assert.equal(f.calls.filter(call => call.args.includes('launch')).length, 1);
    const launch = f.calls.find(call => call.args.includes('launch'));
    assert.deepEqual(launch.args.slice(0, -4), ['devicectl', 'device', 'process', 'launch', '--device', 'fixture-coredevice-identifier', '--environment-variables', '{}', '--activate', f.receipt.intent.app.bundleId]);
    assert.equal(launch.options.env.DEVICECTL_CHILD_PRIVATE_FLAG, undefined); assert.ok(Object.hasOwn(launch.options.env, 'DEVICECTL_CHILD_PRIVATE_FLAG'));
    assert.equal(launch.args.includes('--terminate-existing'), false); assert.equal(launch.args.includes('--console'), false);
    assert.ok(f.calls.filter(call => call.args.includes('apps')).every(call => call.args.includes('--bundle-id')));
    const evidence = JSON.stringify(f.store.record('deviceReadback', result.evidenceRefs[0]));
    assert.doesNotMatch(evidence, /unrelated|containers|PRIVATE_FLAG/);
    await assert.rejects(f.backend.perform('launch', f.receipt, {}, new AbortController().signal), error => error.code === 'LAUNCH_RECONCILIATION_REQUIRED');
    assert.equal(f.calls.filter(call => call.args.includes('launch')).length, 1);
  } finally { if (saved === undefined) delete process.env.DEVICECTL_CHILD_PRIVATE_FLAG; else process.env.DEVICECTL_CHILD_PRIVATE_FLAG = saved; f.cleanup(); }
});

test('launch readback excludes extensions, similar names, duplicate processes and different returned PID', async () => {
  for (const processes of [[], [{ processIdentifier: 41, executable: directory + 'PlugIns/Widget.appex/Widget' }],
    [{ processIdentifier: 41, executable: directory.replace('Selected.app', 'Selected.app.other') + 'Selected' }],
    [{ processIdentifier: 42, executable: directory + 'Selected' }],
    [{ processIdentifier: 41, executable: directory + 'Selected' }, { processIdentifier: 41, executable: directory + 'Selected' }]]) {
    const f = fixture(); try {
      launchFixture(f, { processes }); const result = await f.backend.perform('launch', f.receipt, {}, new AbortController().signal);
      assert.equal(result.state, 'outcome_unknown'); assert.equal(result.launchReadback, null); assert.equal(f.store.records('deviceReadback').length, 0);
    } finally { f.cleanup(); }
  }
});

test('lost launch reply survives a reopened journal and observes only without redispatch', async () => {
  const f = fixture(); let reopened;
  try {
    const state = launchFixture(f, { failure: true });
    await assert.rejects(f.backend.perform('launch', f.receipt, {}, new AbortController().signal), /lost launch reply/);
    assert.equal(f.store.records('coreDeviceLaunch').length, 1); state.failure = false;
    reopened = new Journal(f.store.directory); const restored = new CoreDeviceBackend(reopened, f.execute);
    const result = await restored.reconcile(f.receipt.effects.find(effect => effect.operation === 'launch'), f.receipt);
    assert.equal(result.state, 'succeeded'); assert.equal(f.calls.filter(call => call.args.includes('launch')).length, 1);
    const changed = structuredClone(f.receipt); changed.intent.app.buildVersion = '43';
    const denied = await restored.reconcile(changed.effects.find(effect => effect.operation === 'launch'), changed);
    assert.equal(denied.state, 'outcome_unknown'); assert.deepEqual(denied.reasonCodes, ['LAUNCH_SELECTION_UNCONFIRMED']);
  } finally { reopened?.close(); f.cleanup(); }
});

test('missing, ambiguous or changed installed app cannot become launch confirmation', async () => {
  for (const mode of ['unobserved', 'version', 'duplicate', 'directory', 'traversal', 'encoded-traversal', 'url-host', 'concurrent']) {
    const f = fixture(); try {
      const state = launchFixture(f);
      if (mode === 'unobserved') state.apps = [];
      if (mode === 'version') state.app.bundleVersion = 'another-build';
      if (mode === 'duplicate') state.apps = [state.app, state.app];
      if (mode === 'directory') state.app.url = 'file:///private/Other';
      if (mode === 'traversal') state.app.url = directory + '../Other.app';
      if (mode === 'encoded-traversal') state.app.url = directory + '%2e%2e/Other.app';
      if (mode === 'url-host') state.app.url = 'file://foreign/private/Other.app';
      if (mode === 'concurrent') state.afterProcesses = () => { state.app.bundleVersion = 'another-build'; };
      if (mode === 'concurrent') assert.equal((await f.backend.perform('launch', f.receipt, {}, new AbortController().signal)).state, 'outcome_unknown');
      else await assert.rejects(f.backend.perform('launch', f.receipt, {}, new AbortController().signal));
      assert.equal(f.store.records('deviceReadback').length, 0);
      assert.equal(f.calls.filter(call => call.args.includes('launch')).length, mode === 'concurrent' ? 1 : 0);
    } finally { f.cleanup(); }
  }
});

test('launch delivery or unknown process output never substitutes for live readback', async () => {
  for (const overrides of [{ process: {} }, { process: { processIdentifier: '41', executable: directory + 'Selected' } },
    { process: { processIdentifier: 41, executable: directory + 'PlugIns/Widget.appex/Widget' } }, { inventory: {} }, { inventory: { runningProcesses: [null] } }]) {
    const f = fixture(); try {
      launchFixture(f, overrides);
      await assert.rejects(f.backend.perform('launch', f.receipt, {}, new AbortController().signal));
      assert.equal(f.store.records('deviceReadback').length, 0); assert.equal(f.store.records('coreDeviceLaunch').length, 1);
      await assert.rejects(f.backend.perform('launch', f.receipt, {}, new AbortController().signal), error => error.code === 'LAUNCH_RECONCILIATION_REQUIRED');
    } finally { f.cleanup(); }
  }
});

test('launch rechecks engine authority after its asynchronous app preflight', async () => {
  const f = fixture(); try {
    launchFixture(f); let checked = false;
    await assert.rejects(f.backend.perform('launch', f.receipt, {}, new AbortController().signal, () => {
      checked = true; assert.equal(f.calls.length, 1); assert.ok(f.calls[0].args.includes('apps'));
      throw new Error('scope revoked during backend preflight');
    }), /scope revoked/);
    assert.equal(checked, true); assert.equal(f.store.records('coreDeviceLaunch').length, 0);
    assert.equal(f.calls.filter(call => call.args.includes('launch')).length, 0);
  } finally { f.cleanup(); }
});
