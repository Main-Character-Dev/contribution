import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Journal } from '../packages/engine/dist/journal.js';
import { Engine } from '../packages/engine/dist/service.js';
import { digest } from '../packages/engine/dist/core.js';
import { assertContract, validateContract } from '../packages/contracts/dist/index.js';
import { repository, commit, git } from './integration/service.mjs';

async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'ct-build-')), store = new Journal(join(root, 'state')), path = repository(root);
  mkdirSync(join(path, 'App.xcodeproj')); writeFileSync(join(path, 'App.xcodeproj/project.pbxproj'), 'fixture project');
  git(path, 'add', 'App.xcodeproj/project.pbxproj');
  const tip = commit(path), device = 'device-offline-fixture', calls = { phone: 0, build: 0, host: 0 };
  const unavailable = async () => { calls.phone++; throw Error('The phone is offline; preparation must never query it'); };
  const backend = { recordMode: 'fixture', inventory: unavailable, observe: unavailable, perform: unavailable, reconcile: unavailable, verifyArtifact: unavailable, verifyInstalledApp: unavailable };
  const host = { hostId: store.hostId, model: null, architecture: 'arm64', macOSVersion: 'fixture-os', macOSBuild: 'fixture-build', xcodeVersion: '27.0', xcodeBuild: '27A266a' };
  const app = JSON.parse(readFileSync(new URL('../packages/contracts/examples/artifact-provenance.json', import.meta.url))).app;
  let duringBuild = async () => {};
  const driver = { recordMode: 'fixture', host: async () => { calls.host++; return structuredClone(host); },
    build: async (_repo, _config, _build, dir, deviceId, options) => {
      assert.notEqual(_repo.path, path, 'build must read its isolated committed snapshot');
      assert.equal(readFileSync(join(_repo.path, 'App.xcodeproj/project.pbxproj'), 'utf8'), 'fixture project');
      calls.build++; options.output?.('Fixture-only signed output\n'); await duringBuild(options);
      const appPath = join(dir, 'App.app'); mkdirSync(appPath); writeFileSync(join(appPath, 'binary'), 'fixture executable');
      return { appPath, app, signing: { mode: 'development', signatureVerified: true, provisioningVerified: true, entitlementsDigest: 'a'.repeat(64), provisioningProfileDigest: 'b'.repeat(64), eligibleDeviceRefs: [deviceId], verifiedAt: new Date().toISOString() }, evidence: { fixtureOnly: true } };
    }, archive: async (appPath, archivePath) => writeFileSync(archivePath, readFileSync(join(appPath, 'binary'))) };
  const engine = new Engine(store, { identity: 'fixture' }, undefined, { backend, mode: 'fixture', buildDriver: driver });
  store.setMeta('settings', { ...engine.settings(), remoteDevices: { enabled: true, maintainSession: false } });
  const repo = await engine.repos.add(path), config = { schemaVersion: 1, repositoryId: repo.id, adapterId: 'xcode-ios-v1', app, permitsForeground: false, eligibleDeviceRefs: [device], builds: [{ id: 'development', containerKind: 'project', containerPath: 'App.xcodeproj', scheme: 'Fixture', configuration: 'Debug', appName: 'App.app', developerDirectory: root, xcodeVersion: host.xcodeVersion, xcodeBuild: host.xcodeBuild, signingMode: 'development', provisioningProfileSpecifier: 'fixture-only', timeoutSeconds: 120 }] };
  const call = (command, args = {}) => engine.dispatch({ schemaVersion: 1, command, args, cwd: path });
  const registered = await call('devices.configure', { repo: repo.id, config, expectedRevision: 'none', requestId: randomUUID() }); assert.equal(registered.error, null, JSON.stringify(registered));
  const grant = await call('devices.authorize', { repo: repo.id, device, operations: ['prepare'], requestId: randomUUID() }); assert.equal(grant.error, null, JSON.stringify(grant));
  const args = { repo: repo.id, host: store.hostId, device, sourceTip: tip, buildProfile: 'development', requestId: randomUUID() };
  const wait = async op => { const deadline = Date.now() + 5000; while (Date.now() < deadline) { const result = await call('runs.get', { operationId: op }); if (!['queued', 'running'].includes(result.operationState)) return result; await new Promise(r => setTimeout(r, 10)); } throw Error('build timeout'); };
  return { root, path, repo, config, store, engine, backend, driver, calls, host, call, args, wait, duringBuild: fn => { duringBuild = fn; }, cleanup: async () => { engine.stopping = true; while (engine.active.size) await new Promise(r => setTimeout(r, 10)); store.close(); rmSync(root, { recursive: true }); } };
}

