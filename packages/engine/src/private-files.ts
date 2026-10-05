import { mkdirSync, lstatSync, chmodSync } from 'node:fs';
import { requireValue } from './core.js';
export function privateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  requireValue(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid?.(), 'UNSAFE_STATE_DIRECTORY', 'State must be a real directory owned by the current user.', 3);
  chmodSync(path, 0o700);
}
