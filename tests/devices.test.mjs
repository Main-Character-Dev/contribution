import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Journal } from '../packages/engine/dist/journal.js';
import { Engine } from '../packages/engine/dist/service.js';
import { Devices } from '../packages/engine/dist/devices.js';
import { digest } from '../packages/engine/dist/core.js';
import { assertContract } from '../packages/contracts/dist/index.js';
import { repository, commit } from './integration/service.mjs';

const example = name => JSON.parse(readFileSync(new URL(`../packages/contracts/examples/${name}.json`, import.meta.url), 'utf8'));
async function deviceFixture() {
  const root = mkdtempSync(join(tmpdir(), 'ct-device-')), journal = new Journal(join(root, 'state')), path = repository(root); commit(path);
  const template = example('device-operation'), context = template.context, device = context.device.deviceId;
  context.host.hostId = journal.hostId;
  const calls = [], observation = { recordMode: 'fixture', deviceId: device, observedAt: new Date().toISOString(), context, trust: 'trusted', developerService: 'ready', session: 'owned', externalSession: 'absent', signingReady: true, hostReady: true, reasonCodes: [] };
  const successes = receipt => ({ state: 'succeeded', certainty: 'confirmed', evidenceRefs: ['fixture-observation'],
    installReadback: { ...template.effects[0].installReadback, deviceId: device, bundleId: receipt.intent.app.bundleId, teamId: null, marketingVersion: receipt.intent.app.marketingVersion, buildVersion: receipt.intent.app.buildVersion, observedAt: new Date().toISOString() } });
  let behavior = async (action, receipt) => action === 'install' ? successes(receipt) : { state: 'failed', certainty: 'confirmed', reasonCodes: ['UNLOCK_REQUIRED'], evidenceRefs: ['fixture-launch-denied'] };
  let reconcile = async (_effect, receipt) => successes(receipt);
  const backend = { recordMode: 'fixture', inventory: async () => [{ deviceId: device, label: 'Fixture' }], observe: async () => structuredClone(observation),
    verifyArtifact: async () => {}, verifyInstalledApp: async () => {},
    perform: async (action, receipt, args, signal) => { calls.push(action); return behavior(action, receipt, args, signal); }, reconcile: async (effect, receipt) => reconcile(effect, receipt) };
  const engine = new Engine(journal, { identity: 'fixture' }, undefined, { backend, mode: 'fixture' });
  const settings = engine.settings(); settings.remoteDevices.enabled = true; journal.setMeta('settings', settings);
  const repo = await engine.repos.add(path);
  const profile = { repositoryId: repo.id, adapterId: 'fixture-ios-adapter', revision: 'fixture-policy', app: template.intent.app, permitsForeground: true, configurations: ['development'], buildProfiles: ['development'],
    plans: { 'remote-wifi-install': { operation: 'install', fixtureId: 'fixture-data-v1', acceptanceId: 'AT-02', authorizedOperations: ['install'], maxAttempts: 1, maxDurationSeconds: 10 } } };
  journal.put('deviceProfile', repo.id, profile);
  const owner = engine.devices.ownership(device);
  engine.devices.saveOwnership({ ...owner, ownerHostId: journal.hostId, state: 'owned', mutationsPermitted: true, priorSession: 'none', externalSession: 'absent', reasonCodes: [] });
  await engine.devices.observe(repo, device);
  engine.devices.authorize(repo, device, ['install', 'launch', 'connect', 'prepare'], false, randomUUID());
  for (const action of ['install', 'launch', 'connect', 'prepare']) {
    const cap = engine.devices.capability(action, context); journal.put('deviceCapability', cap.capabilityId, { ...cap, support: 'supported', qualifiedAt: new Date().toISOString(), evidenceIds: ['fixture-only'], limitations: [], reasonCodes: [] });
  }
  const artifact = example('artifact-provenance'); artifact.repositoryId = repo.id; artifact.app = profile.app; artifact.build.hostId = journal.hostId; artifact.source.policyRevision = profile.revision;
  artifact.signing.eligibleDeviceRefs = [device]; const artifactPath = join(root, 'fixture-artifact'); writeFileSync(artifactPath, 'fixture artifact bytes');
  artifact.artifact.sha256 = digest(readFileSync(artifactPath)); artifact.artifact.bytes = readFileSync(artifactPath).length;
  journal.put('deviceArtifact', artifact.artifactId, { provenance: artifact, path: artifactPath, appPath: join(root, 'fixture.app') });
  const args = { repo: repo.id, host: journal.hostId, device, artifact: artifact.artifactId, requestId: randomUUID() };
  const call = (command, input = args) => engine.dispatch({ schemaVersion: 1, command, args: input, cwd: path });
  const wait = async operationId => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) { const response = await call('runs.get', { operationId }); if (!['queued', 'running'].includes(response.operationState)) return response; await new Promise(resolve => setTimeout(resolve, 20)); }
    throw new Error('Device fixture did not finish');
  };
  return { root, journal, engine, repo, profile, backend, observation, context, device, args, calls, call, wait, artifactPath,
    behavior: fn => { behavior = fn; }, reconciliation: fn => { reconcile = fn; },
    cleanup: async () => { engine.stopping = true; while (engine.active.size) await new Promise(resolve => setTimeout(resolve, 20)); journal.close(); rmSync(root, { recursive: true }); } };
}

