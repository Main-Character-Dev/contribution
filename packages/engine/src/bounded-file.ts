import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import type { BigIntStats } from 'node:fs';
import { createHash } from 'node:crypto';
import { requireValue } from './core.js';

/** A size check followed by readFile is not a bound when another process can
 * append, replace or link the path. Read one verified descriptor with a finite
 * buffer and reject changes before publishing any retained bytes. */
export function readStableFile(path: string, maxBytes: number, code: string): Buffer {
  requireValue(Number.isSafeInteger(maxBytes) && maxBytes >= 0 && maxBytes <= 64 * 1024 * 1024, code, 'Invalid bounded file read.');
  const parent = realpathSync(dirname(path)), named = lstatSync(path, { bigint: true });
  const valid = (info: typeof named): boolean => info.isFile() && !info.isSymbolicLink() && info.uid === BigInt(process.getuid?.() ?? -1) && info.nlink === 1n && info.size <= BigInt(maxBytes);
  const same = (a: typeof named, b: typeof named): boolean => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs && a.mode === b.mode;
  requireValue(valid(named), code, 'The selected file must be a bounded, unshared regular file owned by this user.');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd, { bigint: true });
    requireValue(valid(before) && same(named, before), code, 'The selected file changed before it could be read.');
    const size = Number(before.size), bytes = Buffer.alloc(size + 1); let length = 0;
    while (length <= size) {
      const count = readSync(fd, bytes, length, bytes.length - length, null);
      if (!count) break;
      length += count;
      requireValue(length <= size, code, 'The selected file grew during bounded inspection.');
    }
    const after = fstatSync(fd, { bigint: true }), current = lstatSync(path, { bigint: true });
    requireValue(length === size && valid(after) && valid(current) && same(before, after) && same(before, current) && realpathSync(dirname(path)) === parent,
      code, 'The selected file or containing directory changed during inspection.');
    return bytes.subarray(0, size);
  } finally { closeSync(fd); }
}

/** Large immutable artifacts are hashed and transferred through one verified
 * descriptor. Memory is bounded independently of the allowed file size. */
export class StableFileReader {
  private readonly fd: number;
  private readonly initial: BigIntStats;
  private readonly parent: string;
  readonly size: number;
  constructor(readonly path: string, maxBytes: number, readonly code: string) {
    requireValue(Number.isSafeInteger(maxBytes) && maxBytes >= 0 && maxBytes <= 4 * 1024 ** 3, code, 'Invalid bounded artifact read.');
    this.parent = realpathSync(dirname(path));
    const named = lstatSync(path, { bigint: true });
    requireValue(named.isFile() && !named.isSymbolicLink() && named.uid === BigInt(process.getuid?.() ?? -1) && named.nlink === 1n && named.size <= BigInt(maxBytes),
      code, 'The retained artifact must be a bounded unshared regular file owned by this user.', 3);
    this.fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    this.initial = named; this.size = Number(named.size);
    try { this.verify(); } catch (error) { closeSync(this.fd); throw error; }
  }
  verify(): void {
    const same = (info: BigIntStats): boolean => info.isFile() && !info.isSymbolicLink() && info.dev === this.initial.dev && info.ino === this.initial.ino && info.size === this.initial.size &&
      info.mode === this.initial.mode && info.uid === this.initial.uid && info.nlink === 1n && info.mtimeNs === this.initial.mtimeNs && info.ctimeNs === this.initial.ctimeNs;
    requireValue(same(fstatSync(this.fd, { bigint: true })) && same(lstatSync(this.path, { bigint: true })) && realpathSync(dirname(this.path)) === this.parent,
      this.code, 'The retained artifact or its path changed during inspection or transfer.', 3);
  }
  read(offset: number, length: number): Buffer {
    requireValue(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(length) && length >= 0 && length <= 1024 ** 2 && offset + length <= this.size,
      this.code, 'The artifact read range is invalid or exceeds its finite chunk limit.', 3);
    this.verify(); const data = Buffer.alloc(length); let read = 0;
    while (read < length) {
      const count = readSync(this.fd, data, read, length - read, offset + read);
      requireValue(count > 0, this.code, 'The retained artifact became incomplete during inspection.', 3); read += count;
    }
    this.verify(); return data;
  }
  digest(): string {
    const hash = createHash('sha256');
    for (let offset = 0; offset < this.size; offset += 1024 ** 2) hash.update(this.read(offset, Math.min(1024 ** 2, this.size - offset)));
    this.verify(); return hash.digest('hex');
  }
  close(): void { closeSync(this.fd); }
}
export function stableFileDigest(path: string, maxBytes: number, code: string): { bytes: number; sha256: string } {
  const file = new StableFileReader(path, maxBytes, code);
  try { return { bytes: file.size, sha256: file.digest() }; } finally { file.close(); }
}
