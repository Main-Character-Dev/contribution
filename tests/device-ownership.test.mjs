import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Journal } from '../packages/engine/dist/journal.js';
import { Engine } from '../packages/engine/dist/service.js';
import { Fault } from '../packages/engine/dist/core.js';
import { assertContract } from '../packages/contracts/dist/index.js';
import { repository } from './integration/service.mjs';
const example = JSON.parse(readFileSync(new URL('../packages/contracts/examples/device-operation.json', import.meta.url), 'utf8'));

async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'ct-device-owner-')), engines = {}, observations = {}, releases = [], offline = new Set();
  let loseReply = false, loseCleanup = false;
  const transport = async (alias, envelope) => {
    if (offline.has(alias)) throw new Fault('PEER_UNAVAILABLE', 'Fixture host unavailable.', 3);
    const response = await engines[alias].dispatch({ schemaVersion: 1, command: 'peer.exchange', args: { envelope }, cwd: root });
    if (loseReply && envelope.action === 'device.ownership.accept' && !response.error) { loseReply = false; throw new Fault('PEER_UNAVAILABLE', 'Fixture acknowledgment lost.', 3); }
    if (response.error) throw new Fault(response.error.code, response.error.message, 3); return response.result;
  };
  const device = 'device-ownership-fixture';
  for (const name of ['source', 'target']) {
    const store = new Journal(join(root, name)), context = structuredClone(example.context); context.host.hostId = store.hostId; context.device.deviceId = device;
    const observation = { recordMode: 'fixture', deviceId: device, observedAt: new Date().toISOString(), context, trust: 'trusted', developerService: 'ready',
      session: name === 'source' ? 'owned' : 'none', externalSession: 'absent', signingReady: true, hostReady: true, reasonCodes: [] };
    observations[name] = observation;
    const backend = { recordMode: 'fixture', observe: async () => structuredClone(observation), inventory: async () => [], verifyArtifact: async () => {}, verifyInstalledApp: async () => {},
      perform: async () => { throw Error('Ownership transfer must not install, launch, test or pair.'); }, reconcile: async () => { throw Error('Not an effect fixture.'); },
      releaseOwnedSession: async () => { releases.push(name); observation.session = 'none'; if (loseCleanup) throw Error('Lost cleanup readback'); return { released: true, evidenceRefs: ['fixture-owned-session-release'] }; } };
    const cli = join(root, 'fixture-cli.js'); writeFileSync(cli, 'process.exit(3);');
    const engine = new Engine(store, { identity: 'fixture', node: process.execPath, cli }, transport, { backend, mode: 'fixture' }); engines[name] = engine;
    store.setMeta('settings', { ...engine.settings(), remoteDevices: { enabled: true, maintainSession: false } });
  }
  const call = (name, command, args = {}) => engines[name].dispatch({ schemaVersion: 1, command, args, cwd: root });
  for (const [name, alias] of [['source', 'target'], ['target', 'source']]) await call(name, 'hosts.pair', { sshAlias: alias });
  const sourceRepo = await engines.source.repos.add(repository(root, 'source-repo'));
  const targetRepo = await engines.target.repos.add(repository(root, 'target-repo'), undefined, undefined, sourceRepo.config);
  assert.equal((await call('source', 'repos.pair', { repo: sourceRepo.id, host: engines.target.store.hostId, requestId: randomUUID() })).error, null);
  for (const [name, engine] of Object.entries(engines)) engine.store.put('deviceProfile', sourceRepo.id, { repositoryId: sourceRepo.id, adapterId: 'fixture', revision: 'fixture-policy',
    app: example.intent.app, permitsForeground: false, configurations: [], buildProfiles: [], plans: {} });
  const owner = engines.source.devices.ownership(device);
  engines.source.devices.saveOwnership({ ...owner, ownerHostId: engines.source.store.hostId, state: 'owned', mutationsPermitted: true, priorSession: 'active', externalSession: 'absent', reasonCodes: [] });
  const args = { repo: sourceRepo.id, device, fromHost: engines.source.store.hostId, host: engines.target.store.hostId, expectedRevision: owner.revision, requestId: randomUUID() };
  const wait = async (name, id) => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) { const value = await call(name, 'runs.get', { operationId: id }); if (!['queued', 'running'].includes(value.operationState)) return value; await new Promise(r => setTimeout(r, 10)); }
    throw Error('Ownership fixture timeout');
  };
  const transfer = async (name = 'source', input = args) => { const admitted = await call(name, 'devices.transfer-host', input); assert.equal(admitted.error, null, JSON.stringify(admitted)); return wait(name, admitted.operationId); };
  return { engines, observations, releases, offline, call, wait, args, transfer, sourceRepo, targetRepo,
    loseReply: () => { loseReply = true; }, loseCleanup: () => { loseCleanup = true; },
    cleanup: async () => { for (const engine of Object.values(engines)) engine.stopping = true; while (Object.values(engines).some(e => e.active.size || e.peers.busy)) await new Promise(r => setTimeout(r, 10)); for (const e of Object.values(engines)) e.store.close(); rmSync(root, { recursive: true }); } };
}

