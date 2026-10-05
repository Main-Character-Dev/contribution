import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Journal } from '../packages/engine/dist/journal.js';
import { Engine } from '../packages/engine/dist/service.js';
import { digest, Fault } from '../packages/engine/dist/core.js';
import { repository } from './integration/service.mjs';
const example = name => JSON.parse(readFileSync(new URL(`../packages/contracts/examples/${name}.json`, import.meta.url), 'utf8'));

async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'ct-remote-device-')), hosts = {}, calls = [], targetApp = example('device-operation').intent.app;
  let offline = false, lost = false, uncertain = false;
  const transport = async (alias, envelope) => {
    if (offline) throw new Fault('PEER_UNAVAILABLE', 'Fixture host offline.', 3);
    const result = await hosts[alias].dispatch({ schemaVersion: 1, command: 'peer.exchange', args: { envelope }, cwd: root });
    if (lost && envelope.action === 'device.command') { lost = false; throw new Fault('PEER_UNAVAILABLE', 'Admission reply lost after target accepted.', 3); }
    if (result.error) throw new Fault(result.error.code, result.error.message, 3); return result.result;
  };
  const device = 'device-fixture-phone-01', contexts = {};
  for (const name of ['laptop', 'mini']) {
    const store = new Journal(join(root, name)), context = structuredClone(example('device-operation').context); context.host.hostId = store.hostId; context.device.deviceId = device; contexts[name] = context;
    const readback = receipt => ({ state: 'succeeded', certainty: 'confirmed', evidenceRefs: ['fixture-only-readback'], installReadback: { deviceId: device, bundleId: receipt.intent.app.bundleId, teamId: null, marketingVersion: receipt.intent.app.marketingVersion, buildVersion: receipt.intent.app.buildVersion, observedAt: new Date().toISOString(), method: 'fixture only' } });
    const backend = { recordMode: 'fixture', inventory: async () => [{ deviceId: device, label: 'Fixture' }],
      observe: async () => ({ recordMode: 'fixture', deviceId: device, observedAt: new Date().toISOString(), context, trust: 'trusted', developerService: 'ready', session: 'owned', externalSession: 'absent', signingReady: true, hostReady: true, reasonCodes: [] }),
      verifyArtifact: async () => {}, verifyInstalledApp: async () => {}, perform: async (action, receipt) => { calls.push({ host: name, action }); if (uncertain) throw Error('Readback lost'); return readback(receipt); }, reconcile: async (_effect, receipt) => readback(receipt) };
    const payload = { identity: 'fixture', node: process.execPath, cli: join(root, 'fixture-cli.js') }; writeFileSync(payload.cli, 'process.exit(3);');
    const engine = new Engine(store, payload, transport, { backend, mode: 'fixture' }); hosts[name] = engine;
    store.setMeta('settings', { ...engine.settings(), remoteDevices: { enabled: true, maintainSession: false } });
  }
  const call = (host, command, args = {}) => hosts[host].dispatch({ schemaVersion: 1, command, args, cwd: root });
  for (const [host, alias] of [['laptop', 'mini'], ['mini', 'laptop']]) await call(host, 'hosts.pair', { sshAlias: alias });
  const config = (await call('laptop', 'repos.add', { path: repository(root, 'source') })).result.repository.config;
  assert.equal((await call('mini', 'repos.add', { path: repository(root, 'destination'), config })).error, null);
  assert.equal((await call('laptop', 'repos.pair', { repo: config.repositoryId, host: hosts.mini.store.hostId, requestId: randomUUID() })).error, null);
  const artifact = example('artifact-provenance'); artifact.repositoryId = config.repositoryId; artifact.app = targetApp; artifact.signing.eligibleDeviceRefs = [device];
  const path = join(root, 'fixture-artifact'); writeFileSync(path, 'fixture artifact'); artifact.artifact.sha256 = digest(readFileSync(path)); artifact.artifact.bytes = 16;
  for (const [name, engine] of Object.entries(hosts)) {
    const repo = engine.repos.all()[0];
    engine.store.put('deviceProfile', repo.id, { repositoryId: repo.id, adapterId: 'fixture', revision: 'original-profile', app: targetApp, permitsForeground: false, configurations: [], buildProfiles: [], plans: {} });
    const owner = engine.devices.ownership(device); engine.devices.saveOwnership({ ...owner, ownerHostId: engine.store.hostId, state: 'owned', mutationsPermitted: true, priorSession: 'none', externalSession: 'absent', reasonCodes: [] });
    await engine.devices.observe(repo, device); engine.devices.authorize(repo, device, ['install'], false, randomUUID());
    const capability = engine.devices.capability('install', contexts[name]); engine.store.put('deviceCapability', capability.capabilityId, { ...capability, support: 'supported', qualifiedAt: new Date().toISOString(), evidenceIds: ['fixture-only'], limitations: [], reasonCodes: [] });
    engine.store.put('deviceArtifact', artifact.artifactId, { provenance: artifact, path, appPath: join(root, 'fixture.app') });
  }
  const args = { repo: config.repositoryId, host: hosts.laptop.store.hostId, device, artifact: artifact.artifactId, requestId: randomUUID() };
  const wait = async (host, operationId) => {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      for (const engine of Object.values(hosts)) { for (const op of engine.store.unsettled().filter(op => op.state === 'queued_local')) engine.store.update(op, { result: { ...op.result, nextPeerAttempt: 0 } }); await engine.peers.tick(); }
      const result = await call(host, 'runs.get', { operationId }); if (!['queued', 'running', 'queued_local'].includes(result.operationState)) return result;
      await new Promise(r => setTimeout(r, 10));
    }
    throw Error('remote device operation timeout');
  };
  return { root, hosts, calls, call, args, wait, offline: value => { offline = value; }, lose: () => { lost = true; }, uncertain: value => { uncertain = value; }, cleanup: async () => {
    for (const engine of Object.values(hosts)) engine.stopping = true;
    while (Object.values(hosts).some(engine => engine.active.size || engine.peers.busy)) await new Promise(r => setTimeout(r, 10));
    for (const engine of Object.values(hosts)) engine.store.close(); rmSync(root, { recursive: true });
  } };
}

