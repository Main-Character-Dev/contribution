import { existsSync, mkdirSync, lstatSync, readFileSync, readdirSync, writeFileSync, renameSync, unlinkSync, rmdirSync, openSync, closeSync, fsyncSync } from 'node:fs';
import { join } from 'node:path';
import { id, now, requireValue } from './core.js';
import { processIdentity } from './process.js';
import { privateDirectory } from './private-files.js';

export interface FlightOwner {
  version: 2; token: string; pid: number; candidate_sha: string; validation_requirements_digest: string;
  requested_at: string; start_time: string; acquired_at?: string;
}
export type FlightResult = { status: 'acquired' | 'joining' | 'conflict'; owner: FlightOwner } |
  { status: 'waiting'; reason: string; position?: number; owner?: FlightOwner };

/** Compatible with existing worktree-landing/flight version-2 owners and FIFO.
 * Joining records coordination only; the original policy still owns receipt
 * validation. Neither age nor a missing process observation grants ownership.
 */
export class LegacyLandingFlight {
  readonly root: string;
  readonly request: FlightOwner;
  readonly requestPath: string;
  private ownsActive = false;
  private finished = false;
  constructor(commonDirectory: string, candidateSha: string, requirementsDigest = '') {
    requireValue(/^[0-9a-f]{40}$/.test(candidateSha), 'SOURCE_FORMAT_UNSUPPORTED', 'The adopted landing-flight protocol requires a SHA-1 candidate.', 3);
    requireValue(requirementsDigest === '' || /^[0-9a-f]{64}$/.test(requirementsDigest), 'INVALID_POLICY_DIGEST', 'Use the original landing requirements digest.', 2);
    const start = processIdentity(process.pid); requireValue(start, 'PROCESS_IDENTITY_UNAVAILABLE', 'Cannot establish a live landing-flight owner.', 3);
    privateDirectory(join(commonDirectory, 'worktree-landing'));
    this.root = join(commonDirectory, 'worktree-landing', 'flight'); privateDirectory(this.root); privateDirectory(join(this.root, 'queue'));
    this.request = { version: 2, token: id(), pid: process.pid, candidate_sha: candidateSha, validation_requirements_digest: requirementsDigest, requested_at: now(), start_time: start };
    this.requestPath = join(this.root, 'queue', `${String(Date.now()).padStart(13, '0')}-${this.request.token}.json`);
    this.write(this.requestPath, this.request); this.sync(join(this.root, 'queue'));
  }
  private sync(path: string): void { const fd = openSync(path, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } }
  private write(path: string, value: unknown): void { writeFileSync(path, JSON.stringify(value) + '\n', { flag: 'wx', mode: 0o600 }); this.sync(path); }
  private read(path: string): FlightOwner | null {
    try {
      const info = lstatSync(path);
      if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid?.() || info.size > 8192) return null;
      const value = JSON.parse(readFileSync(path, 'utf8')) as FlightOwner;
      return [1, 2].includes(value.version) && typeof value.token === 'string' && Number.isSafeInteger(value.pid) && typeof value.start_time === 'string' ? value : null;
    } catch { return null; }
  }
  private removeOwner(directory: string): boolean {
    if (!existsSync(directory)) return false;
    const info = lstatSync(directory); if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.() || readdirSync(directory).join() !== 'owner.json') return false;
    const owner = this.read(join(directory, 'owner.json'));
    if (owner?.token !== this.request.token || owner.pid !== this.request.pid || owner.start_time !== this.request.start_time) return false;
    unlinkSync(join(directory, 'owner.json')); rmdirSync(directory); this.sync(this.root); return true;
  }
  private removeRequest(): void {
    const request = this.read(this.requestPath);
    if (request?.token === this.request.token && request.pid === this.request.pid && request.start_time === this.request.start_time) { unlinkSync(this.requestPath); this.sync(join(this.root, 'queue')); }
  }
  tryAcquire(): FlightResult {
    requireValue(!this.finished, 'FLIGHT_ALREADY_FINISHED', 'This landing-flight request already joined, conflicted or finished.');
    requireValue(processIdentity(this.request.pid) === this.request.start_time, 'PROCESS_IDENTITY_CHANGED', 'The original landing-flight process is no longer present.');
    const active = join(this.root, 'active');
    if (this.ownsActive) {
      const owner = this.read(join(active, 'owner.json'));
      requireValue(owner?.token === this.request.token, 'FLIGHT_OWNERSHIP_CHANGED', 'The active landing-flight owner changed.'); return { status: 'acquired', owner };
    }
    const coordinator = join(this.root, 'coordinator.lock');
    try { mkdirSync(coordinator, { mode: 0o700 }); }
    catch (error) { if (['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) return { status: 'waiting', reason: 'coordinator_owned_or_unresolved' }; throw error; }
    try {
      this.write(join(coordinator, 'owner.json'), { ...this.request, version: 1, acquired_at: now() }); this.sync(coordinator);
      if (existsSync(active)) {
        const info = lstatSync(active), owner = !info.isSymbolicLink() && info.isDirectory() ? this.read(join(active, 'owner.json')) : null;
        if (!owner || !owner.start_time || processIdentity(owner.pid) !== owner.start_time) return { status: 'waiting', reason: 'retained_owner_requires_reconciliation' };
        if (owner.candidate_sha === this.request.candidate_sha) {
          this.removeRequest(); this.finished = true;
          return { status: (owner.validation_requirements_digest ?? '') === this.request.validation_requirements_digest ? 'joining' : 'conflict', owner };
        }
        return { status: 'waiting', reason: 'another_candidate_active', owner };
      }
      const queue = readdirSync(join(this.root, 'queue')).filter(name => name.endsWith('.json')).sort();
      const position = queue.indexOf(this.requestPath.split('/').at(-1)!);
      requireValue(position >= 0, 'FLIGHT_REQUEST_MISSING', 'The retained landing-flight queue request disappeared.');
      if (position !== 0) return { status: 'waiting', reason: 'earlier_request_retained', position: position + 1 };
      const owner: FlightOwner = { ...this.request, acquired_at: now() }, candidate = `${active}.candidate.${process.pid}.${owner.token}`;
      mkdirSync(candidate, { mode: 0o700 });
      try {
        this.write(join(candidate, 'owner.json'), owner); this.sync(candidate); renameSync(candidate, active); this.sync(this.root);
      } finally { this.removeOwner(candidate); }
      this.ownsActive = true; this.removeRequest(); return { status: 'acquired', owner };
    } finally { this.removeOwner(coordinator); }
  }
  release(): boolean {
    this.removeRequest(); this.finished = true;
    if (!this.ownsActive) return false;
    const removed = this.removeOwner(join(this.root, 'active')); if (removed) this.ownsActive = false; return removed;
  }
}
