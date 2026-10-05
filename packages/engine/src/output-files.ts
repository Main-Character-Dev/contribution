import { lstatSync, opendirSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
import { digest, requireValue } from './core.js';

export interface OutputFile { path: string; directory: boolean; dev: number; ino: number; size: number; mtime: number; ctime: number; link?: string }
export function outputFile(path: string, allowLinks = false): OutputFile {
  const info = lstatSync(path);
  requireValue(info.uid === process.getuid?.() && (info.isDirectory() || info.isFile() && info.nlink === 1 || allowLinks && info.isSymbolicLink() && info.nlink === 1),
    'STORAGE_OUTPUT_UNCONFIRMED', 'Shared, foreign or unsupported output remains protected.', 3);
  return { path, directory: info.isDirectory(), dev: info.dev, ino: info.ino, size: info.size, mtime: info.mtimeMs, ctime: info.ctimeMs,
    ...(info.isSymbolicLink() ? { link: readlinkSync(path) } : {}) };
}
export function sameOutputFile(a: OutputFile, b: OutputFile): boolean {
  // Directory times change as reviewed children are removed. Complete names
  // are separately compared; file/link identities and bytes cannot change.
  return a.path === b.path && a.directory === b.directory && a.dev === b.dev && a.ino === b.ino && a.link === b.link &&
    (a.directory || a.size === b.size && a.mtime === b.mtime && a.ctime === b.ctime);
}
export function outputManifest(directory: string, options: { allowLinks?: boolean; excludeSource?: boolean } = {}): OutputFile[] {
  const entries: OutputFile[] = []; let bytes = 0;
  const visit = (path: string, depth: number): void => {
    requireValue(depth <= 32 && entries.length < 50000, 'STORAGE_OUTPUT_UNCONFIRMED', 'Output exceeds this bounded cleanup inspection.', 3);
    const file = outputFile(path, options.allowLinks);
    requireValue(depth > 0 || file.directory, 'STORAGE_OUTPUT_UNCONFIRMED', 'The output root must be an owned directory.', 3);
    bytes += file.directory ? 0 : file.size;
    requireValue(bytes <= 4 * 1024 ** 3, 'STORAGE_OUTPUT_UNCONFIRMED', 'Output exceeds this bounded cleanup inspection.', 3);
    entries.push(file);
    if (file.directory) {
      const handle = opendirSync(path), names: string[] = [];
      try {
        let entry;
        while ((entry = handle.readSync())) {
          if (depth === 0 && options.excludeSource && entry.name === 'source') continue;
          requireValue(names.length + entries.length < 50000, 'STORAGE_OUTPUT_UNCONFIRMED', 'Output exceeds this bounded cleanup inspection.', 3);
          names.push(entry.name);
        }
      } finally { handle.closeSync(); }
      for (const name of names.sort()) visit(join(path, name), depth + 1);
    }
  };
  visit(directory, 0);
  // Detect additions and replacements while the bounded census was running.
  for (const file of entries) requireValue(digest(outputFile(file.path, options.allowLinks)) === digest(file), 'STORAGE_OUTPUT_UNCONFIRMED', 'Output changed during inspection.', 3);
  return entries;
}
