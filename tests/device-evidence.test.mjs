import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Journal } from '../packages/engine/dist/journal.js';
import { Engine } from '../packages/engine/dist/service.js';
import { digest } from '../packages/engine/dist/core.js';
import { assertContract } from '../packages/contracts/dist/index.js';
import { repository } from './integration/service.mjs';
const example = name => JSON.parse(readFileSync(new URL(`../packages/contracts/examples/${name}.json`, import.meta.url), 'utf8'));

// These tests inject synthetic observed-shaped rows solely to exercise validators.
// They never call a device backend or retain hardware acceptance evidence.
async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'ct-evidence-validator-')), store = new Journal(join(root, 'state'));
  const forbidden = async () => { throw Error('Evidence review must not contact a phone.'); };
  const backend = { recordMode: 'observed', supportedOperations: [], inventory: forbidden, observe: forbidden, perform: forbidden, reconcile: forbidden, verifyArtifact: forbidden, verifyInstalledApp: forbidden };
  const engine = new Engine(store, { identity: 'validator-fixture' }, undefined, { backend, mode: 'observed' });
  store.setMeta('settings', { ...engine.settings(), remoteDevices: { enabled: true, maintainSession: false } });
  const path = repository(root), repo = await engine.repos.add(path), receipt = example('device-operation'), context = receipt.context;
  context.host = { ...context.host, hostId: store.hostId, architecture: 'arm64', macOSVersion: 'synthetic', macOSBuild: 'synthetic', xcodeVersion: 'synthetic', xcodeBuild: 'synthetic' };
  context.device.iOSVersion = 'synthetic'; context.device.iOSBuild = 'synthetic'; context.engineVersion = 'synthetic';
  store.put('deviceProfile', repo.id, { repositoryId: repo.id, revision: 'synthetic', app: receipt.intent.app, plans: {} });
  const op = store.admit(randomUUID(), 'device', repo.id, { fixture: true }, 'validator-fixture');
  Object.assign(receipt, { recordMode: 'observed', operationId: op.operationId, requestId: op.requestId, repositoryId: repo.id, executionHostId: store.hostId,
    operationState: 'succeeded', stage: 'completed', resultCertainty: 'confirmed', reasonCodes: [], missingProof: [] });
  receipt.intent.operation = 'install'; receipt.intent.authorizedOperations = ['install']; receipt.intent.mode = 'qualification';
  receipt.intent.qualification = { acceptanceId: 'AT-02', fixtureId: 'synthetic-app-data', authorizedOperations: ['install'], maxAttempts: 1, maxDurationSeconds: 120, planId: 'synthetic-plan', expectedContextDigest: digest(context) };
  receipt.effects = [receipt.effects[0]];
  const ref = receipt.effects[0].evidenceRefs[0]; store.put('deviceReadback', ref, { operationId: op.operationId, observedAt: receipt.completedAt, value: receipt.effects[0].installReadback });
  assertContract('device-operation', receipt); store.update(op, { state: 'succeeded', result: { deviceOperation: receipt } });
  const evidence = { ...example('device-test-evidence'), recordMode: 'observed', evidenceId: 'synthetic-validator-evidence', acceptanceId: 'AT-02', context,
    evidenceKind: 'physical_device', executionStatus: 'executed', outcome: 'passed', startedAt: receipt.startedAt, completedAt: receipt.completedAt,
    observations: ['Synthetic validator row only; no hardware was used.'], operationIds: [op.operationId], evidenceRefs: [ref], dataRetention: 'passed', missingProof: [] };
  assertContract('device-test-evidence', evidence);
  const call = (command, args = {}) => engine.dispatch({ schemaVersion: 1, command, args, cwd: path });
  const record = value => call('devices.evidence.record', { repo: repo.id, config: value, requestId: randomUUID() });
  const review = value => call('devices.evidence.review', { repo: repo.id, evidence: value.evidenceId, expectedRevision: digest(value), requestId: randomUUID() });
  return { root, store, engine, repo, receipt, context, evidence, op, call, record, review, cleanup: () => { engine.stopping = true; store.close(); rmSync(root, { recursive: true }); } };
}

