import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { dirname } from 'node:path';
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