test('selected device host is independent of canonical Git owner and lost admission replies install only once', async () => {
  const f = await setup(); try {
    f.lose(); const accepted = await f.call('mini', 'devices.install', f.args);
    assert.equal(accepted.operationState, 'queued_local'); assert.equal(accepted.result.acceptance.executionHostAccepted, false); assert.equal('canonicalHostAccepted' in accepted.result, false);
    const result = await f.wait('mini', accepted.operationId); assert.equal(result.operationState, 'succeeded', JSON.stringify(result));
    assert.equal(result.result.acceptance.executionHostAccepted, true); assert.equal(result.result.deviceOperation.executionHostId, f.hosts.laptop.store.hostId);
    assert.equal(f.hosts.mini.repos.all()[0].canonicalHostId, f.hosts.mini.store.hostId); assert.deepEqual(f.calls, [{ host: 'laptop', action: 'install' }]);
    assert.equal((await f.call('mini', 'devices.install', f.args)).operationId, accepted.operationId);
    assert.equal(f.hosts.laptop.store.list().filter(op => op.kind === 'device').length, 1);
  } finally { await f.cleanup(); }
});

test('inventory and installed-app reads use the selected peer and reject unscoped remote inventory', async () => {
  const f = await setup(); try {
    f.hosts.laptop.devices.backend.inventory = async () => [{ deviceId: f.args.device, label: 'Selected laptop phone' }];
    const result = await f.call('mini', 'devices.list', { repo: f.args.repo, host: f.args.host });
    assert.equal(result.error, null, JSON.stringify(result)); assert.equal(result.result.executionHostId, f.args.host);
    assert.equal(result.result.devices[0].label, 'Selected laptop phone');
    assert.equal((await f.call('mini', 'devices.list', { host: f.args.host })).error.code, 'REPOSITORY_SCOPE_REQUIRED');
    const accepted = await f.call('mini', 'devices.install', f.args); await f.wait('mini', accepted.operationId);
    const apps = await f.call('mini', 'devices.apps', { repo: f.args.repo, host: f.args.host, device: f.args.device });
    assert.equal(apps.error, null, JSON.stringify(apps)); assert.equal(apps.result.executionHostId, f.args.host); assert.equal(apps.result.apps.length, 1);
    f.hosts.laptop.store.db.prepare("DELETE FROM records WHERE namespace='deviceProfile'").run();
    const profile = await f.call('mini', 'devices.profile', { repo: f.args.repo, host: f.args.host });
    assert.equal(profile.result.revision, 'none'); assert.equal(profile.result.policyRevision, null);
  } finally { await f.cleanup(); }
});

test('cached policy permits offline durable queueing but drift and missing grants never become remote execution', async () => {
  for (const changed of ['policy', 'grant']) {
    const f = await setup(); try {
      const profile = await f.call('mini', 'devices.profile', { repo: f.args.repo, host: f.args.host }); assert.equal(profile.error, null);
      f.offline(true); const accepted = await f.call('mini', 'devices.install', f.args); assert.equal(accepted.operationState, 'queued_local', JSON.stringify(accepted)); assert.deepEqual(f.calls, []);
      if (changed === 'policy') { const profile = f.hosts.laptop.store.record('deviceProfile', f.args.repo); f.hosts.laptop.store.put('deviceProfile', f.args.repo, { ...profile, revision: 'changed' }); }
      else await f.call('laptop', 'devices.revoke', { repo: f.args.repo, device: f.args.device, operations: ['install'], requestId: randomUUID() });
      f.offline(false); const result = await f.wait('mini', accepted.operationId);
      assert.equal(result.operationState, 'needs_attention'); assert.equal(result.error.code, changed === 'policy' ? 'POLICY_CHANGED' : 'AUTHORIZATION_DENIED'); assert.deepEqual(f.calls, []);
      const bootstrap = await f.call('mini', 'repos.initialize', { repo: f.args.repo, requestId: randomUUID() });
      assert.equal((await f.wait('mini', bootstrap.operationId)).operationState, 'succeeded', 'a device setup blocker must not prevent independent canonical Git work');
    } finally { await f.cleanup(); }
  }
});

