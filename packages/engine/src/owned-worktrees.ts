import { lstatSync, existsSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { Journal, Operation } from './journal.js';
import type { Enrolled } from './repositories.js';
import type { RunOptions } from './process.js';
import { alive, processIdentity } from './process.js';
import { clean, git, gitText, identity } from './git.js';
import { privateDirectory } from './private-files.js';
import { digest, id, now, requireValue } from './core.js';
import type { ObjectValue } from './core.js';
import { WorktreeHistory } from './worktree-history.js';
import type { HistoryReceipt } from './worktree-history.js';
import { validateContractFormat } from '@contribution/contracts';

type Kind = 'candidate' | 'build' | 'adopted';
interface Identity { path: string; dev: number; ino: number }
interface Owned {
  operationId: string; attemptId: string; repositoryId: string; kind: Kind;
  primary: string; commonDir: string; directory: string; tip: string; retention: string;
  phase: 'creating' | 'ready'; identities?: Identity[]; gitDirectory?: string;
}
interface Candidate { owner: Owned; head: string }
interface Preview { token: string; candidates: Candidate[]; createdAt: string }
interface Removal { requestId: string; preview: Preview; completed: string[]; state: 'removing' | 'completed'; result?: ObjectValue }
const busy = new WeakSet<Journal>();
function present(path: string): boolean { try { lstatSync(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; } }

/** Only worktrees created and identified by this service can enter cleanup.
 * Native task worktrees and older unrecorded output are never inferred as owned. */
export class OwnedWorktrees {
  constructor(readonly store: Journal) {}
  path(kind: Kind, attempt: string): string {
    requireValue(validateContractFormat('uuid', attempt), 'WORKTREE_OWNER_INVALID', 'A worktree must belong to a retained attempt.');
    const root = realpathSync(this.store.directory);
    return kind === 'candidate' ? join(root, 'candidates', attempt)
      : join(root, kind === 'build' ? 'device-builds' : 'adopted-landings', attempt, 'source');
  }
  private stat(path: string, directory = true): Identity {
    const info = lstatSync(path);
    requireValue(!info.isSymbolicLink() && info.uid === process.getuid?.() && (directory ? info.isDirectory() : info.isFile() && info.nlink === 1),
      'WORKTREE_IDENTITY_CHANGED', 'A worktree or its registration was replaced, linked or shared. Preserve it for inspection.', 3);
    return { path, dev: info.dev, ino: info.ino };
  }
  async create(op: Operation, repo: Enrolled, kind: Kind, tip: string, options: RunOptions = {}): Promise<string> {
    const directory = this.path(kind, op.attemptId), retention = `refs/contribution/worktrees/${op.attemptId}`;
    requireValue(op.repositoryId === repo.id && !this.store.record('ownedWorktree', op.attemptId) && !present(directory),
      'WORKTREE_CREATION_UNCONFIRMED', 'An existing worktree or incomplete creation must be reconciled before another attempt.', 3);
    const primary = await identity(repo.path);
    requireValue(primary.path === realpathSync(repo.path) && primary.commonDir === repo.commonDir, 'WORKTREE_OWNER_INVALID', 'The enrolled clone identity changed.');
    const root = realpathSync(this.store.directory);
    privateDirectory(join(root, kind === 'candidate' ? 'candidates' : kind === 'build' ? 'device-builds' : 'adopted-landings'));
    privateDirectory(dirname(directory));
    requireValue(realpathSync(dirname(directory)) === dirname(directory), 'WORKTREE_OWNER_INVALID', 'Owned output cannot traverse symbolic links.');
    const owner: Owned = { operationId: op.operationId, attemptId: op.attemptId, repositoryId: repo.id, kind,
      primary: primary.path, commonDir: repo.commonDir, directory, tip, retention, phase: 'creating' };
    this.store.put('ownedWorktree', op.attemptId, owner);
    await gitText(repo.path, ['update-ref', retention, tip, '0'.repeat(tip.length)], options);
    await gitText(repo.path, ['worktree', 'add', '--detach', directory, tip], options);
    const info = await identity(directory), gitDirectory = await gitText(directory, ['rev-parse', '--absolute-git-dir']);
    requireValue(info.path === directory && info.commonDir === repo.commonDir && info.tip === tip && !info.branch &&
      dirname(gitDirectory) === join(repo.commonDir, 'worktrees'), 'WORKTREE_OWNER_INVALID', 'Git did not create the selected private detached worktree.');
    const identities = [this.stat(dirname(directory)), this.stat(directory), this.stat(join(directory, '.git'), false), this.stat(repo.commonDir), this.stat(dirname(gitDirectory)), this.stat(gitDirectory)];
    this.store.put('ownedWorktree', op.attemptId, { ...owner, phase: 'ready', gitDirectory, identities }); return directory;
  }
  private eligible(owner: Owned): void {
    requireValue(!this.store.records<{ repositoryId: string; owner: string; state: string }>('resource').some(r => r.repositoryId === owner.repositoryId && ['utility', 'borrowed'].includes(r.owner) && r.state !== 'stopped'), 'WORKTREE_RESOURCE_UNRELEASED', 'Retained processes/sessions still need this clone; reconcile their exact owner before removal.', 3);
    const op = this.store.get(owner.operationId), days = this.store.getMeta<{ retention: { rawLogDays: number } }>('settings')?.retention.rawLogDays ?? 30;
    requireValue(owner.phase === 'ready' && owner.directory === this.path(owner.kind, op.attemptId) && owner.attemptId === op.attemptId && owner.repositoryId === op.repositoryId &&
      !op.pinned && ['succeeded', 'failed', 'cancelled'].includes(op.state) && typeof op.result['completedAt'] === 'string' &&
      Date.parse(op.result['completedAt']) <= Date.now() - days * 86400000 && !this.store.peerEvidenceProtected(op),
      'WORKTREE_PROTECTED', 'Recent, pinned, unfinished or unacknowledged work remains protected.', 3);
    const rows = this.store.list(10001);
    requireValue(rows.length <= 10000, 'STORAGE_CENSUS_LIMIT', 'A larger journal needs a paged dependency inspection.', 3);
    requireValue(!rows.some(other => other.repositoryId === owner.repositoryId && (!['succeeded', 'failed', 'cancelled'].includes(other.state) ||
      (other.pinned && JSON.stringify({ input: other.input, result: other.result }).includes(owner.directory)))),
      'WORKTREE_DEPENDENCY_ACTIVE', 'An unresolved or pinned dependent operation still needs this clone or worktree.', 3);
    for (const other of rows.filter(value => value.repositoryId === owner.repositoryId)) {
      const processes = other.result['processes'] as { pid: number; start: string | null }[] | undefined;
      requireValue(!processes?.some(value => alive(value.pid) && (!value.start || !processIdentity(value.pid) || processIdentity(value.pid) === value.start)),
        'WORKTREE_PROCESS_UNCONFIRMED', 'A retained process may still use this clone; reconcile it before cleanup.', 3);
    }
  }
  private async inspect(owner: Owned): Promise<Candidate> {
    this.eligible(owner);
    requireValue(owner.identities && owner.gitDirectory && dirname(owner.gitDirectory) === join(owner.commonDir, 'worktrees'), 'WORKTREE_IDENTITY_CHANGED', 'Complete worktree creation identity is required.');
    for (const entry of owner.identities) requireValue(digest(this.stat(entry.path, entry.path !== join(owner.directory, '.git'))) === digest(entry), 'WORKTREE_IDENTITY_CHANGED', 'A retained directory identity changed.');
    requireValue(realpathSync(owner.directory) === owner.directory, 'WORKTREE_IDENTITY_CHANGED', 'The owned path now traverses a link.');
    const primary = await identity(owner.primary), info = await identity(owner.directory);
    requireValue(primary.commonDir === owner.commonDir && info.path === owner.directory && info.commonDir === owner.commonDir && !info.branch && info.tip &&
      await gitText(owner.directory, ['rev-parse', '--absolute-git-dir']) === owner.gitDirectory, 'WORKTREE_IDENTITY_CHANGED', 'The detached worktree no longer belongs to its retained clone.');
    requireValue(!existsSync(join(owner.gitDirectory, 'locked')), 'WORKTREE_LOCKED', 'A locked worktree remains protected.');
    await clean(owner.directory);
    requireValue(await gitText(owner.directory, ['status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching']) === '',
      'WORKTREE_LOCAL_OUTPUT', 'Untracked or ignored worktree files must be reconciled before removal.', 3);
    // Retention refs and committed history are preserved separately. Removal
    // cannot be the only remaining reference to this detached commit.
    const retained = await gitText(owner.primary, ['rev-parse', '--verify', owner.retention]);
    requireValue(retained === owner.tip && (info.tip === retained ||
      (primary.tip && (await git(owner.primary, ['merge-base', '--is-ancestor', info.tip, primary.tip])).code === 0)),
      'WORKTREE_HISTORY_UNRETAINED', 'Detached history is not durably retained outside this worktree.', 3);
    // Submodule worktrees need a separate lifecycle; never use force removal.
    requireValue(!/^160000 /m.test(await gitText(owner.directory, ['ls-tree', '-r', info.tip])), 'WORKTREE_SUBMODULE_UNSUPPORTED', 'Submodule worktrees stay protected.');
    return { owner, head: info.tip };
  }
  async preview(): Promise<ObjectValue> {
    const candidates: Candidate[] = [], protectedEntries: ObjectValue[] = [];
    for (const owner of this.store.records<Owned>('ownedWorktree')) {
      if (this.store.record('worktreeEviction', owner.attemptId)) continue;
      try { candidates.push(await this.inspect(owner)); }
      catch (error) { protectedEntries.push({ attemptId: owner.attemptId, directory: owner.directory, reason: (error as { code?: string }).code ?? 'WORKTREE_INSPECTION_UNAVAILABLE' }); }
    }
    const preview: Preview = { token: id(), candidates, createdAt: now() }; this.store.put('worktreeCleanupPreview', preview.token, preview);
    return { scopeToken: preview.token, worktrees: true, candidates: candidates.map(value => ({ attemptId: value.owner.attemptId, directory: value.owner.directory, repositoryId: value.owner.repositoryId, head: value.head, retention: 'independent archive and restore verification before removal', estimatedBytes: null })), protected: protectedEntries,
      policy: { minimumAgeDays: this.store.getMeta<{ retention: { rawLogDays: number } }>('settings')?.retention.rawLogDays ?? 30, gitRemoval: 'without_force', refsAndBundles: 'preserved', nativeWorktrees: 'excluded' }, mutation: 'none' };
  }
  async apply(token: string, requestId: string): Promise<ObjectValue> {
    requireValue(validateContractFormat('uuid', token) && validateContractFormat('uuid', requestId), 'INVALID_USAGE', 'Cleanup needs its reviewed scope and immutable request UUID.', 2);
    requireValue(!busy.has(this.store), 'STORAGE_CLEANUP_BUSY', 'Another worktree cleanup is being inspected or executed.', 4);
    busy.add(this.store);
    try {
      let removal = this.store.record<Removal>('worktreeCleanup', requestId);
      if (removal) { requireValue(removal.preview.token === token, 'REQUEST_ID_CONFLICT', 'The cleanup request has a different scope.'); if (removal.result) return removal.result; }
      const preview = removal?.preview ?? this.store.record<Preview>('worktreeCleanupPreview', token);
      requireValue(preview, 'STORAGE_PREVIEW_REQUIRED', 'Review the owned worktrees before removal.', 3);
      requireValue(!this.store.records<Removal>('worktreeCleanup').some(other => other.requestId !== requestId && other.state === 'removing'), 'STORAGE_CLEANUP_PENDING', 'Resume the retained worktree cleanup request first.', 3);
      if (!removal) {
        for (const selected of preview.candidates) requireValue(digest(await this.inspect(selected.owner)) === digest(selected), 'STORAGE_SELECTION_CHANGED', 'The reviewed worktree changed; obtain a fresh preview.');
        removal = { requestId, preview, completed: [], state: 'removing' };
        // New jobs in affected clones are fenced before the first removal.
        this.store.put('worktreeCleanup', requestId, removal);
      }
      for (const selected of preview.candidates) {
        const owner = selected.owner; if (removal.completed.includes(owner.attemptId)) continue;
        this.eligible(owner);
        const pathPresent = present(owner.directory), registrationPresent = present(owner.gitDirectory!);
        if (pathPresent || registrationPresent) {
          requireValue(pathPresent && registrationPresent && digest(await this.inspect(owner)) === digest(selected), 'STORAGE_SELECTION_CHANGED', 'A partial or changed worktree remains protected for reconciliation.');
          await new WorktreeHistory(this.store).retain(owner.attemptId, owner.primary, owner.commonDir, selected.head);
          requireValue(digest(await this.inspect(owner)) === digest(selected), 'STORAGE_SELECTION_CHANGED', 'Ownership changed during independent retention; preserve it.');
          this.eligible(owner);
          await gitText(owner.primary, ['worktree', 'remove', owner.directory], { timeoutMs: 60000 });
        }
        const retained = this.store.record<HistoryReceipt>('worktreeHistory', owner.attemptId);
        requireValue(retained, 'WORKTREE_HISTORY_UNRETAINED', 'Missing independent restore proof; reconcile this exact partial removal.', 3);
        await new WorktreeHistory(this.store).verify(retained);
        requireValue(!present(owner.directory) && !present(owner.gitDirectory!), 'WORKTREE_REMOVAL_UNCONFIRMED', 'Git did not confirm complete removal.');
        this.store.transaction(() => {
          this.store.put('worktreeEviction', owner.attemptId, { requestId, operationId: owner.operationId, attemptId: owner.attemptId, directory: owner.directory, head: selected.head, removedAt: now(), refsAndBundles: 'preserved' });
          removal!.completed.push(owner.attemptId); this.store.put('worktreeCleanup', requestId, removal);
        });
      }
      const result = { requestId, scopeToken: token, removed: removal.completed, refsAndBundles: 'preserved', nativeWorktrees: 'untouched' };
      this.store.put('worktreeCleanup', requestId, { ...removal, state: 'completed', result }); return result;
    } finally { busy.delete(this.store); }
  }
}
