import { closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readSync, realpathSync, writeSync } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { dirname } from 'node:path';
import { digest, requireValue } from './core.js';

/** Retain inode and parent identity across requests, without making mutable
 * length/timestamps part of the immutable transfer selection. */
export interface IncomingFileIdentity { device: string; inode: string; parent: string; parentDevice: string; parentInode: string }
function identity(path: string, info: BigIntStats): IncomingFileIdentity {
  const parent = realpathSync(dirname(path)), directory = lstatSync(parent, { bigint: true });
  requireValue(directory.isDirectory() && directory.uid === BigInt(process.getuid?.() ?? -1) && (directory.mode & 0o077n) === 0n,
    'TRANSFER_FILE_CHANGED', 'Incoming bytes require an owned private directory.', 3);
  return { device: String(info.dev), inode: String(info.ino), parent, parentDevice: String(directory.dev), parentInode: String(directory.ino) };
}
function inspect(path: string, maxBytes: number, expected?: IncomingFileIdentity): BigIntStats {
  const info = lstatSync(path, { bigint: true });
  requireValue(info.isFile() && !info.isSymbolicLink() && info.uid === BigInt(process.getuid?.() ?? -1) && info.nlink === 1n && [0o600n, 0o400n].includes(info.mode & 0o777n) && info.size <= BigInt(maxBytes),
    'TRANSFER_FILE_CHANGED', 'The retained incoming file is no longer private, bounded and unshared.', 3);
  const current = identity(path, info);
  requireValue(!expected || digest(current) === digest(expected), 'TRANSFER_FILE_CHANGED', 'The incoming file or its containing directory was replaced. Preserve the retained transfer for reconciliation.', 3);
  return info;
}
function same(a: BigIntStats, b: BigIntStats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mode === b.mode && a.uid === b.uid && a.nlink === b.nlink && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}
export function incomingFileIdentity(path: string): IncomingFileIdentity { return identity(path, inspect(path, 0)); }
export function incomingFileSize(path: string, maxBytes: number, expected: IncomingFileIdentity | undefined): number {
  requireValue(expected, 'TRANSFER_RECOVERY_REQUIRED', 'This older incoming transfer has no retained file ownership identity. Preserve its bytes for explicit reconciliation.', 3);
  return Number(inspect(path, maxBytes, expected).size);
}
/** One finite descriptor operation. A lost acknowledgement or interrupted
 * short write can resume the identical chunk, but never overwrite its prefix. */
export function retainIncomingChunk(path: string, maxBytes: number, expected: IncomingFileIdentity | undefined, offset: number, data: Buffer): number {
  requireValue(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= 1024 ** 3 && Number.isSafeInteger(offset) && offset >= 0 && data.length > 0 && data.length <= 256 * 1024 && offset + data.length <= maxBytes,
    'INVALID_CHUNK', 'The incoming chunk range exceeds its finite transfer bounds.', 2);
  requireValue(expected, 'TRANSFER_RECOVERY_REQUIRED', 'The incoming file has no retained ownership identity.', 3);
  const initial = inspect(path, maxBytes, expected);
  requireValue((initial.mode & 0o777n) === 0o600n, 'TRANSFER_ALREADY_SEALED', 'This incoming file is already sealed; reconcile its completion receipt.', 3);
  const fd = openSync(path, constants.O_RDWR | constants.O_NOFOLLOW);
  try {
    let before = fstatSync(fd, { bigint: true });
    requireValue(same(initial, before), 'TRANSFER_FILE_CHANGED', 'The incoming file changed before opening.', 3);
    const verify = (): void => requireValue(same(before, fstatSync(fd, { bigint: true })) && same(before, inspect(path, maxBytes, expected)),
      'TRANSFER_FILE_CHANGED', 'The incoming file changed during its retained write.', 3);
    verify(); const current = Number(before.size);
    requireValue(offset <= current, 'CHUNK_OFFSET', 'Resume at the last retained byte offset.');
    const overlap = Math.min(data.length, current - offset), retained = Buffer.alloc(overlap); let count = 0;
    while (count < overlap) { const n = readSync(fd, retained, count, overlap - count, offset + count); requireValue(n > 0, 'TRANSFER_FILE_CHANGED', 'The incoming prefix became incomplete.', 3); count += n; }
    requireValue(retained.equals(data.subarray(0, overlap)), 'CHUNK_CONFLICT', 'Previously retained bytes differ from the selected chunk.');
    verify(); let written = overlap;
    while (written < data.length) {
      verify(); const n = writeSync(fd, data, written, data.length - written, offset + written);
      requireValue(n > 0, 'TRANSFER_WRITE_FAILED', 'The incoming chunk could not make write progress.', 3); written += n;
      const after = fstatSync(fd, { bigint: true });
      requireValue(after.dev === before.dev && after.ino === before.ino && after.mode === before.mode && after.uid === before.uid && after.nlink === 1n && Number(after.size) === offset + written,
        'TRANSFER_FILE_CHANGED', 'Incoming file identity or length changed during the write.', 3);
      before = after; verify();
    }
    fsyncSync(fd); verify(); return Number(before.size);
  } finally { closeSync(fd); }
}