test('offline preparation retains an immutable artifact without observing, qualifying or owning the phone', async () => {
  const f = await setup(); try {
    const accepted = await f.call('devices.prepare', f.args); assert.equal(accepted.error, null, JSON.stringify(accepted));
    const result = await f.wait(accepted.operationId); assert.equal(result.operationState, 'succeeded', JSON.stringify(result));
    assertContract('device-operation', result.result.deviceOperation); assertContract('artifact-provenance', result.result.artifact);
    assert.equal(result.result.deviceOperation.context.network.scenario, 'unknown'); assert.equal(result.result.artifact.deviceAcceptance, 'not_established_by_preparation');
    const listed = await f.call('devices.artifacts.list', { repo: f.repo.id });
    assert.equal(listed.result.artifacts[0].provenance.artifactId, result.result.artifactRef.artifactId);
    assert.equal('path' in listed.result.artifacts[0], false);
    assert.equal(result.result.artifact.recordMode, 'fixture'); assert.equal(f.calls.phone, 0); assert.equal(f.calls.build, 1);
    const artifact = f.store.record('deviceArtifact', result.result.artifactRef.artifactId);
    const output = f.store.record('buildOutput', result.result.artifact.build.attemptId);
    assert.equal(output.phase, 'sealed'); assert.equal(output.operationId, accepted.operationId);
    assert(output.files.every(file => !file.path.startsWith(join(output.directory, 'source') + '/')));
    assert.equal(digest(readFileSync(artifact.path)), artifact.provenance.artifact.sha256); assert.equal(statSync(artifact.path).mode & 0o777, 0o400);
    assert.equal(f.engine.devices.ownership(f.args.device).state, 'unowned'); assert.equal(f.store.records('deviceCapability').length, 0);
    assert.equal((await f.call('devices.prepare', f.args)).operationId, accepted.operationId); assert.equal(f.calls.build, 1);
    assert.equal((await f.call('devices.authorize', { repo: f.repo.id, device: f.args.device, operations: ['install'], requestId: randomUUID() })).error.code, 'DEVICE_IDENTITY_REQUIRED');
  } finally { await f.cleanup(); }
});

test('queued offline builds stop on source, authorization or toolchain changes before executing a build', async () => {
  for (const changed of ['source', 'authorization', 'toolchain']) {
    const f = await setup(); try {
      await f.call('service.pause'); const accepted = await f.call('devices.prepare', f.args); assert.equal(accepted.error, null, JSON.stringify(accepted));
      if (changed === 'source') commit(f.path, 'new.txt', 'new source');
      if (changed === 'authorization') await f.call('devices.revoke', { repo: f.repo.id, device: f.args.device, operations: ['prepare'], requestId: randomUUID() });
      if (changed === 'toolchain') f.host.xcodeBuild = 'different';
      await f.call('service.resume'); const result = await f.wait(accepted.operationId);
      assert.equal(result.error.code, changed === 'source' ? 'SOURCE_CHANGED' : changed === 'authorization' ? 'AUTHORIZATION_DENIED' : 'BUILD_TOOLCHAIN_CHANGED');
      assert.equal(f.calls.build, 0); assert.equal(f.calls.phone, 0); assert.equal(f.engine.devices.ownership(f.args.device).state, 'unowned');
    } finally { await f.cleanup(); }
  }
});

