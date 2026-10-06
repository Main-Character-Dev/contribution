import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync, renameSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Journal } from '../packages/engine/dist/journal.js';
import { WorktreeHistory } from '../packages/engine/dist/worktree-history.js';
import { repository, commit, git } from './integration/service.mjs';

for (const shallow of [false, true]) test(`AT-LC10 independent ${shallow ? 'shallow' : 'full'} archive restores with source unavailable`, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ct-history-'))), store = new Journal(join(root, 'state'));
  try {
    const source = repository(root); commit(source); commit(source, 'second', 'two'); const tip = commit(source, 'third', 'three');
    const primary = shallow ? join(root, 'shallow') : source;
    if (shallow) git(source, 'clone', '--depth=1', pathToFileURL(source).href, primary);
    const common = git(primary, 'rev-parse', '--path-format=absolute', '--git-common-dir'), attempt = randomUUID(), owner = new WorktreeHistory(store);
    const receipt = await owner.retain(attempt, primary, common, tip);
    assert.equal(receipt.head, tip); assert.equal(receipt.shallow.length > 0, shallow);
    assert(!existsSync(join(receipt.directory, 'objects/info/alternates')));
    renameSync(source, join(root, 'source-unavailable'));
    if (shallow) renameSync(primary, join(root, 'shallow-unavailable'));
    await owner.verify(receipt);
    assert.equal(git(receipt.restoreDirectory, 'show', `${tip}:third`), 'three');
    const before = store.record('worktreeHistory', attempt); store.db.prepare("DELETE FROM records WHERE namespace='worktreeHistory' AND key=?").run(attempt);
    // Resume after copies exist and their transfer endpoints were removed.
    const resumed = await owner.retain(attempt, receipt.directory, receipt.directory, tip).catch(error => error);
    // Changed source identity cannot replace the original retained intent.
    assert.equal(resumed.code, 'HISTORY_SELECTION_CHANGED'); store.put('worktreeHistory', attempt, before);
    writeFileSync(join(receipt.directory, 'config'), 'changed');
    await assert.rejects(() => owner.verify(receipt), { code: 'HISTORY_ARCHIVE_CHANGED' });
  } finally { store.close(); rmSync(root, { recursive: true }); }
});

test('AT-LC10 promisor history and corrupt partial archives remain protected without remote hydration', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ct-history-partial-'))), store = new Journal(join(root, 'state'));
  try {
    const primary = repository(root), tip = commit(primary), common = git(primary, 'rev-parse', '--path-format=absolute', '--git-common-dir');
    git(primary, 'config', 'extensions.partialClone', 'origin');
    await assert.rejects(() => new WorktreeHistory(store).retain(randomUUID(), primary, common, tip), { code: 'HISTORY_PARTIAL_UNSUPPORTED' });
    assert.equal(store.records('worktreeHistory').length, 0);
  } finally { store.close(); rmSync(root, { recursive: true }); }
});

test('AT-LC16 declared state budget refuses archive copies before allocation and preserves source history', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ct-history-budget-'))), store = new Journal(join(root, 'state'));
  try {
    const primary = repository(root); const tip = commit(primary, 'unique', 'preserved');
    // Large private output leaves less than the required independent-copy
    // reservation, while the current usage remains below its reviewed cap.
    writeFileSync(join(store.directory, 'protected-output'), Buffer.alloc(850000));
    store.setMeta('managedStoragePolicy', { schemaVersion: 1, maxStateBytes: 1048576 });
    const common = git(primary, 'rev-parse', '--path-format=absolute', '--git-common-dir');
    // Add incompressible committed content so the source-size reservation is
    // larger than the remaining declared capacity.
    const { randomBytes } = await import('node:crypto'); writeFileSync(join(primary, 'blob'), randomBytes(200000)); git(primary, 'add', 'blob'); git(primary, 'commit', '-m', 'Fixture large history');
    await assert.rejects(() => new WorktreeHistory(store).retain(randomUUID(), primary, common, git(primary, 'rev-parse', 'HEAD')), { code: 'HISTORY_ARCHIVE_STORAGE_PRESSURE' });
    assert.equal(git(primary, 'show', `${tip}:unique`), 'preserved'); assert.equal(store.records('worktreeHistory').length, 0);
  } finally { store.close(); rmSync(root, { recursive: true }); }
});
