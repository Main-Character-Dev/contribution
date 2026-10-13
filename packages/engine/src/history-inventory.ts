import { existsSync, lstatSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { stableFileDigest } from './bounded-file.js';
import { digest, requireValue } from './core.js';

export function historyInventory(path: string): { digest: string; bytes: number } {
  requireValue(realpathSync(path) === path, 'HISTORY_ARCHIVE_CHANGED', 'The retained archive path changed.', 3);
  const files: { path: string; bytes: number; sha256: string }[] = []; let bytes = 0, entries = 0; const deadline = performance.now() + 10000;
  const visit = (dir: string, prefix = ''): void => {
    for (const entry of readdirSync(dir).sort()) {
      requireValue(performance.now() < deadline && ++entries <= 100000, 'HISTORY_ARCHIVE_LIMIT', 'Archive entry census exceeded its finite limit.', 3);
      const name = join(dir, entry), relative = prefix + entry, info = lstatSync(name);
      requireValue(!info.isSymbolicLink() && info.uid === process.getuid?.() && (info.isDirectory() || info.isFile() && info.nlink === 1), 'HISTORY_ARCHIVE_CHANGED', 'Linked, shared or replaced archive entries remain protected.', 3);
      if (info.isDirectory()) visit(name, relative + '/');
      else {
        bytes += info.size; requireValue(bytes <= 1024 ** 3, 'HISTORY_ARCHIVE_LIMIT', 'Archive exceeds the one GiB qualified source bound.', 3);
        files.push({ path: relative, ...stableFileDigest(name, 1024 ** 3, 'HISTORY_ARCHIVE_CHANGED') });
      }
    }
  };
  visit(path); requireValue(!existsSync(join(path, 'objects', 'info', 'alternates')), 'HISTORY_ARCHIVE_DEPENDENCY', 'An independent archive cannot rely on alternates.', 3);
  return { digest: digest(files), bytes };
}
