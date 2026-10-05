import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, openSync, closeSync, fsyncSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { digest, id, now, requireValue, Fault } from './core.js';
import type { Journal } from './journal.js';
import type { Enrolled } from './repositories.js';
import { LegacyPrimaryLease } from './legacy-lease.js';
import type { LegacyOwner } from './legacy-lease.js';
import { alive, processIdentity } from './process.js';

interface FileIdentity { dev: number; ino: number }
export interface LegacyFence {
  version: 1; id: string; repositoryId: string; commonDirectory: string; transitionId: string; hostId: string;
  owner: LegacyOwner; ownerDigest: string; directory?: FileIdentity; file?: FileIdentity;
  phase: 'preparing' | 'frozen' | 'releasing' | 'released'; createdAt: string; releasedBy?: string;
}
/** A macOS filesystem fence for the preserved legacy lease protocol. The
 * historical process identity is truthful; the kernel flag, not a fictitious
 * live process or lease timeout, prevents stale-owner reclamation. Only an
 * independently qualified cooperating-writer cutover may use this primitive. */
export class LegacyAuthorityFence {
  constructor(readonly store: Journal) {}
  retained(repo: Enrolled): LegacyFence | undefined { return this.store.record<LegacyFence>('legacyAuthorityFence', repo.id); }
  private path(repo: Enrolled): string { return join(repo.commonDir, 'primary-checkout-mutation.lock'); }
  private save(value: LegacyFence): void {
    this.store.transaction(() => { this.store.put('legacyAuthorityFence', value.repositoryId, value); this.store.put('legacyAuthorityFenceHistory', value.id, value); });
  }
  private flags(path: string): number {
    requireValue(process.platform === 'darwin', 'LEGACY_FENCE_UNSUPPORTED', 'Persistent legacy writer fencing requires the qualified macOS filesystem.', 3);
    try {
      const output = execFileSync('/usr/bin/stat', ['-f', '%f', path], { encoding: 'utf8', timeout: 5000, maxBuffer: 4096 }).trim();
      requireValue(/^\d+$/.test(output), 'LEGACY_FENCE_UNCONFIRMED', 'The filesystem did not return an unambiguous flag observation.', 3);
      return Number(output);
    } catch (error) { if (error instanceof Fault) throw error; throw new Fault('LEGACY_FENCE_UNCONFIRMED', 'Cannot observe the retained legacy fence. Preserve it for reconciliation.', 3); }
  }
  private changeFlag(path: string, flag: 'uchg' | 'nouchg'): void {
    try { execFileSync('/usr/bin/chflags', [flag, path], { timeout: 5000, maxBuffer: 4096 }); }
    catch { throw new Fault('LEGACY_FENCE_UNCONFIRMED', 'The filesystem could not confirm the owned legacy fence change. Reconcile the same transition.', 3); }
    const fd = openSync(path, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); }
  }
  private inspect(repo: Enrolled, retained: LegacyFence): { directory: FileIdentity; file: FileIdentity; flags: number } {
    requireValue(retained.version === 1 && retained.repositoryId === repo.id && retained.hostId === this.store.hostId && retained.commonDirectory === repo.commonDir &&
      realpathSync(repo.commonDir) === repo.commonDir, 'LEGACY_FENCE_CHANGED', 'The retained fence belongs to a different clone or host.', 3);
    const path = this.path(repo), directory = lstatSync(path, { throwIfNoEntry: false }), file = lstatSync(join(path, 'owner.json'), { throwIfNoEntry: false });
    requireValue(directory && file, 'LEGACY_FENCE_CHANGED', 'The owned fence or historical owner is missing.', 3);
    requireValue(directory?.isDirectory() && !directory.isSymbolicLink() && directory.uid === process.getuid?.() && (directory.mode & 0o077) === 0 &&
      file?.isFile() && !file.isSymbolicLink() && file.uid === process.getuid?.() && file.nlink === 1 && file.size <= 8192 && (file.mode & 0o077) === 0 && readdirSync(path).join() === 'owner.json',
      'LEGACY_FENCE_CHANGED', 'The retained legacy fence is absent, replaced or contains unowned files. Preserve it for inspection.', 3);
    requireValue(digest(readFileSync(join(path, 'owner.json'))) === retained.ownerDigest && digest(LegacyPrimaryLease.inspect(repo.commonDir)) === digest(retained.owner),
      'LEGACY_FENCE_CHANGED', 'The historical lease owner changed. Never reclaim an unconfirmed fence.', 3);
    for (const [expected, observed] of [[retained.directory, directory], [retained.file, file]] as const)
      requireValue(!expected || (expected.dev === observed.dev && expected.ino === observed.ino), 'LEGACY_FENCE_CHANGED', 'The owned fence filesystem identity changed.', 3);
    const flags = this.flags(path);
    requireValue(flags === 0 || flags === 2, 'LEGACY_FENCE_CHANGED', 'Unrecognized filesystem flags require inspection; Contribution will not clear them.', 3);
    return { directory: { dev: directory.dev, ino: directory.ino }, file: { dev: file.dev, ino: file.ino }, flags };
  }
  verify(repo: Enrolled): LegacyFence {
    const retained = this.retained(repo);
    requireValue(retained?.phase === 'frozen', 'LEGACY_FENCE_REQUIRED', 'The companion needs a confirmed persistent legacy writer fence.', 3);
    requireValue(this.inspect(repo, retained).flags === 2, 'LEGACY_FENCE_LOST', 'The companion legacy writer fence is no longer immutable. Stop and reconcile both hosts.', 3);
    return retained;
  }
  assertWriter(repo: Enrolled): void {
    requireValue(!this.retained(repo) || this.retained(repo)?.phase === 'released', 'LEGACY_AUTHORITY_FROZEN', 'The legacy writer fence remains retained until this host is the confirmed canonical owner.', 3);
  }
  freeze(repo: Enrolled, transitionId: string): LegacyFence {
    let retained = this.retained(repo);
    if (retained?.phase === 'frozen') return this.verify(repo);
    requireValue(!retained || retained.phase === 'released' || retained.transitionId === transitionId, 'LEGACY_FENCE_PENDING', 'Reconcile the earlier legacy authority transition first.', 3);
    requireValue(retained?.phase !== 'releasing', 'LEGACY_FENCE_PENDING', 'Complete the confirmed owner activation before another transfer.', 3);
    if (!retained || retained.phase === 'released') {
      const owner = LegacyPrimaryLease.ownerFor(transitionId);
      retained = { version: 1, id: id(), repositoryId: repo.id, commonDirectory: repo.commonDir, hostId: this.store.hostId, transitionId,
        owner, ownerDigest: digest(Buffer.from(JSON.stringify(owner) + '\n')), phase: 'preparing', createdAt: now() };
      // The intended exact owner is durable before a lease directory can exist.
      this.save(retained);
    }
    if (!existsSync(this.path(repo))) {
      requireValue(!retained.directory, 'LEGACY_FENCE_LOST', 'An acquired legacy fence disappeared. Do not silently reacquire authority.', 3);
      const owner = LegacyPrimaryLease.ownerFor(transitionId);
      retained = { ...retained, owner, ownerDigest: digest(Buffer.from(JSON.stringify(owner) + '\n')) }; this.save(retained);
      new LegacyPrimaryLease(repo.commonDir, transitionId, owner); // deliberately retained, never released on service exit
    } else requireValue(retained.owner.pid === process.pid && retained.owner.start_time === processIdentity(process.pid) || !alive(retained.owner.pid) || Boolean(processIdentity(retained.owner.pid) && processIdentity(retained.owner.pid) !== retained.owner.start_time),
      'LEGACY_FENCE_CREATOR_ACTIVE', 'The original fence creator is still active or its identity is unknown.', 3);
    return LegacyPrimaryLease.withRecovery(repo.commonDir, () => {
      const observed = this.inspect(repo, retained!); retained = { ...retained!, directory: observed.directory, file: observed.file }; this.save(retained);
      if (observed.flags === 0) this.changeFlag(this.path(repo), 'uchg');
      requireValue(this.inspect(repo, retained).flags === 2, 'LEGACY_FENCE_UNCONFIRMED', 'The persistent fence is not confirmed.', 3);
      retained = { ...retained, phase: 'frozen' }; this.save(retained); return retained;
    });
  }
  releaseForOwner(repo: Enrolled, transitionId: string): void {
    const authority = this.store.record<{ phase: string; transitionId: string; ownerHostId: string }>('authority', repo.id);
    requireValue(authority?.phase === 'active' && authority.transitionId === transitionId && authority.ownerHostId === this.store.hostId && repo.canonicalHostId === this.store.hostId,
      'LEGACY_RELEASE_UNAUTHORIZED', 'Only this host’s durably confirmed canonical transition may release its own legacy fence.', 3);
    let retained = this.retained(repo); requireValue(retained, 'LEGACY_FENCE_REQUIRED', 'The activation has no retained legacy fence.', 3);
    if (retained.phase === 'released') { requireValue(retained.releasedBy === transitionId, 'LEGACY_FENCE_CHANGED', 'A different activation released this fence.', 3); return; }
    requireValue(retained.phase === 'frozen' || retained.phase === 'releasing', 'LEGACY_FENCE_PENDING', 'Confirm the owned persistent fence before activation.', 3);
    LegacyPrimaryLease.withRecovery(repo.commonDir, () => {
      if (retained!.phase === 'frozen') { this.verify(repo); retained = { ...retained!, phase: 'releasing', releasedBy: transitionId }; this.save(retained); }
      requireValue(retained!.releasedBy === transitionId, 'LEGACY_FENCE_CHANGED', 'A different activation owns this release.', 3);
      if (existsSync(this.path(repo))) {
        const observed = this.inspect(repo, retained!);
        if (observed.flags === 2) this.changeFlag(this.path(repo), 'nouchg');
        requireValue(this.inspect(repo, retained!).flags === 0, 'LEGACY_FENCE_UNCONFIRMED', 'The fence has not been released.', 3);
        requireValue(LegacyPrimaryLease.removeOwned(this.path(repo), retained!.owner), 'LEGACY_FENCE_CHANGED', 'The owned lease changed before removal.', 3);
        const fd = openSync(repo.commonDir, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); }
      }
      this.save({ ...retained!, phase: 'released' });
    });
  }
}