test('install success and launch failure remain independent through the shared service scheduler', async () => {
  const f = await deviceFixture(); try {
    const accepted = await f.call('devices.install', { ...f.args, launch: true }); assert.equal(accepted.error, null, JSON.stringify(accepted));
    assert.equal(accepted.result.acceptance.executionHostAccepted, true); assert.equal('canonicalHostAccepted' in accepted.result.acceptance, false);
    const result = await f.wait(accepted.operationId), receipt = result.result.deviceOperation; assertContract('device-operation', receipt);
    assert.equal(result.operationState, 'failed', JSON.stringify(result)); assert.equal(receipt.effects[0].state, 'succeeded'); assert.equal(receipt.effects[1].state, 'failed');
    assert.equal((await f.call('devices.install', { ...f.args, launch: true })).operationId, accepted.operationId); assert.deepEqual(f.calls, ['install', 'launch']);
  } finally { await f.cleanup(); }
});

test('lost effect readback blocks the device; reconciliation observes and never reinstalls or launches', async () => {
  const f = await deviceFixture(); try {
    f.behavior(async () => { throw new Error('lost connection after possible install'); });
    const accepted = await f.call('devices.install', { ...f.args, launch: true }); const uncertain = await f.wait(accepted.operationId);
    assert.equal(uncertain.operationState, 'outcome_unknown', JSON.stringify(uncertain)); assert.equal(uncertain.error.code, 'OUTCOME_UNCERTAIN');
    assert.equal(f.engine.devices.ownership(f.device).mutationsPermitted, false);
    const reconciled = await f.call('devices.reconcile', { operationId: accepted.operationId, host: f.journal.hostId, requestId: randomUUID() });
    assert.equal(reconciled.operationState, 'needs_attention', JSON.stringify(reconciled)); assert.equal(reconciled.result.deviceOperation.effects[0].state, 'succeeded');
    assert.equal(reconciled.result.deviceOperation.effects[1].state, 'queued'); assert.deepEqual(f.calls, ['install']);
  } finally { await f.cleanup(); }
});

test('revocation and immutable-artifact changes stop queued device effects before dispatch', async () => {
  for (const drift of ['authorization', 'artifact', 'context']) {
    const f = await deviceFixture(); try {
      await f.call('service.pause', {}); const accepted = await f.call('devices.install'); assert.equal(accepted.error, null);
      if (drift === 'authorization') await f.call('devices.revoke', { repo: f.repo.id, device: f.device, operations: ['install'], requestId: randomUUID() });
      if (drift === 'artifact') writeFileSync(f.artifactPath, 'changed');
      if (drift === 'context') f.observation.context.network.scenario = 'cold_cellular';
      await f.call('service.resume', {}); const result = await f.wait(accepted.operationId);
      assert.notEqual(result.operationState, 'succeeded'); assert.deepEqual(f.calls, []);
      assertContract('device-operation', result.result.deviceOperation); assert.equal(result.result.deviceOperation.operationState, result.operationState);
      assert.equal(result.error.code, drift === 'authorization' ? 'AUTHORIZATION_DENIED' : drift === 'artifact' ? 'ARTIFACT_CHANGED' : 'CAPABILITY_CONTEXT_CHANGED');
    } finally { await f.cleanup(); }
  }
});

