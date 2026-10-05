import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Journal } from '../packages/engine/dist/journal.js';
import { Engine } from '../packages/engine/dist/service.js';
import { GitBundleRetention } from '../packages/engine/dist/git-bundle-retention.js';
import { incomingFileIdentity } from '../packages/engine/dist/incoming-file.js';
import { completionReceipt } from '../packages/engine/dist/peer-receipts.js';
import { repository, commit, git } from './integration/service.mjs';

const old = () => new Date(Date.now() - 31 * 86400000).toISOString();
async function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'ct-bundle-retention-'))), primary = repository(root), base = commit(primary);
  const store = new Journal(join(root, 'state')), engine = new Engine(store, { identity: 'fixture', node: process.execPath, cli: '/fixture/cli' });
  store.setMeta('paused', true); const repo = await engine.repos.add(primary), task = join(root, 'task');
  git(primary, 'worktree', 'add', '--detach', task, base); const tip = commit(task, 'completed.txt');
  let op = await engine.workflows.capture(repo, randomUUID(), task, tip, base, { schemaVersion: 1 });
  op = store.update(op, { state: 'succeeded', result: { completedAt: old() } });
  const capture = store.record('capture', op.requestId), cleanup = new GitBundleRetention(store);
  const call = args => engine.dispatch({ schemaVersion: 1, command: 'service.storage', args, cwd: root });
  return { root, primary, base, store, engine, repo, task, tip, op, capture, cleanup, call,
    close: () => { store.close(); fs.rmSync(root, { recursive: true }); } };
}

test('reviewed bundle retirement preserves source refs, dirty native tasks, immutable completion and request replay', async () => {
  const f = await fixture(); try {
    fs.writeFileSync(join(f.task, 'unrelated.txt'), 'keep draft'); const receipt = completionReceipt(f.store.response(f.op));
    const preview = await f.call({ bundles: true, preview: true }); assert.equal(preview.error, null); assert.equal(preview.result.candidates.length, 1);
    assert.equal(preview.result.eligibleBytes, fs.statSync(f.capture.bundle).size);
    const requestId = randomUUID(), result = await f.call({ bundles: true, scopeToken: preview.result.scopeToken, requestId }); assert.equal(result.error, null, JSON.stringify(result));
    assert(!fs.existsSync(f.capture.bundle)); assert.equal(git(f.primary, 'rev-parse', f.capture.retention), f.tip);
    assert.equal(git(f.task, 'rev-parse', 'HEAD'), f.tip); assert.equal(fs.readFileSync(join(f.task, 'unrelated.txt'), 'utf8'), 'keep draft');
    assert.deepEqual(completionReceipt(f.store.response(f.op)), receipt); assert.equal(f.store.response(f.op).result.outputRetention[0].state, 'removed');
    assert.equal(f.store.existing(f.op.requestId, f.op.kind, f.op.repositoryId, f.op.input).operationId, f.op.operationId);
    assert.deepEqual((await f.call({ bundles: true, scopeToken: preview.result.scopeToken, requestId })).result, result.result);
    const replay = await f.engine.workflows.capture(f.repo, f.op.requestId, f.task, f.tip, f.base, { schemaVersion: 1 });
    assert.equal(replay.operationId, f.op.operationId); assert(!fs.existsSync(f.capture.bundle));
  } finally { f.close(); }
});

test('failed, unresolved, pinned, unacknowledged and unretained history never becomes an eligible transport copy', async () => {
  for (const mode of ['failed', 'outcome_unknown', 'pinned', 'peer', 'missing-ref', 'changed-ref', 'unrecorded', 'unfinished-producer']) {
    const f = await fixture(); try {
      if (['failed', 'outcome_unknown'].includes(mode)) f.store.update(f.op, { state: mode });
      if (mode === 'pinned') f.store.update(f.op, { pinned: true });
      if (mode === 'peer') f.store.update(f.op, { result: { ...f.op.result, remoteOperationId: randomUUID(), canonicalHostId: randomUUID() } });
      if (mode === 'missing-ref') git(f.primary, 'update-ref', '-d', f.capture.retention);
      if (mode === 'changed-ref') git(f.primary, 'update-ref', f.capture.retention, f.base);
      if (mode === 'unrecorded') f.store.put('bundleProduction', f.op.requestId, { path: f.capture.bundle });
      if (mode === 'unfinished-producer') f.store.put('bundleProduction', f.op.requestId, { ...f.store.record('bundleProduction', f.op.requestId), state: 'publishing' });
      const preview = await f.cleanup.preview(); assert.equal(preview.candidates.length, 0, mode); assert.equal(preview.protected.length, 1, mode);
      assert(fs.existsSync(f.capture.bundle));
    } finally { f.close(); }
  }
});