test('ownership release fences the source, independently checks the destination and does not alter Git authority or grants', async () => {
  const f = await setup(); try {
    const result = await f.transfer(); assert.equal(result.operationState, 'succeeded', JSON.stringify(result));
    assert.deepEqual(f.releases, ['source']);
    const old = f.engines.source.devices.ownership(f.args.device), next = f.engines.target.devices.ownership(f.args.device);
    assertContract('device-ownership', old); assertContract('device-ownership', next);
    assert.equal(old.mutationsPermitted, false); assert.equal(next.mutationsPermitted, true); assert.equal(old.revision, next.revision);
    assert.equal(next.previousHostId, f.engines.source.store.hostId); assert.equal(f.engines.target.store.records('deviceGrant').length, 0);
    assert.equal(f.engines.source.repos.all()[0].canonicalHostId, f.engines.target.store.hostId);
    assert.equal((await f.call('source', 'devices.transfer-host', f.args)).operationId, result.operationId);
  } finally { await f.cleanup(); }
});

test('lost destination acknowledgment resumes the exact release without cleanup replay or granting both owners', async () => {
  const f = await setup(); try {
    f.loseReply(); const unknown = await f.transfer(); assert.equal(unknown.operationState, 'outcome_unknown');
    assert.equal(f.engines.source.devices.ownership(f.args.device).mutationsPermitted, false);
    const revision = f.engines.target.devices.ownership(f.args.device).revision;
    await f.call('source', 'hosts.retry', {host:f.engines.target.store.hostId}); await f.engines.source.peers.settledChecks();
    await f.call('source', 'devices.reconcile', { operationId: unknown.operationId, requestId: randomUUID() });
    const result = await f.wait('source', unknown.operationId); assert.equal(result.operationState, 'succeeded', JSON.stringify(result));
    assert.equal(f.engines.target.devices.ownership(f.args.device).revision, revision); assert.deepEqual(f.releases, ['source']);
  } finally { await f.cleanup(); }
});

test('an authenticated release can be consumed after the former Mac goes offline; an arbitrary reference cannot', async () => {
  const f = await setup(); try {
    f.observations.target.trust = 'unknown'; const stopped = await f.transfer(); assert.equal(stopped.operationState, 'outcome_unknown');
    assert.equal(f.engines.target.devices.ownership(f.args.device).mutationsPermitted, false);
    f.offline.add('source'); f.observations.target.trust = 'trusted';
    const args = { ...f.args, requestId: randomUUID(), releaseRef: f.args.requestId };
    assert.equal((await f.call('target', 'devices.transfer-host', { ...args, releaseRef: randomUUID() })).error.code, 'RELEASE_REFERENCE_REQUIRED');
    const result = await f.transfer('target', args); assert.equal(result.operationState, 'succeeded', JSON.stringify(result));
    assert.equal(f.engines.target.devices.ownership(f.args.device).mutationsPermitted, true); assert.deepEqual(f.releases, ['source']);
  } finally { await f.cleanup(); }
});

