import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync, linkSync, renameSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { Journal } from '../packages/engine/dist/journal.js';
import { StorageRetention } from '../packages/engine/dist/storage.js';
import { outputManifest } from '../packages/engine/dist/output-files.js';
import { DatabaseSync } from 'node:sqlite';

const old = '2020-01-01T00:00:00.000Z';
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ct-backup-retention-')), store = new Journal(root), storage = new StorageRetention(store);
  const backup = async (completed = old) => {
    const windowId = randomUUID(), requestId = randomUUID(), receipt = await store.checkpointBackup('fixture-payload', windowId);
    const owner = store.records('backupOutput').find(value => value.windowId === windowId);
    if (completed) store.put('maintenanceHistory', requestId, { id: windowId, requestId, backup: receipt, outcome: 'activated', completedAt: completed });
    return { owner, receipt, requestId, directory: owner.directory };
  };
  return { root, store, storage, backup, close: () => { store.close(); rmSync(root, { recursive: true }); } };
}

test('reviewed backup retention preserves the newest two complete recovery copies and replay receipts', async () => {
  const f = fixture(); try {
    let operation = f.store.admit(randomUUID(), 'checks', randomUUID(), { immutable: 'request' }, 'fixture');
    operation = f.store.update(operation, { state: 'succeeded' });
    const backups = []; for (let i = 0; i < 4; i++) backups.push(await f.backup());
    for (const { owner, receipt } of backups) {
      assert.equal(owner.phase, 'sealed'); assert.equal(owner.files.length, 3);
      assert.equal(createHash('sha256').update(readFileSync(receipt.path)).digest('hex'), receipt.sha256);
    }
    const unknown = join(f.root, 'backups', randomUUID()); mkdirSync(unknown); writeFileSync(join(unknown, 'journal.sqlite'), 'unknown recovery data');
    const preview = f.storage.preview(); assert.equal(preview.policy.backupDays, 365); assert.equal(preview.candidates.length, 2);
    assert.deepEqual(new Set(preview.candidates.map(value => value.key)), new Set(backups.slice(0, 2).map(value => `backup:${value.owner.id}`)));
    const requestId = randomUUID(), result = f.storage.apply(preview.scopeToken, requestId);
    assert.deepEqual(f.storage.apply(preview.scopeToken, requestId), result);
    for (const value of backups.slice(0, 2)) assert.equal(existsSync(value.directory), false);
    for (const value of backups.slice(2)) assert.ok(existsSync(value.receipt.path)); assert.ok(existsSync(unknown));
    assert.deepEqual(f.store.record('maintenanceHistory', backups[0].requestId).backup, backups[0].receipt);
    assert.equal(f.store.existing(operation.requestId, operation.kind, operation.repositoryId, operation.input).operationId, operation.operationId);
    assert.equal(f.storage.preview().candidates.length, 0);
  } finally { f.close(); }
});

test('recent, incomplete, changed, linked and replaced backups cannot acquire cleanup authority', async () => {
  for (const mode of ['recent', 'incomplete', 'changed', 'new-file', 'shared', 'replaced', 'creating', 'host', 'schema']) {
    const f = fixture(); try {
      const selected = await f.backup(mode === 'recent' ? new Date().toISOString() : mode === 'incomplete' ? null : old);
      await f.backup(); await f.backup();
      if (mode === 'changed') writeFileSync(selected.receipt.path, 'changed snapshot');
      if (mode === 'new-file') writeFileSync(join(selected.directory, 'notes'), 'preserve');
      if (mode === 'shared') linkSync(selected.receipt.path, join(f.root, 'shared.sqlite'));
      if (mode === 'replaced') { renameSync(selected.directory, selected.directory + '-preserved'); mkdirSync(selected.directory); writeFileSync(join(selected.directory, 'journal.sqlite'), 'replacement'); }
      if (mode === 'creating') f.store.put('backupOutput', selected.owner.id, { ...selected.owner, phase: 'creating' });
      if (mode === 'host') f.store.put('backupOutput', selected.owner.id, { ...selected.owner, hostId: randomUUID() });
      if (mode === 'schema') f.store.put('backupOutput', selected.owner.id, { ...selected.owner, receipt: { ...selected.receipt, schemaVersion: 99 } });
      assert.equal(f.storage.preview().candidates.length, 0, mode); assert.ok(existsSync(selected.directory));
    } finally { f.close(); }
  }
});

test('pins, unsettled or peer work and held maintenance preserve all backup evidence', async () => {
  for (const mode of ['pinned', 'queued', 'interrupted', 'outcome_unknown', 'peer', 'maintenance', 'window']) {
    const f = fixture(); try {
      const selected = await f.backup(); await f.backup(); await f.backup(); const preview = f.storage.preview();
      if (mode === 'maintenance') f.store.setMeta('maintenance', true);
      else if (mode === 'window') f.store.setMeta('maintenanceWindow', { id: randomUUID(), phase: 'stopped' });
      else {
        let op = f.store.admit(randomUUID(), 'checks', randomUUID(), {}, 'fixture');
        op = f.store.update(op, { state: ['pinned', 'peer'].includes(mode) ? 'failed' : mode, pinned: mode === 'pinned' });
        if (mode === 'peer') f.store.put('peerOperation', op.operationId, { from: randomUUID() });
      }
      assert.equal(f.storage.preview().candidates.length, 0, mode);
      assert.throws(() => f.storage.apply(preview.scopeToken, randomUUID()), { code: 'STORAGE_SELECTION_CHANGED' });
      assert.ok(existsSync(selected.receipt.path)); assert.equal(f.store.records('storageCleanup').length, 0);
    } finally { f.close(); }
  }
});