test('stale reviews preserve modified, replaced, shared and linked files and replaced parent directories', async () => {
  for (const mode of ['bytes', 'replacement', 'shared', 'link', 'parent']) {
    const f = await fixture(); try {
      const preview = await f.cleanup.preview(); assert.equal(preview.candidates.length, 1);
      if (mode === 'bytes') fs.appendFileSync(f.capture.bundle, 'changed');
      if (mode === 'replacement') { fs.renameSync(f.capture.bundle, `${f.capture.bundle}.owned`); fs.writeFileSync(f.capture.bundle, 'foreign'); }
      if (mode === 'shared') fs.linkSync(f.capture.bundle, `${f.capture.bundle}.shared`);
      if (mode === 'link') { fs.renameSync(f.capture.bundle, `${f.capture.bundle}.owned`); fs.symlinkSync(`${f.capture.bundle}.owned`, f.capture.bundle); }
      if (mode === 'parent') { fs.renameSync(join(f.store.directory, 'transfers'), join(f.store.directory, 'old-transfers')); fs.symlinkSync('old-transfers', join(f.store.directory, 'transfers')); }
      const bytes = fs.readFileSync(f.capture.bundle);
      await assert.rejects(f.cleanup.apply(preview.scopeToken, randomUUID()));
      assert.deepEqual(fs.readFileSync(f.capture.bundle), bytes, mode); assert.equal(git(f.primary, 'rev-parse', f.capture.retention), f.tip);
    } finally { f.close(); }
  }
});

test('loss after unlink retains the same cleanup fence and completes after reopening without recreating output', async t => {
  const f = await fixture(); let recovered;
  try {
    const preview = await f.cleanup.preview(), requestId = randomUUID(), unlink = fs.unlinkSync;
    const mock = t.mock.method(fs, 'unlinkSync', path => { unlink(path); throw new Error('fixture crash after exact unlink'); }); syncBuiltinESMExports();
    await assert.rejects(f.cleanup.apply(preview.scopeToken, requestId), /fixture crash/); mock.mock.restore(); syncBuiltinESMExports();
    assert(!fs.existsSync(f.capture.bundle)); assert.equal(f.store.record('gitBundleCleanup', requestId).state, 'removing');
    assert.throws(() => f.store.admit(randomUUID(), 'checks', f.repo.id, {}, 'fixture'), { code: 'STORAGE_CLEANUP_PENDING' });
    f.store.setMeta('maintenance', true);
    const held = await f.call({ bundles: true, scopeToken: preview.scopeToken, requestId }); assert.equal(held.error.code, 'SERVICE_MAINTENANCE');
    assert.equal(held.result.requestRetained, true); assert.ok(held.error.nextActions[0].argv.includes('--bundles'));
    f.store.setMeta('maintenance', false); recovered = new Journal(f.store.directory);
    const result = await new GitBundleRetention(recovered).apply(preview.scopeToken, requestId); assert.equal(result.removed.length, 1);
    assert.equal(git(f.primary, 'rev-parse', f.capture.retention), f.tip); assert(!fs.existsSync(f.capture.bundle));
    assert.doesNotThrow(() => recovered.assertRepositoryAvailable(f.repo.id));
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); recovered?.close(); f.close(); }
});

test('a replacement after interrupted removal is preserved, and unrelated pins or new work invalidate reviewed cleanup', async t => {
  const f = await fixture(); try {
    const preview = await f.cleanup.preview(), requestId = randomUUID(), unlink = fs.unlinkSync;
    const mock = t.mock.method(fs, 'unlinkSync', path => { unlink(path); throw new Error('fixture partial removal'); }); syncBuiltinESMExports();
    await assert.rejects(f.cleanup.apply(preview.scopeToken, requestId)); mock.mock.restore(); syncBuiltinESMExports();
    fs.writeFileSync(f.capture.bundle, 'new user output', { mode: 0o600 });
    await assert.rejects(f.cleanup.apply(preview.scopeToken, requestId)); assert.equal(fs.readFileSync(f.capture.bundle, 'utf8'), 'new user output');
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); f.close(); }
  for (const mode of ['pin', 'job', 'policy']) {
    const f = await fixture(); try {
      const preview = await f.cleanup.preview();
      if (mode === 'policy') f.store.setMeta('settings', { retention: { rawLogDays: 60, summaryDays: 365, maxLogBytes: 2147483648 } });
      else { const op = f.store.admit(randomUUID(), 'checks', f.repo.id, {}, 'fixture'); if (mode === 'pin') f.store.update(op, { state: 'failed', pinned: true }); }
      await assert.rejects(f.cleanup.apply(preview.scopeToken, randomUUID())); assert(fs.existsSync(f.capture.bundle), mode);
    } finally { f.close(); }
  }
});

