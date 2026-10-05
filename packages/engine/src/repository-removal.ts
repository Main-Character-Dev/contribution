import { closeSync, fsyncSync, lstatSync, openSync, realpathSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Journal } from './journal.js';
import type { Enrolled, Repositories } from './repositories.js';
import { digest, id, now, requireValue } from './core.js';
import type { ObjectValue } from './core.js';
import { git, gitText, identity } from './git.js';
import { Lease, alive, processIdentity } from './process.js';
import type { LeaseOwner } from './process.js';
import { readStableFile } from './bounded-file.js';

interface FileIdentity { path: string; dev: number; ino: number; mode: number }
interface Hook { path: string; digest: string }
interface Removal {
  id: string; repository: Enrolled; identities: FileIdentity[]; hook: Hook | null;
  hookIdentity: FileIdentity | null; state: 'prepared' | 'unlinking' | 'completed';
  lease?: LeaseOwner; result?: ObjectValue;
}
const busy = new WeakMap<Journal, Set<string>>();
function present(path: string): boolean { try { lstatSync(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; } }

/** Unenrollment never infers ownership from a script marker or deletes source.
 * The saved hook digest and exact clone identities authorize the only file removal. */
export class RepositoryRemoval {
  constructor(readonly store: Journal, readonly repos: Repositories) {}
  pending(): ObjectValue[] { return this.store.records<Removal>('repositoryRemoval').filter(row => row.state !== 'completed').map(row => ({ repositoryId: row.repository.id, state: row.state, action: 'repos remove', sourcePreserved: true })); }
  completed(selector: string): ObjectValue | undefined {
    return this.store.records<Removal>('repositoryRemoval').find(row => row.state === 'completed' && (row.repository.id === selector || row.repository.path === selector))?.result;
  }
  private stat(path: string, directory: boolean): FileIdentity {
    const info = lstatSync(path);
    requireValue(!info.isSymbolicLink() && info.uid === process.getuid?.() && (directory ? info.isDirectory() : info.isFile() && info.nlink === 1),
      'REMOVAL_IDENTITY_CHANGED', 'The reviewed clone, hook directory or owned hook was replaced, linked or shared. Preserve it for inspection.', 3);
    return { path, dev: info.dev, ino: info.ino, mode: info.mode };
  }
  private idle(repo: Enrolled): void {
    requireValue(repo.availability === 'this-mac' && repo.canonicalHostId === this.store.hostId && !this.store.record('authority', repo.id),
      'AUTHORITY_RELEASE_REQUIRED', 'Paired writer authority must be explicitly released on both hosts before unenrollment. The existing fence remains in place.', 3);
    requireValue(!this.store.record('adoptedHooks', repo.id) && !this.store.records<{ repositoryId: string; phase: string }>('adoptionPlan')
      .some(plan => plan.repositoryId === repo.id && ['applying', 'applied', 'active', 'rolling_back'].includes(plan.phase)),
      'INTEGRATION_REMOVAL_REQUIRED', 'Complete the reviewed rollback of adopted integration before unenrollment.', 3);
    requireValue(!this.store.records<{ previous: { id: string }; state: string }>('configurationIntent').some(row => row.previous.id === repo.id && row.state === 'prepared'),
      'CONFIGURATION_RECONCILIATION_REQUIRED', 'Reconcile the retained configuration change before unenrollment.', 3);
    const rows = this.store.db.prepare('SELECT body FROM operations WHERE repository_id=?').all(repo.id);
    for (const row of rows) {
      const op = JSON.parse(String(row['body'])) as { state: string; result: { processes?: { pid: number; start: string | null }[] } };
      requireValue(['succeeded', 'failed', 'cancelled'].includes(op.state), 'REPOSITORY_BUSY', 'Retain enrollment while queued, interrupted or uncertain work needs reconciliation.', 3);
      requireValue(!op.result.processes?.some(proc => alive(proc.pid) && (!proc.start || !processIdentity(proc.pid) || processIdentity(proc.pid) === proc.start)),
        'REPOSITORY_BUSY', 'A retained worker may still be using this repository.', 3);
    }
    requireValue(!['primary-checkout-mutation.lock', 'primary-checkout-mutation.lock.recovery'].some(name => present(join(repo.commonDir, name))),
      'REPOSITORY_BUSY', 'A legacy writer or unknown recovery directory still needs reconciliation.', 3);
  }
  private async inspect(repo: Enrolled): Promise<Pick<Removal, 'identities' | 'hook' | 'hookIdentity'>> {
    const info = await identity(repo.path);
    requireValue(info.path === repo.path && info.commonDir === repo.commonDir && realpathSync(repo.path) === repo.path && realpathSync(repo.commonDir) === repo.commonDir,
      'REMOVAL_IDENTITY_CHANGED', 'The selected path no longer identifies the enrolled clone.', 3);
    const identities = [this.stat(repo.path, true), this.stat(repo.commonDir, true)];
    const hook = this.store.record<Hook>('hook', repo.id) ?? null;
    if (!hook) return { identities, hook, hookIdentity: null };
    const configured = await git(repo.path, ['config', '--get', 'core.hooksPath']);
    requireValue(configured.code === 1 && hook.path === await gitText(repo.path, ['rev-parse', '--path-format=absolute', '--git-path', 'hooks/pre-push']) &&
      dirname(hook.path) === join(repo.commonDir, 'hooks') && realpathSync(dirname(hook.path)) === dirname(hook.path),
      'INTEGRATION_REMOVAL_REQUIRED', 'Hook routing changed since installation. Preserve both dispatchers for explicit reconciliation.', 3);
    identities.push(this.stat(dirname(hook.path), true));
    const hookIdentity = present(hook.path) ? this.stat(hook.path, false) : null;
    if (hookIdentity) requireValue(digest(readStableFile(hook.path, 65536, 'OWNED_HOOK_CHANGED').toString('utf8')) === hook.digest,
      'OWNED_HOOK_CHANGED', 'The installed hook differs from Contribution’s retained content. Preserve it for review.', 3);
    return { identities, hook, hookIdentity };
  }
  async remove(repo: Enrolled): Promise<ObjectValue> {
    let locks = busy.get(this.store); if (!locks) { locks = new Set(); busy.set(this.store, locks); }
    requireValue(!locks.has(repo.id), 'REPOSITORY_BUSY', 'Repository removal is already being inspected.', 4);
    locks.add(repo.id); let lease: Lease | undefined;
    try {
      let intent = this.store.record<Removal>('repositoryRemoval', repo.id);
      if (intent?.state === 'completed') intent = undefined; // A later explicit reenrollment has a new removal lifetime.
      this.idle(repo);
      if (!intent) {
        const inspected = await this.inspect(repo); this.idle(repo);
        requireValue(digest(this.repos.all().find(row => row.id === repo.id)) === digest(repo), 'REMOVAL_IDENTITY_CHANGED', 'Enrollment changed during removal inspection.');
        requireValue(!present(join(repo.commonDir, 'contribution-writer.lock')), 'REPOSITORY_BUSY', 'A Contribution writer lease remains retained.', 4);
        intent = { id: id(), repository: repo, ...inspected, state: 'prepared' };
        this.store.put('repositoryRemoval', repo.id, intent);
      }
      requireValue(digest(intent.repository) === digest(repo), 'REMOVAL_IDENTITY_CHANGED', 'The retained removal belongs to a different enrollment.');
      const oldLease = Lease.inspect(repo.commonDir);
      if (oldLease && intent.lease && digest(oldLease) === digest(intent.lease)) Lease.reclaim(repo.commonDir, oldLease);
      lease = new Lease(repo.commonDir, intent.id);
      intent.lease = lease.owner; this.store.put('repositoryRemoval', repo.id, intent);
      const current = await this.inspect(repo); this.idle(repo);
      requireValue(digest(current.identities) === digest(intent.identities) && digest(current.hook) === digest(intent.hook) &&
        (digest(current.hookIdentity) === digest(intent.hookIdentity) || (intent.state === 'unlinking' && current.hookIdentity === null)),
        'REMOVAL_IDENTITY_CHANGED', 'The retained clone or hook changed during removal. Preserve it for inspection.', 3);
      // No asynchronous work between the final ownership check, unlink and receipt.
      if (current.hook && current.hookIdentity) {
        requireValue(digest(this.stat(current.hook.path, false)) === digest(current.hookIdentity) &&
          digest(readStableFile(current.hook.path, 65536, 'OWNED_HOOK_CHANGED').toString('utf8')) === current.hook.digest,
          'OWNED_HOOK_CHANGED', 'The owned hook changed before removal.');
        intent.state = 'unlinking'; this.store.put('repositoryRemoval', repo.id, intent);
        unlinkSync(current.hook.path);
        const fd = openSync(dirname(current.hook.path), 'r'); try { fsyncSync(fd); } finally { closeSync(fd); }
      }
      const result = { removed: repo.id, removalId: intent.id, sourcePreserved: true, historyPreserved: true, recordsPreserved: true, ownedHookRemoved: Boolean(intent.hookIdentity) };
      this.store.transaction(() => {
        this.store.put('hook', repo.id, null);
        this.store.db.prepare('DELETE FROM repositories WHERE id=?').run(repo.id);
        this.store.put('repositoryRemoval', repo.id, { ...intent, state: 'completed', completedAt: now(), result });
      });
      return result;
    } finally { lease?.release(); locks.delete(repo.id); }
  }
}
