import { closeSync, constants, fchmodSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, realpathSync, writeSync } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { dirname, join } from 'node:path';
import { appTreeDigest } from './device-artifacts.js';
import { StableFileReader } from './bounded-file.js';
import { requireValue } from './core.js';

/** Copies only a qualified tree into a new owned staging directory. Reads and
 * writes stay bounded even if a source file grows; failed output stays retained. */
export function copyAppTree(source: string, destination: string): string {
  const before = appTreeDigest(source), parent = realpathSync(dirname(destination));
  const parentIdentity = lstatSync(parent, { bigint: true });
  const directories: { path: string; stat: BigIntStats }[] = [{ path: parent, stat: parentIdentity }];
  let entries = 0, bytes = 0;
  const verifyDirectories = (): void => {
    requireValue(realpathSync(dirname(destination)) === parent, 'ARTIFACT_CHANGED', 'The retained app parent path changed.', 3);
    for (const entry of directories) {
      const current = lstatSync(entry.path, { bigint: true });
      requireValue(current.isDirectory() && !current.isSymbolicLink() && current.dev === entry.stat.dev && current.ino === entry.stat.ino && current.uid === BigInt(process.getuid?.() ?? -1),
        'ARTIFACT_CHANGED', 'A retained staging directory was replaced.', 3);
    }
  };
  const copy = (relative: string, depth: number): void => {
    requireValue(++entries <= 100000 && depth <= 32, 'ARTIFACT_TOO_LARGE', 'The retained copy exceeds its entry or nesting bound.', 3);
    verifyDirectories();
    const input = join(source, relative), output = join(destination, relative), info = lstatSync(input, { bigint: true });
    requireValue(!info.isSymbolicLink() && info.uid === BigInt(process.getuid?.() ?? -1) && (info.isDirectory() || info.isFile() && info.nlink === 1n), 'ARTIFACT_CHANGED', 'Only owned, unshared regular app entries can be retained.', 3);
    if (info.isDirectory()) {
      mkdirSync(output, { mode: 0o700 });
      const stat = lstatSync(output, { bigint: true }), fd = openSync(output, constants.O_RDONLY | constants.O_NOFOLLOW);
      directories.push({ path: output, stat });
      try {
        const opened = fstatSync(fd, { bigint: true }); requireValue(opened.dev === stat.dev && opened.ino === stat.ino, 'ARTIFACT_CHANGED', 'The new app directory was replaced.', 3);
        for (const name of readdirSync(input).sort()) copy(join(relative, name), depth + 1);
        verifyDirectories(); fchmodSync(fd, Number(info.mode & 0o777n)); fsyncSync(fd);
      } finally { closeSync(fd); directories.pop(); }
    } else {
      bytes += Number(info.size); requireValue(bytes <= 4 * 1024 ** 3, 'ARTIFACT_TOO_LARGE', 'The retained copy exceeds its finite byte bound.', 3);
      const file = new StableFileReader(input, Number(info.size), 'ARTIFACT_CHANGED'); let fd: number | undefined;
      try {
        fd = openSync(output, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        const identity = fstatSync(fd, { bigint: true });
        for (let offset = 0; offset < file.size; offset += 1024 ** 2) {
          verifyDirectories(); const named = lstatSync(output, { bigint: true });
          requireValue(named.dev === identity.dev && named.ino === identity.ino && named.nlink === 1n, 'ARTIFACT_CHANGED', 'Retained staging bytes were replaced or shared.', 3);
          const data = file.read(offset, Math.min(1024 ** 2, file.size - offset)); let written = 0;
          while (written < data.length) { const count = writeSync(fd, data, written, data.length - written); requireValue(count > 0, 'ARTIFACT_CHANGED', 'Retained staging write made no progress.', 3); written += count; }
        }
        file.verify(); fchmodSync(fd, Number(info.mode & 0o777n)); fsyncSync(fd);
      } finally { file.close(); if (fd !== undefined) closeSync(fd); }
    }
  };
  copy('', 0); verifyDirectories();
  requireValue(appTreeDigest(source) === before && appTreeDigest(destination) === before, 'ARTIFACT_CHANGED', 'App bytes or modes changed during the retained copy.', 3);
  return before;
}
