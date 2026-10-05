import { closeSync, constants, existsSync, fstatSync, fsyncSync, linkSync, lstatSync, openSync, realpathSync, unlinkSync, writeSync } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { digest, id, requireValue } from './core.js';
import { git } from './git.js';
import type { Journal } from './journal.js';
import { alive, processIdentity } from './process.js';
import { privateDirectory } from './private-files.js';
import { stableFileDigest } from './bounded-file.js';

export const MAX_GIT_BUNDLE = 256 * 1024 * 1024;
interface FileIdentity { dev: string; ino: string; size: string; mtime: string; mode: string; uid: string }
interface Production {
  id: string; identity: string; path: string; partial: string; parent: string;
  owner: { pid: number; start: string }; state: 'writing' | 'interrupted' | 'sealed' | 'publishing' | 'completed';
  file?: FileIdentity; bundle?: { bytes: number; sha256: string };
}
const active = new WeakMap<Journal, Map<string, Promise<void>>>();
function fileIdentity(info: BigIntStats): FileIdentity {
  return { dev: String(info.dev), ino: String(info.ino), size: String(info.size), mtime: String(info.mtimeNs), mode: String(info.mode), uid: String(info.uid) };
}
function isOwned(info: BigIntStats): boolean { return info.isFile() && !info.isSymbolicLink() && info.uid === BigInt(process.getuid?.() ?? -1); }
function syncDirectory(path: string): void { const fd = openSync(path, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } }

/** Git writes binary stdout into a finite private sink. The destination becomes
 * visible only after sealing; no existing path is overwritten. Interrupted
 * producers retain their partial files and immutable source refs. */
