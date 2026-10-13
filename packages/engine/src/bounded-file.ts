import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import type { BigIntStats } from 'node:fs';
import { createHash } from 'node:crypto';
import { requireValue } from './core.js';
import { bulkWork } from './bulk-work.js';

/** Shared owned descriptor and immutable identity checks. Buffering and size
 * policies stay with the caller; incoming writable transfers have another owner. */
class StableDescriptor {
  readonly fd: number;
  readonly initial: BigIntStats;
  private readonly parent: string;
  constructor(readonly path: string, maxBytes: number, readonly code: string, private readonly exit: number) {
    this.parent = realpathSync(dirname(path));
    this.initial = lstatSync(path, { bigint: true });
    requireValue(this.initial.isFile() && !this.initial.isSymbolicLink() && this.initial.uid === BigInt(process.getuid?.() ?? -1) && this.initial.nlink === 1n && this.initial.size <= BigInt(maxBytes),
      code, 'The selected file must be a bounded, unshared regular file owned by this user.', exit);
    this.fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { this.verify(); } catch (error) { closeSync(this.fd); throw error; }
  }
  verify(): void {
    const same = (info: BigIntStats): boolean => info.isFile() && !info.isSymbolicLink() && info.dev === this.initial.dev && info.ino === this.initial.ino && info.size === this.initial.size &&
      info.mode === this.initial.mode && info.uid === this.initial.uid && info.nlink === 1n && info.mtimeNs === this.initial.mtimeNs && info.ctimeNs === this.initial.ctimeNs;
    requireValue(same(fstatSync(this.fd, { bigint: true })) && same(lstatSync(this.path, { bigint: true })) && realpathSync(dirname(this.path)) === this.parent,
      this.code, 'The selected file or its path changed during inspection or transfer.', this.exit);
  }
  close(): void { closeSync(this.fd); }
}

/** Small reads retain an overflow sentinel and a finite whole-file buffer. */
export function readStableFile(path: string, maxBytes: number, code: string): Buffer {
  requireValue(Number.isSafeInteger(maxBytes) && maxBytes >= 0 && maxBytes <= 64 * 1024 * 1024, code, 'Invalid bounded file read.');
  const file = new StableDescriptor(path, maxBytes, code, 4);
  try {
    const size = Number(file.initial.size), bytes = Buffer.alloc(size + 1); let length = 0;
    while (length <= size) {
      const count = readSync(file.fd, bytes, length, bytes.length - length, null);
      if (!count) break;
      length += count;
      requireValue(length <= size, code, 'The selected file grew during bounded inspection.');
    }
    requireValue(length === size, code, 'The selected file became incomplete during inspection.');
    file.verify(); return bytes.subarray(0, size);
  } finally { file.close(); }
}

/** Large immutable artifacts retain a descriptor across bounded range reads. */
export class StableFileReader {
  private readonly file: StableDescriptor;
  readonly size: number;
  constructor(readonly path: string, maxBytes: number, readonly code: string) {
    requireValue(Number.isSafeInteger(maxBytes) && maxBytes >= 0 && maxBytes <= 4 * 1024 ** 3, code, 'Invalid bounded artifact read.');
    this.file = new StableDescriptor(path, maxBytes, code, 3);
    this.size = Number(this.file.initial.size);
  }
  verify(): void { this.file.verify(); }
  read(offset: number, length: number): Buffer {
    requireValue(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(length) && length >= 0 && length <= 1024 ** 2 && offset + length <= this.size,
      this.code, 'The artifact read range is invalid or exceeds its finite chunk limit.', 3);
    this.verify(); const data = Buffer.alloc(length); let read = 0;
    while (read < length) {
      const count = readSync(this.file.fd, data, read, length - read, offset + read);
      requireValue(count > 0, this.code, 'The retained artifact became incomplete during inspection.', 3); read += count;
    }
    this.verify(); return data;
  }
  digest(): string {
    const hash = createHash('sha256');
    for (let offset = 0; offset < this.size; offset += 1024 ** 2) hash.update(this.read(offset, Math.min(1024 ** 2, this.size - offset)));
    this.verify(); return hash.digest('hex');
  }
  async digestAsync(signal?: AbortSignal): Promise<string> {
    this.verify();
    const evidence = await bulkWork<{ bytes: number; sha256: string }>({ kind: 'file-digest', path: this.path, maxBytes: this.size, code: this.code }, signal);
    this.verify(); requireValue(evidence.bytes === this.size, this.code, 'The verified artifact size changed.', 3); return evidence.sha256;
  }
  close(): void { this.file.close(); }
}
export function stableFileDigest(path: string, maxBytes: number, code: string): { bytes: number; sha256: string } {
  const file = new StableFileReader(path, maxBytes, code);
  try { return { bytes: file.size, sha256: file.digest() }; } finally { file.close(); }
}
export async function stableFileDigestAsync(path: string, maxBytes: number, code: string, signal?: AbortSignal): Promise<{ bytes: number; sha256: string }> {
  const file = new StableFileReader(path, maxBytes, code);
  try { return { bytes: file.size, sha256: await file.digestAsync(signal) }; } finally { file.close(); }
}
