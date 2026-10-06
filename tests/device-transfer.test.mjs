import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, statSync, renameSync, symlinkSync, linkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Journal } from '../packages/engine/dist/journal.js';
import { Engine } from '../packages/engine/dist/service.js';
import { digest, Fault } from '../packages/engine/dist/core.js';
import { appTreeDigest } from '../packages/engine/dist/device-artifacts.js';
import { StorageRetention } from '../packages/engine/dist/storage.js';
import { repository } from './integration/service.mjs';

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ct-artifact-')), hosts = {}, calls = [], phoneCalls = [];
  let intercept = async () => {}, lose = '';
  const transport = async (alias, envelope) => {
    calls.push({ action: envelope.action, offset: envelope.body.offset }); await intercept(alias, envelope);
    const result = await hosts[alias].dispatch({ schemaVersion: 1, command: 'peer.exchange', args: { envelope }, cwd: root });
    if (lose === envelope.action) { lose = ''; throw new Fault('PEER_UNAVAILABLE', 'Fixture lost reply after delivery.', 3); }
    if (result.error) throw new Fault(result.error.code, result.error.message, 3); return result.result;
  };
  const unavailable = async () => { phoneCalls.push('unexpected'); throw Error('No physical backend action is permitted during transfer'); };
  for (const name of ['laptop', 'mini']) {
    const store = new Journal(join(root, name)), backend = { recordMode: 'fixture', inventory: unavailable, observe: unavailable, perform: unavailable, reconcile: unavailable, verifyArtifact: unavailable, verifyInstalledApp: unavailable };
    const payload = { identity: 'fixture', node: process.execPath, cli: join(root, 'fixture.js') }; writeFileSync(payload.cli, 'process.exit(3)');
    hosts[name] = new Engine(store, payload, transport, { backend, mode: 'fixture' });
    store.setMeta('settings', { ...hosts[name].settings(), remoteDevices: { enabled: true, maintainSession: false } });
  }
  const call = (name, command, args = {}) => hosts[name].dispatch({ schemaVersion: 1, command, args, cwd: root });
  await call('laptop', 'hosts.pair', { sshAlias: 'mini' }); await call('mini', 'hosts.pair', { sshAlias: 'laptop' });
  const config = (await call('laptop', 'repos.add', { path: repository(root, 'left') })).result.repository.config;
  assert.equal((await call('mini', 'repos.add', { path: repository(root, 'right'), config })).error, null);
  assert.equal((await call('laptop', 'repos.pair', { repo: config.repositoryId, host: hosts.mini.store.hostId, requestId: randomUUID() })).error, null);
  const provenance = JSON.parse(readFileSync(new URL('../packages/contracts/examples/artifact-provenance.json', import.meta.url)));
  provenance.repositoryId = config.repositoryId; provenance.build.hostId = hosts.laptop.store.hostId;
  const appPath = join(root, 'App.app'), path = join(root, 'signed-app.zip'); mkdirSync(appPath);
  writeFileSync(join(appPath, 'payload'), randomBytes(600000)); execFileSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', '--norsrc', appPath, path]);
  provenance.artifact.sha256 = digest(readFileSync(path)); provenance.artifact.bytes = statSync(path).size; provenance.artifact.format = 'signed_app_archive';
  hosts.laptop.store.put('deviceArtifact', provenance.artifactId, { provenance, path, appPath, appDigest: appTreeDigest(appPath) });
  for (const engine of Object.values(hosts)) {
    engine.store.put('deviceProfile', config.repositoryId, { repositoryId: config.repositoryId, app: provenance.app, revision: 'fixture-project-policy', adapterId: 'fixture', permitsForeground: false, configurations: [], buildProfiles: [], plans: {} });
    engine.store.put('deviceBuildProfile', config.repositoryId, { config: { eligibleDeviceRefs: provenance.signing.eligibleDeviceRefs }, revision: 'fixture-project-policy' });
  }
  const args = { repo: config.repositoryId, artifact: provenance.artifactId, toHost: hosts.mini.store.hostId, requestId: randomUUID() };
  const wait = async (name, operationId) => { const deadline = Date.now() + 5000; while (Date.now() < deadline) { const result = await call(name, 'runs.get', { operationId }); if (!['queued', 'running'].includes(result.operationState)) return result; await new Promise(r => setTimeout(r, 10)); } throw Error('transfer timeout'); };
  return { root, hosts, call, args, wait, calls, phoneCalls, provenance, path, appPath, lose: action => { lose = action; }, intercept: fn => { intercept = fn; },
    cleanup: async () => { for (const engine of Object.values(hosts)) engine.stopping = true; while (Object.values(hosts).some(engine => engine.active.size)) await new Promise(r => setTimeout(r, 10)); for (const engine of Object.values(hosts)) engine.store.close(); rmSync(root, { recursive: true }); } };
}