export async function createBoundedBundle(store: Journal, requestId: string, source: string, sourceRef: string, tip: string, path: string, maxBytes = MAX_GIT_BUNDLE): Promise<void> {
  const identity = digest({ source, sourceRef, tip, path, maxBytes });
  const queue = active.get(store) ?? new Map<string, Promise<void>>(); active.set(store, queue);
  const previous = queue.get(requestId) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(() => produce(store, requestId, identity, source, sourceRef, path, maxBytes)); queue.set(requestId, next);
  try { await next; } finally { if (queue.get(requestId) === next) queue.delete(requestId); }
}
async function produce(store: Journal, requestId: string, identity: string, source: string, sourceRef: string, path: string, maxBytes: number): Promise<void> {
  requireValue(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= MAX_GIT_BUNDLE, 'INVALID_BUNDLE_BOUND', 'Git bundle production requires a finite supported bound.');
  let record = store.record<Production>('bundleProduction', requestId);
  requireValue(!record || record.identity === identity, 'REQUEST_ID_CONFLICT', 'The bundle producer already retained another source selection.');
  const save = (value: Production): void => store.transaction(() => { store.put('bundleProductionAttempt', value.id, value); store.put('bundleProduction', requestId, value); });
  if (record && ['sealed', 'publishing', 'completed'].includes(record.state)) { publish(record, maxBytes, save); return; }
  // Bundles produced by older payloads still undergo caller-owned ref/digest
  // validation. This producer never replaces or edits an existing artifact.
  if (!record && existsSync(path)) return;
  requireValue(!existsSync(path), 'BUNDLE_RECOVERY_REQUIRED', 'An unexpected bundle occupies the destination. Preserve it for reconciliation.', 3);
  if (record?.state === 'writing' && alive(record.owner.pid)) {
    const start = processIdentity(record.owner.pid);
    requireValue(start && start !== record.owner.start, 'BUNDLE_PRODUCER_ACTIVE', 'The retained bundle writer may still be active. Reconcile its owner before retrying.', 3);
  }
  store.assertAdmissionStorage(); privateDirectory(dirname(path));
  const start = processIdentity(process.pid); requireValue(start, 'PROCESS_IDENTITY_UNAVAILABLE', 'Cannot retain the bundle writer identity.', 3);
  record = { id: id(), identity, path, partial: join(dirname(path), `${id()}.partial`), parent: realpathSync(dirname(path)), owner: { pid: process.pid, start }, state: 'writing' };
  save(record);
  let fd: number | undefined;
  try {
    fd = openSync(record.partial, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const initial = fstatSync(fd, { bigint: true }), partial = record.partial, descriptor = fd, parent = record.parent, hash = createHash('sha256');
    let last = fileIdentity(initial);
    const result = await git(source, ['bundle', 'create', '-', sourceRef], {
      timeoutMs: 300000, maxBytes: 1024 * 1024, stdoutSink: { maxBytes, write: data => {
        const current = fstatSync(descriptor, { bigint: true }), named = lstatSync(partial, { bigint: true });
        requireValue(isOwned(current) && current.nlink === 1n && named.nlink === 1n && digest(fileIdentity(current)) === digest(last) && digest(fileIdentity(current)) === digest(fileIdentity(named)) && realpathSync(dirname(path)) === parent,
          'BUNDLE_RECOVERY_REQUIRED', 'The private bundle output changed during production.', 3);
        let offset = 0; while (offset < data.length) { const written = writeSync(descriptor, data, offset, data.length - offset); requireValue(written > 0, 'BUNDLE_WRITE_FAILED', 'The bundle output could not be retained.'); offset += written; }
        hash.update(data); last = fileIdentity(fstatSync(descriptor, { bigint: true }));
      } }
    });
    requireValue(result.code === 0, result.outputLimited ? 'BUNDLE_SIZE_LIMIT' : 'BUNDLE_CREATION_FAILED',
      result.outputLimited ? 'The Git bundle exceeded its finite output limit. Source history and bounded partial output remain retained.' : 'Bundle creation did not finish. Retry the original request; retained source history remains unchanged.', 3);
    fsyncSync(fd); closeSync(fd); fd = undefined;
    const bundle = stableFileDigest(record.partial, maxBytes, 'BUNDLE_RECOVERY_REQUIRED');
    requireValue(bundle.sha256 === hash.digest('hex') && digest(fileIdentity(lstatSync(record.partial, { bigint: true }))) === digest(last), 'BUNDLE_RECOVERY_REQUIRED', 'Bundle output changed before it could be sealed.');
    record = { ...record, state: 'sealed', bundle, file: fileIdentity(lstatSync(record.partial, { bigint: true })) }; save(record);
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    if (record.state === 'writing') save({ ...record, state: 'interrupted' });
    throw error;
  }
  publish(record, maxBytes, save);
}
function publish(record: Production, maxBytes: number, save: (value: Production) => void): void {
  requireValue(record.file && record.bundle && realpathSync(dirname(record.path)) === record.parent, 'BUNDLE_RECOVERY_REQUIRED', 'The sealed bundle identity or directory changed.', 3);
  const check = (path: string): BigIntStats => {
    const info = lstatSync(path, { bigint: true });
    requireValue(isOwned(info) && digest(fileIdentity(info)) === digest(record.file), 'BUNDLE_RECOVERY_REQUIRED', 'Sealed output changed. Preserve it for reconciliation.', 3); return info;
  };
  if (record.state === 'completed') {
    check(record.path); requireValue(digest(stableFileDigest(record.path, maxBytes, 'BUNDLE_RECOVERY_REQUIRED')) === digest(record.bundle), 'BUNDLE_RECOVERY_REQUIRED', 'Completed bundle bytes changed.'); return;
  }
  if (!existsSync(record.path)) {
    requireValue(check(record.partial).nlink === 1n, 'BUNDLE_RECOVERY_REQUIRED', 'The sealed partial is shared outside its producer.');
    record = { ...record, state: 'publishing' }; save(record);
    // link is an atomic no-replace publication. Its only temporary extra link
    // is verified below before removing this exact generated partial name.
    linkSync(record.partial, record.path); syncDirectory(dirname(record.path));
  }
  const final = check(record.path);
  if (existsSync(record.partial)) {
    const partial = check(record.partial);
    requireValue(final.nlink === 2n && partial.nlink === 2n && final.dev === partial.dev && final.ino === partial.ino, 'BUNDLE_RECOVERY_REQUIRED', 'The publication names no longer identify one owned artifact.');
    unlinkSync(record.partial); syncDirectory(dirname(record.path));
  }
  requireValue(digest(stableFileDigest(record.path, maxBytes, 'BUNDLE_RECOVERY_REQUIRED')) === digest(record.bundle), 'BUNDLE_RECOVERY_REQUIRED', 'Published bundle bytes changed.');
  save({ ...record, state: 'completed' });
}