test('service restart retains an uncertain device effect and never replays it automatically', async () => {
  const f = await deviceFixture(); let replacement;
  try {
    await f.call('service.pause', {}); const accepted = await f.call('devices.install');
    const op = f.journal.get(accepted.operationId), receipt = op.result.deviceOperation;
    receipt.operationState = 'running'; receipt.stage = 'installing'; receipt.effects[0].state = 'running'; receipt.effects[0].startedAt = new Date().toISOString();
    f.journal.update(op, { state: 'running', effectDispatched: true, result: { ...op.result, deviceOperation: receipt } });
    f.engine.stopping = true; replacement = new Engine(f.journal, { identity: 'fixture-updated' }, undefined, { backend: f.backend, mode: 'fixture' });
    const retained = f.journal.get(op.operationId); assert.equal(retained.state, 'outcome_unknown'); assert.equal(retained.payload, 'fixture');
    assert.equal(retained.result.deviceOperation.effects[0].state, 'outcome_unknown'); assert.equal(replacement.devices.ownership(f.device).mutationsPermitted, false);
    assert.deepEqual(f.calls, []);
    await replacement.devices.reconcile(retained);
    assert.equal(f.journal.get(op.operationId).state, 'succeeded'); assert.deepEqual(f.calls, []);
  } finally { if (replacement) replacement.stopping = true; await f.cleanup(); }
});

test('cancelling a queued device operation updates its effect receipt without touching the phone', async () => {
  const f = await deviceFixture(); try {
    await f.call('service.pause', {}); const accepted = await f.call('devices.install');
    const cancelled = await f.call('runs.cancel', { operationId: accepted.operationId });
    assert.equal(cancelled.operationState, 'cancelled'); assert.equal(cancelled.result.deviceOperation.operationState, 'cancelled');
    assert.equal(cancelled.result.deviceOperation.effects[0].state, 'cancelled'); assert.deepEqual(f.calls, []);
  } finally { await f.cleanup(); }
});

test('qualification investigates unverified support within its budget but does not promote fixture evidence', async () => {
  const f = await deviceFixture(); try {
    const cap = f.engine.devices.capability('install', f.context); f.journal.put('deviceCapability', cap.capabilityId, { ...cap, support: 'unverified', qualifiedAt: null, evidenceIds: [], reasonCodes: ['CAPABILITY_UNVERIFIED'] });
    assert.equal((await f.call('devices.install')).error.code, 'CAPABILITY_UNVERIFIED');
    const request = { ...f.args, plan: 'remote-wifi-install' }; const accepted = await f.call('devices.qualify', request);
    assert.equal(accepted.error, null, JSON.stringify(accepted)); assert.equal((await f.wait(accepted.operationId)).operationState, 'succeeded');
    assert.equal(f.engine.devices.capability('install', f.context).support, 'unverified');
    assert.equal((await f.call('devices.qualify', { ...request, requestId: randomUUID() })).error.code, 'QUALIFICATION_BUDGET_EXHAUSTED');
    assert.throws(() => f.engine.devices.promote(example('device-test-evidence'), true), /observed execution/);
    assert.throws(() => new Devices(f.journal, f.backend, 'fixture'), /Fixture backends/);
  } finally { await f.cleanup(); }
});

test('lease expiry cannot grant ownership and warm evidence never applies to cold cellular', async () => {
  const f = await deviceFixture(); try {
    const owner = f.engine.devices.ownership(f.device);
    f.engine.devices.saveOwnership({ ...owner, state: 'previous_owner_unconfirmed', mutationsPermitted: false, previousHostId: randomUUID(), ownerHostId: randomUUID(), priorSession: 'unknown', leaseExpiresAt: '2020-01-01T00:00:00Z', reasonCodes: ['PREVIOUS_OWNER_UNCONFIRMED'] });
    assert.equal((await f.call('devices.install')).error.code, 'PREVIOUS_OWNER_UNCONFIRMED');
    const cold = structuredClone(f.context); cold.network.scenario = 'cold_cellular'; cold.network.developerSession = 'fresh'; cold.network.phoneUnderlay = 'cellular';
    assert.equal(f.engine.devices.capability('install', cold).support, 'unverified');
    const status = await f.call('devices.status', { repo: f.repo.id, device: f.device, refresh: true }); assert.equal(status.error, null, JSON.stringify(status)); assertContract('device-status', status);
    assert.equal(status.result.ownership.mutationsPermitted, false); assert.equal(status.result.availability.find(item => item.operation === 'install').callable, false);
  } finally { await f.cleanup(); }
});