test('an offline destination leaves durable relinquishment; the former host never regains authority by expiry', async () => {
  const f = await setup(); try {
    f.offline.add('target'); const unknown = await f.transfer(); assert.equal(unknown.operationState, 'outcome_unknown');
    const owner = f.engines.source.devices.ownership(f.args.device); assert.equal(owner.state, 'unowned'); assert.equal(owner.mutationsPermitted, false);
    f.engines.source.devices.saveOwnership({ ...owner, leaseExpiresAt: '2020-01-01T00:00:00Z' });
    assert.equal((await f.call('source', 'devices.transfer-host', { ...f.args, requestId: randomUUID(), expectedRevision: owner.revision })).error.code, 'OWNERSHIP_REVISION_CONFLICT');
    f.offline.delete('target'); await f.call('source', 'hosts.retry', {host:f.engines.target.store.hostId}); await f.engines.source.peers.settledChecks(); await f.call('source', 'runs.reconcile', { operationId: unknown.operationId });
    assert.equal((await f.wait('source', unknown.operationId)).operationState, 'succeeded'); assert.deepEqual(f.releases, ['source']);
  } finally { await f.cleanup(); }
});

test('uncertain cleanup remains fenced and reconciliation observes instead of repeating it', async () => {
  const f = await setup(); try {
    f.loseCleanup(); const unknown = await f.transfer(); assert.equal(unknown.operationState, 'outcome_unknown');
    assert.equal(f.engines.source.devices.ownership(f.args.device).state, 'transfer_pending');
    f.observations.source.session = 'owned'; await f.call('source', 'devices.reconcile', { operationId: unknown.operationId, requestId: randomUUID() });
    assert.equal((await f.wait('source', unknown.operationId)).operationState, 'outcome_unknown'); assert.deepEqual(f.releases, ['source']);
    f.observations.source.session = 'none'; await f.call('source', 'devices.reconcile', { operationId: unknown.operationId, requestId: randomUUID() });
    assert.equal((await f.wait('source', unknown.operationId)).operationState, 'succeeded'); assert.deepEqual(f.releases, ['source']);
  } finally { await f.cleanup(); }
});

test('external sessions, unknown sessions, pending effects and conflicting ownership cannot be bypassed', async () => {
  for (const situation of ['source-external', 'source-unknown', 'target-owned', 'target-external', 'pending-effect']) {
    const f = await setup(); try {
      if (situation === 'source-external') f.observations.source.externalSession = 'present';
      if (situation === 'source-unknown') f.observations.source.session = 'unknown';
      if (situation === 'target-external') f.observations.target.externalSession = 'present';
      if (situation === 'target-owned') { const owner = f.engines.target.devices.ownership(f.args.device); f.engines.target.devices.saveOwnership({ ...owner, state: 'owned', ownerHostId: f.engines.target.store.hostId, mutationsPermitted: true }); }
      if (situation === 'pending-effect') { const owner = f.engines.source.devices.ownership(f.args.device); f.engines.source.devices.saveOwnership({ ...owner, activeOperationIds: ['fixture-uncertain-effect'] }); }
      const admitted = await f.call('source', 'devices.transfer-host', f.args);
      if (admitted.operationId) assert.notEqual((await f.wait('source', admitted.operationId)).operationState, 'succeeded');
      else assert.equal(admitted.error.code, 'DEVICE_BUSY');
      assert.equal(f.engines.target.store.record('deviceOwnershipAcceptance', f.args.requestId), undefined);
      if (situation.startsWith('source') || situation === 'pending-effect') assert.deepEqual(f.releases, []);
    } finally { await f.cleanup(); }
  }
});

