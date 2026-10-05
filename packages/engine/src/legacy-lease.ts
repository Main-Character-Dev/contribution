import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, rmdirSync, readdirSync, lstatSync, openSync, closeSync, fsyncSync } from 'node:fs';
import { join } from 'node:path';
import { id, now, requireValue, Fault } from './core.js';
import { processIdentity } from './process.js';

export interface LegacyOwner {
  version: 1; token: string; pid: number; purpose: string; acquired_at: string; start_time: string;
}
/** On-disk protocol shared by the four existing primary-checkout writers.
 * No migration selects this lease until its hook/flight adapter is adopted.
 */
export class LegacyPrimaryLease {
  readonly directory: string;
  readonly owner: LegacyOwner;
  constructor(commonDirectory: string, attemptId: string) {
    const start = processIdentity(process.pid);
    requireValue(start, 'PROCESS_IDENTITY_UNAVAILABLE', 'Cannot verify the primary writer identity.', 3);
    this.directory = join(commonDirectory, 'primary-checkout-mutation.lock');
    this.owner = { version: 1, token: id(), pid: process.pid, purpose: `contribution:${attemptId}`, acquired_at: now(), start_time: start };
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
  private static removeOwned(path: string, expected: LegacyOwner): boolean {
    if (!existsSync(path)) return false;
    const info = lstatSync(path); if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.()) return false;
    if (readdirSync(path).join() !== 'owner.json') return false;
    const file = join(path, 'owner.json'); if (lstatSync(file).isSymbolicLink()) return false;
    let owner: LegacyOwner; try { owner = JSON.parse(readFileSync(file, 'utf8')) as LegacyOwner; } catch { return false; }
    if (owner.token !== expected.token || owner.pid !== expected.pid || owner.start_time !== expected.start_time) return false;
    unlinkSync(file); rmdirSync(path); return true;
  }
  release(): void { LegacyPrimaryLease.removeOwned(this.directory, this.owner); }
}