test('a stale preview cannot remove a backup after newer recovery copies or retention policy change', async () => {
  for (const mode of ['missing-newer', 'changed-newer', 'damaged-newer', 'unfinished-newer', 'schema-newer', 'policy']) {
    const f = fixture(); try {
      const selected = await f.backup(); await f.backup(); const newer = await f.backup(), preview = f.storage.preview();
      if (mode === 'missing-newer') unlinkSync(newer.receipt.path);
      if (mode === 'changed-newer') writeFileSync(newer.receipt.path, 'changed newer snapshot');
      if (mode === 'damaged-newer') {
        writeFileSync(newer.receipt.path, 'damaged snapshot with matching filesystem inventory');
        f.store.put('backupOutput', newer.owner.id, { ...newer.owner, files: outputManifest(newer.directory) });
      }
      if (mode === 'unfinished-newer') f.store.put('maintenanceHistory', newer.requestId, { id: newer.owner.windowId, outcome: 'unknown', backup: newer.receipt });
      if (mode === 'schema-newer') f.store.put('backupOutput', newer.owner.id, { ...newer.owner, receipt: { ...newer.receipt, schemaVersion: 2 } });
      if (mode === 'policy') f.store.setMeta('settings', { retention: { rawLogDays: 30, summaryDays: 366, maxLogBytes: 2147483648 } });
      assert.throws(() => f.storage.apply(preview.scopeToken, randomUUID()), { code: 'STORAGE_SELECTION_CHANGED' }, mode);
      assert.ok(existsSync(selected.receipt.path)); assert.equal(f.store.records('storageCleanup').length, 0);
    } finally { f.close(); }
  }
});

test('backup copies become independently readable standalone SQLite while the live journal stays in WAL', async () => {
  const f = fixture(); try {
    const selected = await f.backup(), before = outputManifest(selected.directory);
    const probe = new DatabaseSync(selected.receipt.path, { readOnly: true, allowExtension: false });
    try {
      assert.equal(probe.prepare('PRAGMA quick_check').get().quick_check, 'ok');
      assert.equal(probe.prepare('PRAGMA journal_mode').get().journal_mode, 'delete');
      const ownIntent = JSON.parse(probe.prepare("SELECT body FROM records WHERE namespace='backupOutput' AND key=?").get(selected.owner.id).body);
      assert.equal(ownIntent.phase, 'created'); // Creation ownership preceded the online snapshot.
    } finally { probe.close(); }
    assert.deepEqual(outputManifest(selected.directory), before);
    assert.deepEqual(readdirSync(selected.directory).sort(), ['journal.sqlite', 'receipt.json']);
    assert.equal(f.store.db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  } finally { f.close(); }
});

test('partial backup cleanup resumes its original subset and keeps new files and replacement identities', async () => {
  const f = fixture(); try {
    const selected = await f.backup(); await f.backup(); await f.backup();
    const preview = f.storage.preview(), requestId = randomUUID(), key = preview.candidates[0].key;
    f.store.put('storageCleanup', requestId, { requestId, token: preview.scopeToken, preview: f.store.record('storagePreview', preview.scopeToken), completed: [], state: 'removing' });
    f.store.put('storageEviction', key, { state: 'removing', requestId, directory: selected.directory });
    unlinkSync(join(selected.directory, 'receipt.json'));
    const added = join(selected.directory, 'unreviewed'); writeFileSync(added, 'preserve');
    assert.throws(() => f.storage.apply(preview.scopeToken, requestId), { code: 'STORAGE_SELECTION_CHANGED' }); assert.ok(existsSync(added));
    unlinkSync(added); // Explicit reconciliation of this disposable fixture file.
    assert.deepEqual(f.storage.apply(preview.scopeToken, requestId).removed, [key]);
    assert.equal(f.store.record('storageEviction', key).state, 'removed'); assert.equal(existsSync(selected.directory), false);
    assert.ok(f.store.record('backupOutput', selected.owner.id).receipt);
  } finally { f.close(); }
});

test('an interrupted or unsealable backup remains retained without falsely completed ownership', async () => {
  const f = fixture(); try {
    const actual = f.store.backup.bind(f.store);
    f.store.backup = async path => { await actual(path); writeFileSync(join(path, '..', 'unexpected'), 'preserve interrupted output'); };
    await assert.rejects(f.backup(), { code: 'BACKUP_OUTPUT_UNCONFIRMED' });
    const failed = f.store.records('backupOutput')[0]; assert.equal(failed.phase, 'created');
    assert.ok(existsSync(join(failed.directory, 'journal.sqlite'))); f.store.backup = actual;
    await f.backup(); await f.backup(); await f.backup();
    assert.equal(f.storage.preview().candidates.some(candidate => candidate.directory === failed.directory), false);
    assert.ok(existsSync(join(failed.directory, 'unexpected')));
  } finally { f.close(); }
});