test('acknowledged incoming bytes expire while duplicate transfer receipts and imported refs remain available', async () => {
  const f = await fixture(); try {
    const senderHostId = randomUUID(), transferId = randomUUID(), requestId = randomUUID(), incomingRef = `refs/contribution/incoming/${senderHostId}/${requestId}`;
    const directory = join(f.store.directory, 'incoming'); fs.mkdirSync(directory, { mode: 0o700 });
    const path = join(directory, `${transferId}.bundle`); fs.writeFileSync(path, '', { mode: 0o600 }); const fileIdentity = incomingFileIdentity(path);
    fs.writeFileSync(path, fs.readFileSync(f.capture.bundle)); git(f.primary, 'update-ref', incomingRef, f.tip);
    let op = f.store.admit(requestId, 'seed', f.repo.id, { tip: f.tip, base: null, senderHostId, incomingRef }, 'fixture');
    op = f.store.update(op, { state: 'succeeded', result: { completedAt: old() } });
    f.store.put('peerCompletionAcknowledgment', op.operationId, { from: senderHostId, receipt: completionReceipt(f.store.response(op)) });
    const manifest = { schemaVersion: 1, transferId, requestId, repositoryId: f.repo.id, senderHostId, kind: 'seed', branch: 'dev', tip: f.tip, base: null,
      metadata: { schemaVersion: 1 }, policy: f.repo.revision, objectFormat: 'sha1', sourceRef: f.capture.retention, bundleDigest: f.capture.bundleDigest, bytes: fs.statSync(path).size };
    const accepted = { transferId, requestId, sourceTip: f.tip, incomingRef, response: f.store.response(op), acceptedAt: old() };
    f.store.put('transfer', transferId, { path, fileIdentity, manifest, accepted });
    f.store.put('peer', senderHostId, { hostId: senderHostId, version: '0.1.0' });
    f.store.put('authority', f.repo.id, { phase: 'active', ownerHostId: f.store.hostId, peerHostId: senderHostId });
    f.engine.repos.save({ ...f.repo, availability: 'both-macs' });
    // Even a malformed older ownership row cannot widen the private category.
    const foreign = join(f.root, 'foreign.bundle'), invalidOwner = '../../foreign';
    fs.writeFileSync(foreign, '', { mode: 0o600 }); const foreignIdentity = incomingFileIdentity(foreign);
    fs.writeFileSync(foreign, fs.readFileSync(path));
    f.store.put('transfer', invalidOwner, { path: foreign, fileIdentity: foreignIdentity, manifest: { ...manifest, transferId: invalidOwner }, accepted });
    const preview = await f.cleanup.preview(); assert.equal(preview.candidates.length, 2, JSON.stringify(preview));
    assert.equal(preview.protected[0].reason, 'GIT_BUNDLE_PROTECTED');
    await f.cleanup.apply(preview.scopeToken, randomUUID()); assert(!fs.existsSync(path)); assert.equal(git(f.primary, 'rev-parse', incomingRef), f.tip);
    assert(fs.existsSync(foreign));
    const receive = (action, body) => f.engine.peers.receive({ fromHostId: senderHostId, expectedHostId: f.store.hostId, compatibility: { version: '0.1.0' }, action, body: { repositoryId: f.repo.id, ...body } });
    assert.deepEqual((await receive('transfer.begin', { manifest })).accepted, accepted);
    assert.deepEqual(await receive('transfer.finish', { transferId }), { ...accepted, hostId: f.store.hostId, version: '0.1.0', protocolVersion: 1, requestSchemaVersion: 1 });
    assert.equal(f.store.peerEvidenceProtected(f.store.get(op.operationId)), false);
  } finally { f.close(); }
});

test('bundle review rejects mixed cleanup modes and concurrent execution retains one immutable cleanup owner', async () => {
  const f = await fixture(); try {
    assert.equal((await f.call({ bundles: true, worktrees: true, preview: true })).error.code, 'INVALID_USAGE');
    const preview = await f.cleanup.preview(), requestId = randomUUID();
    const results = await Promise.allSettled([f.cleanup.apply(preview.scopeToken, requestId), f.cleanup.apply(preview.scopeToken, randomUUID())]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1); assert.equal(results.find(result => result.status === 'rejected').reason.code, 'STORAGE_CLEANUP_BUSY');
    assert.equal(f.store.records('gitBundleCleanup').length, 1);
  } finally { f.close(); }
});
