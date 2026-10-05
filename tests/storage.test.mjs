import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync, symlinkSync, linkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Journal } from '../packages/engine/dist/journal.js';
import { Engine } from '../packages/engine/dist/service.js';
import { StorageRetention, requireArtifactAvailable } from '../packages/engine/dist/storage.js';

const old = '2020-01-01T00:00:00.000Z';
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ct-storage-')), store = new Journal(root), storage = new StorageRetention(store);
  function artifact(state = 'succeeded', pinned = false, completedAt = old) {
    let op = store.admit(randomUUID(), 'device', randomUUID(), {}, 'fixture');
    op = store.update(op, { state, pinned, result: { completedAt } });
    const provenance = JSON.parse(readFileSync(new URL('../packages/contracts/examples/artifact-provenance.json', import.meta.url)));
    provenance.artifactId = randomUUID(); provenance.repositoryId = op.repositoryId; provenance.build.attemptId = op.attemptId; provenance.build.preparedAt = old;
    const directory = join(root, 'device-artifacts', provenance.artifactId), appPath = join(directory, 'Fixture.app'), path = join(directory, 'signed-app.zip');
    mkdirSync(appPath, { recursive: true }); writeFileSync(join(appPath, 'payload'), 'reproducible app'); writeFileSync(path, 'reproducible archive');
    const value = { provenance, path, appPath }; store.put('deviceArtifact', provenance.artifactId, value);
    return { op, value, directory };
  }
  return { root, store, storage, artifact, close: () => { store.close(); rmSync(root, { recursive: true }); } };
}

test('reviewed retention removes only old settled output, preserving provenance, immutable requests and unknown files', () => {
  const f = fixture(); try {
    const selected = f.artifact();
    const protectedArtifacts = [f.artifact('succeeded', true), f.artifact('queued'), f.artifact('outcome_unknown'), f.artifact('interrupted'), f.artifact('succeeded', false, new Date().toISOString()), f.artifact()];
    f.store.put('peerOperation', protectedArtifacts.at(-1).op.operationId, { awaitingAcknowledgement: true });
    const unknown = join(f.root, 'device-artifacts', randomUUID()); mkdirSync(unknown); writeFileSync(join(unknown, 'owner-notes'), 'preserve');
    const preview = f.storage.preview(); assert.equal(preview.candidates.length, 1); assert(existsSync(selected.value.path));
    const request = randomUUID(), result = f.storage.apply(preview.scopeToken, request);
    assert.deepEqual(result.removed, [`artifact:${selected.value.provenance.artifactId}`]); assert(!existsSync(selected.directory));
    for (const item of protectedArtifacts) assert(existsSync(item.value.path)); assert(existsSync(unknown));
    assert.deepEqual(f.store.record('deviceArtifact', selected.value.provenance.artifactId), selected.value);
    assert.equal(f.store.admit(selected.op.requestId, selected.op.kind, selected.op.repositoryId, selected.op.input, 'new-payload').operationId, selected.op.operationId);
    assert.deepEqual(f.storage.apply(preview.scopeToken, request), result);
    assert.throws(() => requireArtifactAvailable(f.store, selected.value), { code: 'ARTIFACT_EXPIRED' });
  } finally { f.close(); }
});

test('pinning, a newly queued dependency, changed files and dangling links invalidate a cleanup preview', () => {
  for (const change of ['pin', 'dependency', 'file', 'symlink']) {
    const f = fixture(); try {
      const selected = f.artifact(), preview = f.storage.preview();
      if (change === 'pin') f.store.update(selected.op, { pinned: true });
      if (change === 'dependency') f.store.admit(randomUUID(), 'artifact_transfer', selected.op.repositoryId, { artifactId: selected.value.provenance.artifactId }, 'fixture');
      if (change === 'file') writeFileSync(selected.value.path, 'changed');
      if (change === 'symlink') { unlinkSync(selected.value.path); symlinkSync(join(f.root, 'missing'), selected.value.path); }
      assert.throws(() => f.storage.apply(preview.scopeToken, randomUUID()), { code: 'STORAGE_SELECTION_CHANGED' });
      assert(existsSync(join(selected.value.appPath, 'payload'))); assert.equal(f.store.records('storageCleanup').length, 0);
    } finally { f.close(); }
  }
});