test('build-time source drift and local build errors never publish an installable artifact or block phone ownership', async () => {
  for (const changed of ['source', 'failure', 'cancel']) {
    const f = await setup(); try {
      f.duringBuild(async options => {
        if (changed === 'source') writeFileSync(join(f.path, 'unrelated.txt'), 'preserve this new owner work');
        if (changed === 'failure') throw Error('fixture compiler failure');
        if (changed === 'cancel') await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true }));
      });
      const accepted = await f.call('devices.prepare', f.args); assert.equal(accepted.error, null);
      if (changed === 'cancel') { while (!f.calls.build) await new Promise(r => setTimeout(r, 10)); await f.call('runs.cancel', { operationId: accepted.operationId }); }
      const result = await f.wait(accepted.operationId);
      assert.notEqual(result.operationState, 'succeeded'); assert.notEqual(result.operationState, 'outcome_unknown');
      assert.equal(f.store.records('deviceArtifact').length, 0); assert.equal(f.calls.phone, 0); assert.equal(f.engine.devices.ownership(f.args.device).state, 'unowned');
      if (changed === 'source') assert.equal(readFileSync(join(f.path, 'unrelated.txt'), 'utf8'), 'preserve this new owner work');
    } finally { await f.cleanup(); }
  }
});

test('device build registration rejects unknown execution instructions and stale revisions', async () => {
  const f = await setup(); try {
    assert.equal(validateContract('device-profile', { ...f.config, shell: 'arbitrary command' }).valid, false);
    assert.equal(validateContract('device-profile', { ...f.config, builds: [{ ...f.config.builds[0], argv: ['/bin/sh'] }] }).valid, false);
    const request = { repo: f.repo.id, config: f.config, expectedRevision: 'none', requestId: randomUUID() };
    assert.equal((await f.call('devices.configure', request)).error.code, 'STALE_CONFIGURATION');
    const configured = await f.call('devices.profile', { repo: f.repo.id });
    const changed = { ...f.config, builds: [{ ...f.config.builds[0], containerPath: '../App.xcodeproj' }] };
    assert.equal((await f.call('devices.configure', { ...request, config: changed, expectedRevision: configured.result.revision })).error.code, 'BUILD_CONTAINER_INVALID');
    assert.equal(f.calls.phone, 0); assert.equal(f.calls.build, 0);
  } finally { await f.cleanup(); }
});

test('qualification plans register exact host/device context and finite scope without executing or granting it', async () => {
  const f = await setup(); try {
    const context = JSON.parse(readFileSync(new URL('../packages/contracts/examples/device-operation.json', import.meta.url))).context;
    context.host.hostId = f.store.hostId; context.device.deviceId = f.args.device;
    const plan = { id: 'install-proof', operation: 'install', fixtureId: 'meaningful-data-v1', acceptanceId: 'AT-02', expectedContext: context, maxAttempts: 2, maxDurationSeconds: 60 };
    const config = { ...f.config, qualificationPlans: [plan] }, prior = await f.call('devices.profile', { repo: f.repo.id });
    const registered = await f.call('devices.configure', { repo: f.repo.id, config, expectedRevision: prior.result.revision, requestId: randomUUID() }); assert.equal(registered.error, null, JSON.stringify(registered));
    const stored = f.engine.devices.profile(f.repo).plans['install-proof']; assert.deepEqual(stored.authorizedOperations, ['install']); assert.equal(stored.expectedContextDigest, digest(context));
    assert.equal(f.store.records('deviceCapability').length, 0); assert.equal(f.calls.phone, 0); assert.equal(f.calls.build, 0);
    for (const changed of [{ ...plan, maxAttempts: 4 }, { ...plan, shell: '/bin/sh' }, { ...plan, authorizedOperations: ['launch'] }]) assert.equal(validateContract('device-profile', { ...config, qualificationPlans: [changed] }).valid, false);
    const request = { repo: f.repo.id, expectedRevision: registered.result.revision, requestId: randomUUID() };
    const wrongHost = structuredClone(plan); wrongHost.expectedContext.host.hostId = randomUUID();
    assert.equal((await f.call('devices.configure', { ...request, config: { ...config, qualificationPlans: [wrongHost] } })).error.code, 'QUALIFICATION_CONTEXT_CHANGED');
    assert.equal((await f.call('devices.configure', { ...request, config: { ...config, qualificationPlans: [{ ...plan, acceptanceId: 'AT-08' }] } })).error.code, 'COLD_START_CONTEXT_REQUIRED');
  } finally { await f.cleanup(); }
});


