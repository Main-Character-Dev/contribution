import { existsSync, lstatSync, readdirSync, realpathSync, statfsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Journal } from './journal.js';
import { git, gitText } from './git.js';
import { ManagedStorage } from './managed-storage.js';
import { privateDirectory } from './private-files.js';
import { stableFileDigest, readStableFile } from './bounded-file.js';
import { digest, now, requireValue } from './core.js';

export interface HistoryReceipt {
  attemptId: string; head: string; directory: string; restoreDirectory: string;
  shallow: string[]; objects: string; archiveDigest: string; restoreDigest: string;
  bytes: number; verifiedAt: string;
}
/** Local transport copies objects, never hardlinks or alternates. Both copies
 * survive destruction of the source clone. No remote fetch or lazy hydration. */
export class WorktreeHistory {
  constructor(readonly store: Journal) {}
  private inventory(path: string): { digest: string; bytes: number } {
    requireValue(realpathSync(path) === path, 'HISTORY_ARCHIVE_CHANGED', 'The retained archive path changed.', 3);
    const files: { path: string; bytes: number; sha256: string }[] = []; let bytes = 0, entries = 0; const deadline = performance.now() + 10000;
    const visit = (dir: string, prefix = ''): void => {
      for (const entry of readdirSync(dir).sort()) {
        requireValue(performance.now() < deadline && ++entries <= 100000, 'HISTORY_ARCHIVE_LIMIT', 'Archive entry census exceeded its finite limit.', 3);
        const name = join(dir, entry), relative = prefix + entry, info = lstatSync(name);
        requireValue(!info.isSymbolicLink() && info.uid === process.getuid?.() && (info.isDirectory() || info.isFile() && info.nlink === 1), 'HISTORY_ARCHIVE_CHANGED', 'Linked, shared or replaced archive entries remain protected.', 3);
        if (info.isDirectory()) visit(name, relative + '/');
        else {
          bytes += info.size; requireValue(bytes <= 1024 ** 3, 'HISTORY_ARCHIVE_LIMIT', 'Archive exceeds the one GiB qualified source bound.', 3);
          files.push({ path: relative, ...stableFileDigest(name, 1024 ** 3, 'HISTORY_ARCHIVE_CHANGED') });
        }
      }
    };
    visit(path); requireValue(!existsSync(join(path, 'objects', 'info', 'alternates')), 'HISTORY_ARCHIVE_DEPENDENCY', 'An independent archive cannot rely on alternates.', 3);
    return { digest: digest(files), bytes };
  }
  private async verifyGit(path: string, head: string): Promise<{ shallow: string[]; objects: string }> {
    const options = { timeoutMs: 30000, maxBytes: 4 * 1024 * 1024, env: { GIT_NO_LAZY_FETCH: '1', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } };
    requireValue(await gitText(path, ['cat-file', '-t', head], options) === 'commit', 'HISTORY_ARCHIVE_INVALID', 'The exact selected commit is unavailable.', 3);
    requireValue(!/promisor|partialclone/i.test(await gitText(path, ['config', '--local', '--list'], options)), 'HISTORY_PARTIAL_UNSUPPORTED', 'Hydrate missing promisor objects through their owner before retention.', 3);
    const objects = await gitText(path, ['rev-list', '--objects', '--missing=print', head], options);
    requireValue(!/^\?/m.test(objects), 'HISTORY_ARCHIVE_INCOMPLETE', 'Available selected history has missing objects.', 3);
    await gitText(path, ['fsck', '--full', '--no-reflogs'], options);
    const shallow = existsSync(join(path, 'shallow')) ? readStableFile(join(path, 'shallow'), 1024 * 1024, 'HISTORY_ARCHIVE_CHANGED').toString('utf8').trim().split('\n').sort() : [];
    return { shallow, objects: digest(objects.split('\n').sort()) };
  }
  async verify(receipt: HistoryReceipt): Promise<void> {
    const archive = this.inventory(receipt.directory), restore = this.inventory(receipt.restoreDirectory);
    requireValue(archive.digest === receipt.archiveDigest && restore.digest === receipt.restoreDigest, 'HISTORY_ARCHIVE_CHANGED', 'Archive/restore integrity changed; preserve the worktree.', 3);
    const history = await this.verifyGit(receipt.restoreDirectory, receipt.head);
    requireValue(history.objects === receipt.objects && digest(history.shallow) === digest(receipt.shallow), 'HISTORY_ARCHIVE_INCOMPLETE', 'Restore does not match the retained available ancestry.', 3);
  }
  async retain(attemptId: string, primary: string, commonDir: string, head: string): Promise<HistoryReceipt> {
    const existing = this.store.record<HistoryReceipt>('worktreeHistory', attemptId);
    if (existing) { requireValue(existing.head === head, 'HISTORY_SELECTION_CHANGED', 'The archive selects other history.', 3); await this.verify(existing); return existing; }
    this.store.assertAdmissionStorage();
    const root = join(realpathSync(this.store.directory), 'worktree-history'); privateDirectory(root);
    const parent = join(root, attemptId); privateDirectory(parent);
    const directory = join(parent, 'archive.git'), restoreDirectory = join(parent, 'restore.git');
    // Refuse unqualified large/shared/alternates topology before copying bytes.
    // Failed copies remain retained output, never trigger destructive retry.
    const sourceBytes = this.inventory(commonDir).bytes, usage = new ManagedStorage(this.store).usage(), disk = statfsSync(root);
    requireValue(usage.complete && usage.logicalBytes + sourceBytes * 2 < usage.maxStateBytes && disk.bavail * disk.bsize > sourceBytes * 2, 'HISTORY_ARCHIVE_STORAGE_PRESSURE', 'Independent copies lack declared storage/headroom; preserve the source and raise the reviewed budget.', 3);
    const source = await this.verifyGit(commonDir, head);
    const intent = { attemptId, primary, commonDir, head, directory, restoreDirectory, source };
    const prior = this.store.record('worktreeHistoryIntent', attemptId);
    requireValue(!prior || digest(prior) === digest(intent), 'HISTORY_SELECTION_CHANGED', 'Resume the original selected archive.', 3);
    this.store.put('worktreeHistoryIntent', attemptId, intent);
    const options = { timeoutMs: 60000, maxBytes: 1024 * 1024, env: { GIT_NO_LAZY_FETCH: '1', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } };
    // Existing partial output is validated, never guessed disposable or removed.
    // A broken copy receives an actionable owner repair rather than overwrite.
    if (!existsSync(directory)) await gitText(primary, ['clone', '--mirror', '--no-local', pathToFileURL(commonDir).href, directory], options);
    const archived = await this.verifyGit(directory, head);
    requireValue(digest(archived) === digest(source), 'HISTORY_ARCHIVE_INCOMPLETE', 'Independent archive differs from selected available history.', 3);
    if (!existsSync(restoreDirectory)) await gitText(primary, ['clone', '--mirror', '--no-local', pathToFileURL(directory).href, restoreDirectory], options);
    const restored = await this.verifyGit(restoreDirectory, head);
    requireValue(digest(restored) === digest(source), 'HISTORY_ARCHIVE_INCOMPLETE', 'Independent restore failed ancestry validation.', 3);
    // Disable all transfer endpoints; recovery never depends on their existence.
    for (const path of [directory, restoreDirectory]) if ((await git(path, ['config', '--get-regexp', '^remote\\.origin\\.'], options)).code === 0) await gitText(path, ['config', '--remove-section', 'remote.origin'], options);
    const archive = this.inventory(directory), restore = this.inventory(restoreDirectory);
    this.store.assertAdmissionStorage();
    const receipt: HistoryReceipt = { attemptId, head, directory, restoreDirectory, ...restored, archiveDigest: archive.digest, restoreDigest: restore.digest, bytes: archive.bytes + restore.bytes, verifiedAt: now() };
    this.store.put('worktreeHistory', attemptId, receipt); await this.verify(receipt); return receipt;
  }
}