test('pause retains remote device requests, and queued cancellation does not contact the physical backend', async () => {
  const f = await setup(); try {
    await f.call('mini', 'service.pause'); const accepted = await f.call('mini', 'devices.install', f.args); await f.hosts.mini.peers.tick();
    assert.equal(accepted.operationState, 'queued_local'); assert.equal(f.hosts.laptop.store.list().length, 0);
    const cancelled = await f.call('mini', 'runs.cancel', { operationId: accepted.operationId }); assert.equal(cancelled.operationState, 'cancelled');
    await f.call('mini', 'service.resume'); await f.hosts.mini.peers.tick(); assert.deepEqual(f.calls, []);
  } finally { await f.cleanup(); }
});

test('uncertain remote installation reconciles through target observations without another install', async () => {
  const f = await setup(); try {
    f.uncertain(true); const accepted = await f.call('mini', 'devices.install', f.args), uncertain = await f.wait('mini', accepted.operationId);
    assert.equal(uncertain.operationState, 'outcome_unknown', JSON.stringify(uncertain));
    const reconciled = await f.call('mini', 'devices.reconcile', { operationId: accepted.operationId, host: f.args.host, requestId: randomUUID() });
    assert.equal(reconciled.operationState, 'succeeded', JSON.stringify(reconciled)); assert.deepEqual(f.calls, [{ host: 'laptop', action: 'install' }]);
  } finally { await f.cleanup(); }
});

test('the peer device endpoint cannot grant itself authority or invoke arbitrary commands', async () => {
  const f = await setup(); try {
    await assert.rejects(f.hosts.mini.peers.call(f.args.host, 'device.command', { repositoryId: f.args.repo, command: 'devices.authorize', args: { ...f.args, operations: ['install'] }, expectedPolicyRevision: 'original-profile' }), error => error.code === 'DEVICE_COMMAND_UNAUTHORIZED');
    await assert.rejects(f.hosts.mini.peers.call(f.args.host, 'device.command', { repositoryId: f.args.repo, command: 'devices.install', args: { ...f.args, host: f.hosts.mini.store.hostId }, expectedPolicyRevision: 'original-profile' }), error => error.code === 'DEVICE_IDENTITY_MISMATCH');
    assert.deepEqual(f.calls, []);
  } finally { await f.cleanup(); }
});


test('cancelling uncertain admission fences a missing remote request instead of creating an install to cancel', async () => {
  const f = await setup(); try {
    await f.call('mini', 'devices.profile', { repo: f.args.repo, host: f.args.host }); f.offline(true);
    const accepted = await f.call('mini', 'devices.install', f.args);
    while (f.hosts.mini.peers.busy) await new Promise(r => setTimeout(r, 10));
    assert.equal(f.hosts.mini.store.get(accepted.operationId).result.transferAttempted, true);
    await f.call('mini', 'runs.cancel', { operationId: accepted.operationId }); f.offline(false);
    const result = await f.wait('mini', accepted.operationId); assert.equal(result.operationState, 'cancelled', JSON.stringify(result));
    assert.equal(f.hosts.laptop.store.list().length, 0); assert.deepEqual(f.calls, []);
    await assert.rejects(f.hosts.mini.peers.call(f.args.host, 'device.command', { repositoryId: f.args.repo, command: 'devices.install', args: f.args, expectedPolicyRevision: 'original-profile' }), error => error.code === 'REMOTE_REQUEST_CANCELLED');
    assert.deepEqual(f.calls, []);
  } finally { await f.cleanup(); }
});

test('cancellation after a lost acceptance reply finds and cancels the existing queued remote operation', async () => {
  const f = await setup(); try {
    await f.call('laptop', 'service.pause'); f.lose();
    const accepted = await f.call('mini', 'devices.install', f.args);
    while (f.hosts.mini.peers.busy) await new Promise(r => setTimeout(r, 10));
    assert.equal(f.hosts.laptop.store.list().filter(op => op.kind === 'device').length, 1);
    assert.equal(f.hosts.mini.store.get(accepted.operationId).result.remoteOperationId, undefined);
    await f.call('mini', 'runs.cancel', { operationId: accepted.operationId });
    const result = await f.wait('mini', accepted.operationId); assert.equal(result.operationState, 'cancelled', JSON.stringify(result));
    await f.call('laptop', 'service.resume'); assert.deepEqual(f.calls, []);
    assert.equal(f.hosts.laptop.store.list().filter(op => op.kind === 'device').length, 1);
  } finally { await f.cleanup(); }
});