test('restart reconciles only a sealed offline artifact, without another build or any phone access', async () => {
  const f = await setup(); let replacement;
  try {
    const accepted = await f.call('devices.prepare', f.args), result = await f.wait(accepted.operationId);
    assert.equal(result.operationState, 'succeeded', JSON.stringify(result));
    const op = f.store.get(accepted.operationId), receipt = structuredClone(result.result.deviceOperation);
    receipt.operationState = 'running'; receipt.effects[0].state = 'running';
    f.store.update(op, { state: 'running', effectDispatched: false, result: { deviceOperation: receipt } });
    f.engine.stopping = true;
    replacement = new Engine(f.store, { identity: 'fixture-next' }, undefined, { backend: f.backend, mode: 'fixture', buildDriver: f.driver });
    const retained = f.store.get(op.operationId); assert.equal(retained.state, 'interrupted'); assert.equal(retained.result.deviceOperation.effects[0].state, 'needs_attention');
    assert.equal(replacement.devices.ownership(f.args.device).state, 'unowned');
    const reconciled = await replacement.dispatch({ schemaVersion: 1, command: 'devices.reconcile', args: { operationId: op.operationId, requestId: randomUUID() }, cwd: f.path });
    assert.equal(reconciled.operationState, 'succeeded', JSON.stringify(reconciled));
    assert.deepEqual(reconciled.result.artifactRef, result.result.artifactRef); assert.equal(f.calls.build, 1); assert.equal(f.calls.phone, 0);
  } finally { if (replacement) replacement.stopping = true; await f.cleanup(); }
});

test('an identical completed request retains its original profile even after later profile registration', async () => {
  const f = await setup(); try {
    const accepted = await f.call('devices.prepare', f.args); await f.wait(accepted.operationId);
    const config = { ...f.config, permitsForeground: true }, prior = await f.call('devices.profile', { repo: f.repo.id });
    const registered = await f.call('devices.configure', { repo: f.repo.id, config, expectedRevision: prior.result.revision, requestId: randomUUID() }); assert.equal(registered.error, null);
    assert.equal((await f.call('devices.prepare', f.args)).operationId, accepted.operationId); assert.equal(f.calls.build, 1); assert.equal(f.calls.phone, 0);
  } finally { await f.cleanup(); }
});

test('an interrupted live build process blocks a new preparation until its identity is reconciled', async () => {
  const f = await setup(); try {
    const { processIdentity } = await import('../packages/engine/dist/process.js');
    await f.call('service.pause'); const accepted = await f.call('devices.prepare', f.args), op = f.store.get(accepted.operationId);
    const receipt = op.result.deviceOperation; receipt.operationState = 'interrupted';
    f.store.update(op, { state: 'interrupted', result: { ...op.result, deviceOperation: receipt, processes: [{ pid: process.pid, start: processIdentity(process.pid) }] } });
    const next = await f.call('devices.prepare', { ...f.args, requestId: randomUUID() });
    assert.equal(next.error.code, 'BUILD_PROCESS_UNRECONCILED'); assert.equal(f.calls.build, 0); assert.equal(f.calls.phone, 0);
    assert.equal((await f.call('devices.prepare', f.args)).operationId, op.operationId);
  } finally { await f.cleanup(); }
});
