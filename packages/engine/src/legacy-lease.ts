import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, rmdirSync, readdirSync, lstatSync, openSync, closeSync, fsyncSync } from 'node:fs';
import { join } from 'node:path';
import { id, now, requireValue, Fault } from './core.js';
import { processIdentity, descendantOf } from './process.js';

export interface LegacyOwner {
  version: 1; token: string; pid: number; purpose: string; acquired_at: string; start_time: string;
}
/** On-disk protocol shared by the four existing primary-checkout writers.
 * Adopted publication and reviewed cutover share this boundary with legacy writers.
 */
export class LegacyPrimaryLease {
  readonly directory: string;
  readonly owner: LegacyOwner;
  static ownerFor(attemptId: string): LegacyOwner {
    const start = processIdentity(process.pid);
    requireValue(start, 'PROCESS_IDENTITY_UNAVAILABLE', 'Cannot verify the primary writer identity.', 3);
    return { version: 1, token: id(), pid: process.pid, purpose: `contribution:${attemptId}`, acquired_at: now(), start_time: start };
  }
  constructor(commonDirectory: string, attemptId: string, retainedOwner?: LegacyOwner) {
    this.directory = join(commonDirectory, 'primary-checkout-mutation.lock');
    this.owner = retainedOwner ?? LegacyPrimaryLease.ownerFor(attemptId);
    requireValue(this.owner.pid === process.pid && this.owner.start_time === processIdentity(process.pid) && this.owner.purpose === `contribution:${attemptId}`,
      'LEASE_IDENTITY_CHANGED', 'A new lease must identify its actual live creator.', 3);
    const boundary = `${this.directory}.recovery`, boundaryOwner = { ...this.owner, token: id(), purpose: 'primary-checkout-lease-recovery' };
    const candidate = `${this.directory}.candidate.${process.pid}.${this.owner.token}`;
    const boundaryCandidate = `${boundary}.candidate.${process.pid}.${boundaryOwner.token}`;
    let acquiredBoundary = false;
    try {
      LegacyPrimaryLease.writeCandidate(candidate, this.owner);
      LegacyPrimaryLease.writeCandidate(boundaryCandidate, boundaryOwner);
      requireValue(!existsSync(boundary), 'REPOSITORY_BUSY', 'A legacy recovery boundary is retained; preserve it for its owning workflow.');
      try { renameSync(boundaryCandidate, boundary); acquiredBoundary = true; }
      catch { throw new Fault('REPOSITORY_BUSY', 'The existing primary writer or its recovery boundary needs reconciliation.', 4); }
      requireValue(!existsSync(this.directory), 'REPOSITORY_BUSY', 'An existing primary-checkout lease is retained. Reconcile its recorded owner before retrying.');
      try { renameSync(candidate, this.directory); }
      catch { throw new Fault('REPOSITORY_BUSY', 'Another cooperating primary writer acquired this checkout.', 4); }
      LegacyPrimaryLease.sync(commonDirectory);
    } finally {
      LegacyPrimaryLease.removeOwned(candidate, this.owner);
      LegacyPrimaryLease.removeOwned(boundaryCandidate, boundaryOwner);
      if (acquiredBoundary) LegacyPrimaryLease.removeOwned(boundary, boundaryOwner);
    }
  }
  static inspect(commonDirectory: string): LegacyOwner | null {
    const directory = join(commonDirectory, 'primary-checkout-mutation.lock');
    try {
      const info = lstatSync(directory), file = lstatSync(join(directory, 'owner.json'));
      if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.() || !file.isFile() || file.isSymbolicLink() || file.size > 8192) return null;
      return JSON.parse(readFileSync(join(directory, 'owner.json'), 'utf8')) as LegacyOwner;
    } catch { return null; }
  }
  private static sync(path: string): void { const fd = openSync(path, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } }
  private static writeCandidate(path: string, owner: LegacyOwner): void {
    mkdirSync(path, { mode: 0o700 }); writeFileSync(join(path, 'owner.json'), JSON.stringify(owner) + '\n', { flag: 'wx', mode: 0o600 });
    this.sync(join(path, 'owner.json')); this.sync(path);
  }
  static removeOwned(path: string, expected: LegacyOwner): boolean {
    if (!existsSync(path)) return false;
    const info = lstatSync(path); if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.()) return false;
    if (readdirSync(path).join() !== 'owner.json') return false;
    const file = join(path, 'owner.json'); if (lstatSync(file).isSymbolicLink()) return false;
    let owner: LegacyOwner; try { owner = JSON.parse(readFileSync(file, 'utf8')) as LegacyOwner; } catch { return false; }
    if (owner.token !== expected.token || owner.pid !== expected.pid || owner.start_time !== expected.start_time) return false;
    unlinkSync(file); rmdirSync(path); return true;
  }
  release(): void { LegacyPrimaryLease.removeOwned(this.directory, this.owner); }
  /** Excludes the original stale-owner reclamation path while a retained owned
   * lease is released. A crash leaves this boundary visibly unresolved. */
  static withRecovery<T>(commonDirectory: string, action: () => T): T {
    const path = join(commonDirectory, 'primary-checkout-mutation.lock.recovery'), owner = { ...this.ownerFor(id()), purpose: 'primary-checkout-lease-recovery' };
    const candidate = `${path}.candidate.${process.pid}.${owner.token}`;
    let acquired = false;
    try {
      this.writeCandidate(candidate, owner);
      requireValue(!existsSync(path), 'REPOSITORY_BUSY', 'A legacy recovery boundary must be reconciled before releasing this fence.', 3);
      try { renameSync(candidate, path); acquired = true; }
      catch { throw new Fault('REPOSITORY_BUSY', 'Another legacy recovery owns this checkout.', 3); }
      return action();
    } finally { this.removeOwned(candidate, owner); if (acquired) this.removeOwned(path, owner); }
  }
  static borrow(commonDirectory: string, expected: LegacyOwner, caller: { pid: number; start: string }, invocation: { pid: number; start: string }): { status: 'acquired'; leasePath: string; token: string; owner: LegacyOwner; contributionBorrowed: true } {
    const owner = this.inspect(commonDirectory);
    requireValue(owner && owner.token === expected.token && owner.pid === expected.pid && owner.start_time === expected.start_time && processIdentity(owner.pid) === owner.start_time,
      'HOOK_LEASE_INVALID', 'The shared writer lease no longer belongs to this managed invocation.');
    requireValue(descendantOf(caller.pid, caller.start, invocation), 'HOOK_PROCESS_MISMATCH', 'The requesting hook is not a live descendant of the recorded Git invocation.');
    return { status: 'acquired', leasePath: join(commonDirectory, 'primary-checkout-mutation.lock'), token: owner.token, owner, contributionBorrowed: true };
  }
}