test('paired artifact transfer retains exact bytes/provenance independently of Git owner and never invokes the phone', async () => {
  const f = await fixture(); try {
    const accepted = await f.call('laptop', 'devices.artifacts.transfer', f.args), result = await f.wait('laptop', accepted.operationId);
    assert.equal(result.operationState, 'succeeded', JSON.stringify(result)); assert.equal(result.result.phoneEffect, 'not_requested');
    const received = f.hosts.mini.store.record('deviceArtifact', f.provenance.artifactId);
    assert.deepEqual(received.provenance, f.provenance); assert.equal(digest(readFileSync(received.path)), f.provenance.artifact.sha256); assert.equal(appTreeDigest(received.appPath), appTreeDigest(f.appPath));
    assert.equal((await f.call('laptop', 'devices.artifacts.transfer', f.args)).operationId, accepted.operationId);
    const canonical = { repo: f.args.repo, artifact: f.args.artifact, requestId: f.args.requestId, fromHost: f.hosts.laptop.store.hostId, host: f.hosts.mini.store.hostId };
    assert.equal((await f.call('laptop', 'devices.artifacts.transfer', canonical)).operationId, accepted.operationId);
    assert.equal((await f.call('laptop', 'devices.artifacts.transfer', { ...canonical, fromHost: f.hosts.mini.store.hostId })).error.code, 'REQUEST_ID_CONFLICT');
    assert.equal(f.hosts.laptop.repos.all()[0].canonicalHostId, f.hosts.mini.store.hostId);
    const reverse = await f.call('mini', 'devices.artifacts.transfer', { ...f.args, toHost: f.hosts.laptop.store.hostId, requestId: randomUUID() });
    assert.equal((await f.wait('mini', reverse.operationId)).operationState, 'succeeded'); assert.deepEqual(f.phoneCalls, []);
    assert.equal(f.hosts.mini.store.records('deviceOwnership').length, 0);
  } finally { await f.cleanup(); }
});

test('lost chunk and final replies resume the same retained transfer and receipt without duplicate device effects', async () => {
  for (const action of ['artifact.chunk', 'artifact.finish']) {
    const f = await fixture(); try {
      f.lose(action); const accepted = await f.call('laptop', 'devices.artifacts.transfer', f.args), stopped = await f.wait('laptop', accepted.operationId);
      assert.equal(stopped.operationState, action === 'artifact.finish' ? 'outcome_unknown' : 'waiting', JSON.stringify(stopped));
      await f.call('laptop', 'hosts.retry', {host:f.hosts.mini.store.hostId}); await f.hosts.laptop.peers.settledChecks();
      await f.call('laptop', 'runs.reconcile', { operationId: accepted.operationId });
      const recovered = await f.wait('laptop', accepted.operationId); assert.equal(recovered.operationState, 'succeeded', JSON.stringify(recovered));
      assert.equal(f.hosts.mini.store.records('artifactIncoming').length, 1); assert.equal(f.hosts.mini.store.records('deviceArtifact').length, 1);
      assert.equal(f.calls.filter(call => call.action === 'artifact.finish').length, 1);
      assert.equal(f.calls.filter(call => call.action === 'artifact.chunk' && call.offset === 0).length, 1, 'resume observes the retained offset after a lost acknowledgment');
      assert.deepEqual(f.phoneCalls, []);
    } finally { await f.cleanup(); }
  }
});