test('linked and unconfirmed output roots never become eligible', () => {
  for (const change of ['hardlink', 'symlink', 'fileRoot', 'wrongId']) {
    const f = fixture(); try {
      const selected = f.artifact();
      if (change === 'hardlink') linkSync(selected.value.path, join(f.root, 'shared'));
      if (change === 'symlink') symlinkSync(join(f.root, 'missing'), join(selected.directory, 'dangling'));
      if (change === 'fileRoot') { rmSync(selected.directory, { recursive: true }); writeFileSync(selected.directory, 'unconfirmed'); }
      if (change === 'wrongId') f.store.put('deviceArtifact', selected.value.provenance.artifactId, { ...selected.value, provenance: { ...selected.value.provenance, artifactId: randomUUID() } });
      assert.equal(f.storage.preview().candidates.length, 0); assert(existsSync(selected.directory));
    } finally { f.close(); }
  }
});

test('interrupted removal resumes only its retained scope and preserves new files until they are reconciled', () => {
  const f = fixture(); try {
    const selected = f.artifact(), preview = f.storage.preview(), requestId = randomUUID();
    const intent = { requestId, token: preview.scopeToken, preview: f.store.record('storagePreview', preview.scopeToken), completed: [], state: 'removing' };
    f.store.put('storageCleanup', requestId, intent); f.store.put('storageEviction', preview.candidates[0].key, { artifactId: selected.value.provenance.artifactId, directory: selected.directory, state: 'removing' });
    unlinkSync(join(selected.value.appPath, 'payload')); // Crash after one owned file was removed.
    assert.throws(() => requireArtifactAvailable(f.store, selected.value), { code: 'ARTIFACT_EXPIRED' });
    const newFile = join(selected.directory, 'new-unreviewed-output'); writeFileSync(newFile, 'preserve');
    assert.throws(() => f.storage.apply(preview.scopeToken, requestId), { code: 'STORAGE_SELECTION_CHANGED' }); assert(existsSync(newFile));
    assert.throws(() => f.storage.apply(f.storage.preview().scopeToken, randomUUID()), { code: 'STORAGE_CLEANUP_PENDING' });
    unlinkSync(newFile); // Fixture simulates explicit reconciliation of the added generated file.
    assert.deepEqual(f.storage.apply(preview.scopeToken, requestId).removed, [preview.candidates[0].key]);
    assert.equal(f.store.record('storageEviction', preview.candidates[0].key).state, 'removed'); assert(!existsSync(selected.directory));
  } finally { f.close(); }
});

test('legacy working output and sealed snapshots expire together while retained evidence remains readable', () => {
  const f = fixture(); try {
    let op = f.store.admit(randomUUID(), 'push', randomUUID(), {}, 'fixture'); op = f.store.update(op, { state: 'succeeded', result: { completedAt: old } });
    const directory = join(f.root, 'legacy-attempts', op.attemptId), snapshot = join(f.root, 'legacy-evidence', randomUUID());
    for (const path of [directory, snapshot]) { mkdirSync(path, { recursive: true }); writeFileSync(join(path, 'report.log'), 'retained gate output'); }
    f.store.put('legacyAttempt', op.attemptId, { operationId: op.operationId, attemptId: op.attemptId, repositoryId: op.repositoryId, paths: { directory } });
    f.store.put('legacyEvidence', op.attemptId, { snapshot, files: [{ digest: 'historical-digest' }] });
    const preview = f.storage.preview(); assert.equal(preview.candidates.length, 2); f.storage.apply(preview.scopeToken, randomUUID());
    assert(!existsSync(directory)); assert(!existsSync(snapshot)); assert.equal(f.store.record('legacyEvidence', op.attemptId).files[0].digest, 'historical-digest');
    assert.equal(f.store.response(op).result.outputRetention.length, 2);
  } finally { f.close(); }
});

test('service storage is explicit, rejects mixed selection and respects maintenance', async () => {
  const f = fixture(); try {
    f.artifact(); const engine = new Engine(f.store, { identity: 'fixture', node: process.execPath, cli: 'unused' });
    const call = args => engine.dispatch({ schemaVersion: 1, command: 'service.storage', args, cwd: f.root });
    const preview = await call({ preview: true }); assert.equal(preview.error, null);
    assert.equal((await call({ preview: true, requestId: randomUUID() })).error.code, 'INVALID_USAGE');
    f.store.setMeta('maintenance', true);
    assert.equal((await call({ scopeToken: preview.result.scopeToken, requestId: randomUUID() })).error.code, 'SERVICE_MAINTENANCE');
    f.store.setMeta('maintenance', false);
    assert.equal((await call({ scopeToken: preview.result.scopeToken, requestId: randomUUID() })).error, null);
  } finally { f.close(); }
});