test('retaining an evidence report grants nothing; explicit exact-revision review validates the named operation only', async () => {
  const f = await setup(); try {
    const saved = await f.record(f.evidence); assert.equal(saved.error, null, JSON.stringify(saved)); assert.equal(saved.result.physicalSupport, 'not_promoted');
    assert.equal(f.engine.devices.capability('install', f.context).support, 'unverified');
    assert.equal((await f.call('devices.evidence.review', { repo: f.repo.id, evidence: f.evidence.evidenceId, expectedRevision: 'wrong', requestId: randomUUID() })).error.code, 'EVIDENCE_REVISION_CONFLICT');
    const result = await f.review(f.evidence); assert.equal(result.error, null, JSON.stringify(result));
    assert.equal(result.result.capability.operation, 'install'); assert.equal(f.engine.devices.capability('launch', f.context).support, 'unverified');
    const second = await f.review(f.evidence); assert.deepEqual(second.result.capability, result.result.capability);
    const inspection = await f.call('devices.evidence.get', { repo: f.repo.id, evidence: f.evidence.evidenceId }); assert.equal(inspection.result.reviewed, true);
    assert.equal((await f.record({ ...f.evidence, observations: ['changed report'] })).error.code, 'EVIDENCE_ID_CONFLICT');
  } finally { f.cleanup(); }
});

test('wrong operation, case, context, references, certainty, time window and missing data proof never become supported', async () => {
  for (const changed of ['operation', 'acceptance', 'readback', 'uncertain', 'time', 'context', 'retention', 'routine', 'foreign-operation']) {
    const f = await setup(); try {
      const evidence = structuredClone(f.evidence), receipt = structuredClone(f.receipt);
      if (changed === 'operation') evidence.operation = 'logs';
      if (changed === 'acceptance') evidence.acceptanceId = 'AT-03';
      if (changed === 'readback') evidence.evidenceRefs = ['invented-readback'];
      if (changed === 'uncertain') receipt.resultCertainty = 'uncertain';
      if (changed === 'time') evidence.startedAt = '2026-10-04T23:01:00Z';
      if (changed === 'context') evidence.context.backend.revision = 'different';
      if (changed === 'retention') evidence.dataRetention = 'not_tested';
      if (changed === 'routine') { receipt.intent.mode = 'routine'; receipt.intent.qualification = null; }
      f.store.update(f.store.get(f.op.operationId), { result: { deviceOperation: receipt }, ...(changed === 'foreign-operation' ? { repositoryId: randomUUID() } : {}) });
      const saved = await f.record(evidence);
      if (changed === 'foreign-operation') assert.equal(saved.error.code, 'EVIDENCE_SCOPE_MISMATCH');
      else { assert.equal(saved.error, null, JSON.stringify(saved)); assert.notEqual((await f.review(evidence)).error, null, changed); }
      assert.equal(f.engine.devices.capability(evidence.operation, evidence.context).support, 'unverified');
    } finally { f.cleanup(); }
  }
});

test('missing version observations and fixture reports cannot promote physical capability', async () => {
  const f = await setup(); try {
    const incomplete = structuredClone(f.evidence); incomplete.context.device.iOSBuild = null;
    assert.equal((await f.record(incomplete)).error, null); assert.equal((await f.review(incomplete)).error.code, 'QUALIFICATION_CONTEXT_INCOMPLETE');
    const fixture = example('device-test-evidence'); fixture.context.host.hostId = f.store.hostId;
    assert.equal((await f.record(fixture)).error.code, 'FIXTURE_AUTHORITY_REJECTED');
    assert.equal(f.store.records('deviceCapability').length, 0);
  } finally { f.cleanup(); }
});

test('cellular restart qualification needs explicit cold-start and the named restart proof', async () => {
  for (const acceptanceId of ['AT-09', 'AT-10']) {
    const f = await setup(); try {
      const evidence = structuredClone(f.evidence), receipt = structuredClone(f.receipt);
      evidence.acceptanceId = acceptanceId; evidence.context.network.scenario = 'cold_cellular'; evidence.context.network.phoneUnderlay = 'cellular';
      evidence.coldStartProof = { priorDeveloperSessionAbsent: true, usableWifiAbsent: true, usbAbsent: true, phoneCellularConfirmed: true, restartKind: 'none' };
      receipt.context = structuredClone(evidence.context); receipt.intent.qualification.acceptanceId = acceptanceId; receipt.intent.qualification.expectedContextDigest = digest(receipt.context);
      f.store.update(f.store.get(f.op.operationId), { result: { deviceOperation: receipt } });
      assert.equal((await f.record(evidence)).error, null); assert.equal((await f.review(evidence)).error.code, 'RESTART_PROOF_REQUIRED');
      const corrected = { ...evidence, evidenceId: evidence.evidenceId + '-corrected', coldStartProof: { ...evidence.coldStartProof, restartKind: acceptanceId === 'AT-09' ? 'phone' : 'host' } };
      assert.equal((await f.record(corrected)).error, null); assert.equal((await f.review(corrected)).error, null);
    } finally { f.cleanup(); }
  }
});