test('changed destination scope, corrupt bytes and fixture mode mismatch cannot become accepted artifacts', async () => {
  for (const condition of ['policy', 'bytes', 'mode']) {
    const f = await fixture(); try {
      let changed = false;
      f.intercept(async (_alias, envelope) => {
        if (condition === 'mode' && envelope.action === 'artifact.begin') envelope.body.manifest = { ...envelope.body.manifest, provenance: { ...envelope.body.manifest.provenance, recordMode: 'observed' } };
        if (condition === 'bytes' && !changed && envelope.action === 'artifact.chunk') { const data = Buffer.from(envelope.body.data, 'base64'); data[0] ^= 1; envelope.body.data = data.toString('base64'); changed = true; }
        if (condition === 'policy' && envelope.action === 'artifact.chunk' && envelope.body.offset > 0) {
          const profile = f.hosts.mini.store.record('deviceProfile', f.args.repo); f.hosts.mini.store.put('deviceProfile', f.args.repo, { ...profile, revision: 'changed-after-admission' });
        }
      });
      const accepted = await f.call('laptop', 'devices.artifacts.transfer', f.args), result = await f.wait('laptop', accepted.operationId);
      assert.notEqual(result.operationState, 'succeeded'); assert.equal(f.hosts.mini.store.records('deviceArtifact').length, 0); assert.deepEqual(f.phoneCalls, []);
    } finally { await f.cleanup(); }
  }
});

test('concurrent transfers keep independent immutable attempt logs while selecting the same artifact', async () => {
  const f = await fixture(); try {
    const first = await f.call('laptop', 'devices.artifacts.transfer', f.args), second = await f.call('laptop', 'devices.artifacts.transfer', { ...f.args, requestId: randomUUID() });
    assert.equal((await f.wait('laptop', first.operationId)).operationState, 'succeeded'); assert.equal((await f.wait('laptop', second.operationId)).operationState, 'succeeded');
    const a = await f.call('laptop', 'logs', { operationId: first.operationId }), b = await f.call('laptop', 'logs', { operationId: second.operationId });
    assert.notEqual(a.result.attemptId, b.result.attemptId); assert.match(a.result.text, /bytes acknowledged/); assert.match(b.result.text, /bytes acknowledged/);
    assert.equal(f.hosts.mini.store.records('artifactIncoming').length, 2); assert.deepEqual(f.phoneCalls, []);
  } finally { await f.cleanup(); }
});

test('a lost completion receipt remains observable after later receiver scope revocation', async () => {
  const f = await fixture(); try {
    f.lose('artifact.finish'); const accepted = await f.call('laptop', 'devices.artifacts.transfer', f.args);
    assert.equal((await f.wait('laptop', accepted.operationId)).operationState, 'outcome_unknown');
    const receiver = f.hosts.mini, settings = receiver.settings(); settings.remoteDevices.enabled = false; receiver.store.setMeta('settings', settings);
    const profile = receiver.store.record('deviceProfile', f.args.repo); receiver.store.put('deviceProfile', f.args.repo, { ...profile, revision: 'revoked-later' });
    await f.call('laptop', 'hosts.retry', {host:f.hosts.mini.store.hostId}); await f.hosts.laptop.peers.settledChecks();
    await f.call('laptop', 'runs.reconcile', { operationId: accepted.operationId });
    assert.equal((await f.wait('laptop', accepted.operationId)).operationState, 'succeeded');
    assert.equal(f.calls.filter(call => call.action === 'artifact.finish').length, 1); assert.deepEqual(f.phoneCalls, []);
    const another = await f.call('laptop', 'devices.artifacts.transfer', { ...f.args, requestId: randomUUID() });
    assert.equal((await f.wait('laptop', another.operationId)).operationState, 'waiting');
  } finally { await f.cleanup(); }
});

test('expiration releases completed incoming storage while preserving lost-reply receipts and preventing reuse for a new effect', async () => {
  const f = await fixture(); try {
    const admitted = await f.call('laptop', 'devices.artifacts.transfer', f.args); assert.equal((await f.wait('laptop', admitted.operationId)).operationState, 'succeeded');
    const receiver = f.hosts.mini, incoming = receiver.store.records('artifactIncoming')[0], repo = receiver.repos.all()[0];
    receiver.store.put('artifactIncoming', incoming.manifest.transferId, { ...incoming, accepted: { ...incoming.accepted, retainedAt: '2020-01-01T00:00:00.000Z' } });
    const retained = receiver.store.record('artifactIncoming', incoming.manifest.transferId).accepted, storage = new StorageRetention(receiver.store), preview = storage.preview();
    assert.equal(preview.candidates.length, 1); storage.apply(preview.scopeToken, randomUUID());
    const replay = await receiver.artifacts.receive(repo, f.hosts.laptop.store.hostId, 'artifact.begin', { transferId: incoming.manifest.transferId, manifest: incoming.manifest });
    assert.deepEqual(replay.accepted, retained); assert.equal(replay.offset, f.provenance.artifact.bytes);
    assert.deepEqual(await receiver.artifacts.receive(repo, f.hosts.laptop.store.hostId, 'artifact.finish', { transferId: incoming.manifest.transferId }), retained);
    const listed = await f.call('mini', 'devices.artifacts.get', { repo: f.args.repo, artifact: f.args.artifact });
    assert.equal(listed.result.artifacts[0].archiveAvailable, false); assert.equal(listed.result.artifacts[0].retention.state, 'removed');
    const fresh = await f.call('mini', 'devices.artifacts.transfer', { ...f.args, toHost: f.hosts.laptop.store.hostId, requestId: randomUUID() });
    assert.equal(fresh.error.code, 'ARTIFACT_EXPIRED'); assert.deepEqual(f.phoneCalls, []);
  } finally { await f.cleanup(); }
});

