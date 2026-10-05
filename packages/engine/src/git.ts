import { realpathSync, existsSync, readdirSync, lstatSync, readlinkSync, openSync, closeSync, fstatSync, readSync, constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, relative, isAbsolute, dirname } from 'node:path';
import { Fault, requireValue, digest, redact } from './core.js';
import { executable, run } from './process.js';
import type { RunOptions, ProcessResult } from './process.js';

export async function git(path: string, args: readonly string[], options: RunOptions = {}): Promise<ProcessResult> {
  return run(executable('git'), ['-C', path, ...args], options);
}
export async function gitText(path: string, args: readonly string[], options: RunOptions = {}): Promise<string> {
  const result = await git(path, args, options);
  if (result.code !== 0) throw new Fault('GIT_FAILED', `Git ${args[0] ?? 'operation'} failed.`, 5, { diagnostic: redact(result.stderr).slice(0, 2048) });
  return result.stdout.trim();
}
export interface GitIdentity { path: string; commonDir: string; branch: string | null; tip: string | null; objectFormat: string }
export async function identity(path: string): Promise<GitIdentity> {
  const root = await gitText(path, ['rev-parse', '--show-toplevel']);
  const common = await gitText(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const branch = await git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const tip = await git(root, ['rev-parse', '--verify', 'HEAD^{commit}']);
  return { path: realpathSync(root), commonDir: realpathSync(common), branch: branch.code === 0 ? branch.stdout.trim() : null,
    tip: tip.code === 0 ? tip.stdout.trim() : null, objectFormat: await gitText(root, ['rev-parse', '--show-object-format']) };
}
export function oid(value: string, format: string): void {
  requireValue(new RegExp(`^[0-9a-f]{${format === 'sha256' ? 64 : 40}}$`).test(value), 'INVALID_OID', 'Expected a full commit object ID.', 2);
}
export async function clean(path: string): Promise<void> {
  requireValue((await gitText(path, ['status', '--porcelain=v1', '--untracked-files=all'])).length === 0, 'DIRTY_PRIMARY', 'This operation requires a clean checkout; preserve and resolve its existing changes.');
  const dir = await gitText(path, ['rev-parse', '--absolute-git-dir']);
  for (const name of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'index.lock'])
    requireValue(!existsSync(join(dir, name)), 'GIT_OPERATION_ACTIVE', 'A Git operation is already active in this checkout.');
}
export async function ordinaryHistory(path: string, tip: string): Promise<void> {
  requireValue(await gitText(path, ['rev-parse', '--is-shallow-repository']) === 'false', 'SHALLOW_HISTORY', 'Complete the declared ancestry before submission.');
  const tree = await gitText(path, ['ls-tree', '-r', tip]);
  requireValue(!/^160000 /m.test(tree), 'SUBMODULE_UNSUPPORTED', 'This adapter does not materialize submodule content.');
  // Inspect committed pointer content, never the caller working directory.
  const lfs = await git(path, ['grep', '-l', '-F', 'version https://git-lfs.github.com/spec/v1', tip, '--']);
  requireValue(lfs.code === 1, lfs.code === 0 ? 'LFS_UNSUPPORTED' : 'HISTORY_INSPECTION_FAILED', 'Complete Git LFS content support is unavailable in this adapter.');
}
export async function discover(root: string, maxDepth = 3, maxDirectories = 250): Promise<GitIdentity[]> {
  const found = new Map<string, GitIdentity>(); let count = 0;
  const visit = async (path: string, depth: number): Promise<void> => {
    if (++count > maxDirectories) return;
    if (existsSync(join(path, '.git'))) { try { const repo = await identity(path); found.set(repo.commonDir, repo); } catch { /* a discovered folder is not necessarily a repository */ } return; }
    if (depth >= maxDepth) return;
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith('.') && !['node_modules', 'Library'].includes(entry.name)) await visit(join(path, entry.name), depth + 1);
      if (count >= maxDirectories) break;
    }
  }; await visit(realpathSync(root), 0); return [...found.values()];
}
export function contained(root: string, subpath: string): string {
  requireValue(!isAbsolute(subpath), 'INVALID_CHECK_DIRECTORY', 'Check directories must be relative to the selected checkout.', 2);
  const path = realpathSync(resolve(root, subpath)); const rel = relative(realpathSync(root), path);
  requireValue(rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel), 'INVALID_CHECK_DIRECTORY', 'Check directory escapes the selected checkout.', 2); return path;
}
export async function inputFingerprint(path: string): Promise<string> {
  const root = realpathSync(path);
  const status = await gitText(path, ['status', '--porcelain=v1', '--untracked-files=all']);
  const tracked = await git(path, ['diff', '--no-ext-diff', '--no-textconv', '--binary', 'HEAD'], { maxBytes: 16 * 1024 * 1024 });
  const staged = await git(path, ['diff', '--no-ext-diff', '--no-textconv', '--binary', '--cached', 'HEAD'], { maxBytes: 16 * 1024 * 1024 });
  requireValue(tracked.code === 0 && staged.code === 0, 'SOURCE_INSPECTION_FAILED', 'Cannot fingerprint the complete working and staged source changes.');
  const files = (await gitText(path, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean);
  requireValue(files.length <= 10000, 'SOURCE_INSPECTION_LIMIT', 'Too many untracked files for a bounded current-source check.', 3);
  let bytes = 0;
  const untracked = files.map(file => {
    requireValue(!isAbsolute(file) && !file.split('/').some(part => part === '..' || part === '.' || !part), 'SOURCE_INSPECTION_FAILED', 'Git returned an invalid source path.', 3);
    const target = join(root, file), parent = realpathSync(dirname(target));
    requireValue(parent === root || parent.startsWith(root + '/'), 'SOURCE_INSPECTION_FAILED', 'An untracked source directory changed into a link outside this checkout.', 3);
    const info = lstatSync(target);
    if (info.isSymbolicLink()) return [file, 'symlink', digest(readlinkSync(target))]; // hash the link, never read another file through it
    bytes += info.size;
    requireValue(info.isFile() && info.size <= 16 * 1024 * 1024 && bytes <= 64 * 1024 * 1024, 'SOURCE_INSPECTION_LIMIT', 'Untracked source exceeds the bounded regular-file inspection limit.', 3);
    const fd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW), hash = createHash('sha256'), buffer = Buffer.alloc(64 * 1024);
    try {
      const before = fstatSync(fd);
      requireValue(before.isFile() && before.dev === info.dev && before.ino === info.ino && before.size === info.size, 'SOURCE_CHANGED', 'An untracked input changed while opening.', 3);
      let length = 0;
      for (;;) { const count = readSync(fd, buffer, 0, Math.min(buffer.length, before.size + 1 - length), null); if (!count) break; length += count; requireValue(length <= before.size, 'SOURCE_CHANGED', 'An untracked input grew during inspection.', 3); hash.update(buffer.subarray(0, count)); }
      const after = fstatSync(fd), current = lstatSync(target);
      requireValue(length === before.size && after.size === before.size && after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs && current.dev === before.dev && current.ino === before.ino && realpathSync(dirname(target)) === parent,
        'SOURCE_CHANGED', 'An untracked input changed during inspection.', 3);
      return [file, 'file', before.mode & 0o111, hash.digest('hex')];
    } finally { closeSync(fd); }
  });
  return digest({ version: 2, status, tracked: tracked.stdout, staged: staged.stdout, untracked });
}