test('return transfers advance the chain and an old accepted release never restores a former owner', async () => {
  const f = await setup(); try {
    assert.equal((await f.transfer()).operationState, 'succeeded');
    const oldRelease = f.engines.source.store.record('deviceOwnershipRelease', f.args.requestId);
    const reverse = { ...f.args, fromHost: f.args.host, host: f.args.fromHost, expectedRevision: oldRelease.revision, requestId: randomUUID() };
    assert.equal((await f.transfer('target', reverse)).operationState, 'succeeded');
    const sourceOwner = f.engines.source.devices.ownership(f.args.device), targetOwner = f.engines.target.devices.ownership(f.args.device);
    assert.equal(sourceOwner.mutationsPermitted, true); assert.equal(targetOwner.mutationsPermitted, false);
    await f.engines.source.peers.call(f.args.host, 'device.ownership.accept', { repositoryId: f.args.repo, release: oldRelease });
    assert.equal(f.engines.target.devices.ownership(f.args.device).revision, targetOwner.revision);
    assert.equal(f.engines.target.devices.ownership(f.args.device).mutationsPermitted, false);
  } finally { await f.cleanup(); }
});

test('restart retains the transfer fence and release while pause and disable defer new destination authority', async () => {
  const f = await setup(); try {
    await f.call('target', 'service.pause'); const unknown = await f.transfer(); assert.equal(unknown.operationState, 'outcome_unknown');
    assert.equal(f.engines.target.devices.ownership(f.args.device).mutationsPermitted, false);
    const previous = f.engines.source; previous.stopping = true;
    const op = previous.store.get(unknown.operationId); previous.store.update(op, { state: 'running' });
    f.engines.source = new Engine(previous.store, previous.payload, previous.peers.transport, { backend: previous.devices.backend, mode: 'fixture' });
    assert.equal(f.engines.source.store.get(op.operationId).state, 'outcome_unknown');
    assert.equal(f.engines.source.devices.ownership(f.args.device).mutationsPermitted, false);
    await f.call('target', 'service.resume');
    f.engines.target.store.setMeta('settings', { ...f.engines.target.settings(), remoteDevices: { enabled: false, maintainSession: false } });
    await f.call('source', 'devices.reconcile', { operationId: op.operationId, requestId: randomUUID() });
    assert.equal((await f.wait('source', op.operationId)).operationState, 'outcome_unknown');
    f.engines.target.store.setMeta('settings', { ...f.engines.target.settings(), remoteDevices: { enabled: true, maintainSession: false } });
    await f.call('source', 'devices.reconcile', { operationId: op.operationId, requestId: randomUUID() });
    assert.equal((await f.wait('source', op.operationId)).operationState, 'succeeded'); assert.deepEqual(f.releases, ['source']);
  } finally { await f.cleanup(); }
});

test('release receipts reject tampering and fixture authority at the authenticated receiver', async () => {
  const f = await setup(); try {
    assert.equal((await f.transfer()).operationState, 'succeeded');
    const release = f.engines.source.store.record('deviceOwnershipRelease', f.args.requestId);
    const send = value => f.engines.source.peers.call(f.args.host, 'device.ownership.accept', { repositoryId: f.args.repo, release: value });
    await assert.rejects(send({ ...release, revision: 'changed' }), e => e.code === 'REQUEST_ID_CONFLICT');
    await assert.rejects(send({ ...release, recordMode: 'observed' }), e => e.code === 'INVALID_OWNERSHIP_RELEASE');
    await assert.rejects(send({ ...release, toHostId: randomUUID() }), e => e.code === 'INVALID_OWNERSHIP_RELEASE');
    await assert.rejects(send({ ...release, executable: '/bin/sh' }), e => e.code === 'INVALID_OWNERSHIP_RELEASE');
  } finally { await f.cleanup(); }
});