test('incoming quota is released by confirmed cleanup, not by a missing archive or a partial removal', async () => {
  const f = await fixture(); try {
    const admitted = await f.call('laptop', 'devices.artifacts.transfer', f.args); await f.wait('laptop', admitted.operationId);
    const receiver = f.hosts.mini, incoming = receiver.store.records('artifactIncoming')[0], repo = receiver.repos.all()[0];
    // Model a completed maximum-size reservation without allocating gigabytes.
    incoming.manifest.provenance.artifact.bytes = 1024 ** 3; incoming.accepted.retainedAt = '2020-01-01T00:00:00.000Z';
    receiver.store.put('artifactIncoming', incoming.manifest.transferId, incoming);
    const manifest = structuredClone(incoming.manifest); manifest.transferId = randomUUID(); manifest.requestId = randomUUID(); manifest.provenance.artifactId = randomUUID();
    const begin = () => receiver.artifacts.receive(repo, f.hosts.laptop.store.hostId, 'artifact.begin', { transferId: manifest.transferId, manifest });
    await assert.rejects(begin, { code: 'ARTIFACT_STORAGE_QUOTA' });
    const archive = readFileSync(incoming.path); rmSync(incoming.path);
    await assert.rejects(begin, { code: 'ARTIFACT_STORAGE_QUOTA' }); writeFileSync(incoming.path, archive);
    const storage = new StorageRetention(receiver.store), preview = storage.preview(), requestId = randomUUID();
    receiver.store.put('storageEviction', `incoming:${incoming.manifest.transferId}`, { state: 'removing', requestId });
    await assert.rejects(begin, { code: 'ARTIFACT_STORAGE_QUOTA' });
    storage.apply(preview.scopeToken, requestId); assert.equal((await begin()).offset, 0);
    assert.deepEqual(f.phoneCalls, []);
  } finally { await f.cleanup(); }
});


test('archive transfer refuses source replacement after acknowledgment and preserves foreign incoming files', async () => {
  for (const change of ['source', 'replace', 'symbolic', 'hardlink']) {
    const f = await fixture(); try {
      let changed = false, foreign;
      f.intercept(async (_alias, envelope) => {
        if (changed || envelope.action !== 'artifact.chunk' || envelope.body.offset === 0) return;
        changed = true;
        if (change === 'source') { const bytes = readFileSync(f.path); renameSync(f.path, f.path + '-original'); writeFileSync(f.path, bytes); return; }
        const incoming = f.hosts.mini.store.records('artifactIncoming')[0]; foreign = incoming.path;
        if (change === 'hardlink') linkSync(incoming.path, incoming.path + '-shared');
        else {
          renameSync(incoming.path, incoming.path + '-original');
          if (change === 'replace') writeFileSync(incoming.path, 'foreign', { mode: 0o600 });
          else { writeFileSync(incoming.path + '-foreign', 'foreign'); symlinkSync(incoming.path + '-foreign', incoming.path); }
        }
      });
      const accepted = await f.call('laptop', 'devices.artifacts.transfer', f.args), result = await f.wait('laptop', accepted.operationId);
      assert.equal(changed, true); assert.notEqual(result.operationState, 'succeeded');
      assert.equal(f.calls.filter(call => call.action === 'artifact.finish').length, 0);
      assert.equal(f.hosts.mini.store.records('deviceArtifact').length, 0); assert.deepEqual(f.phoneCalls, []);
      if (foreign && change !== 'hardlink') assert.equal(readFileSync(foreign, 'utf8'), 'foreign');
    } finally { await f.cleanup(); }
  }
});
