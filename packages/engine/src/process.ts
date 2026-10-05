import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, lstatSync, unlinkSync, rmdirSync, openSync, closeSync } from 'node:fs';
import { join, resolve, delimiter, basename } from 'node:path';
import { Fault, id, requireValue } from './core.js';

export function processIdentity(pid: number): string | null {
  if (!Number.isSafeInteger(pid) || pid < 1) return null;
  try { return execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8', timeout: 2000 }).trim() || null; } catch { return null; }
}
export function alive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } }
export function descendantOf(pid: number, expectedStart: string, ancestor: { pid: number; start: string }): boolean {
  if (processIdentity(pid) !== expectedStart || processIdentity(ancestor.pid) !== ancestor.start) return false;
  const seen = new Set<number>();
  for (let depth = 0; depth < 32 && pid > 1 && !seen.has(pid); depth++) {
    seen.add(pid); if (pid === ancestor.pid) return processIdentity(pid) === ancestor.start;
    const before = processIdentity(pid); if (!before) return false;
    try {
      const parent = Number(execFileSync('/bin/ps', ['-p', String(pid), '-o', 'ppid='], { encoding: 'utf8', timeout: 2000 }).trim());
      if (!Number.isSafeInteger(parent) || parent < 1 || processIdentity(pid) !== before) return false;
      pid = parent;
    } catch { return false; }
  }
  return false;
}
/** ps arguments are not an argv transport. Accept only unambiguous command
 * prefixes; scope authority still comes from the enrolled ref transaction. */
export function isGitPushCommand(command: string): boolean {
  const words = command.trim().split(/\s+/);
  if (!words[0] || basename(words.shift()!) !== 'git') return false;
  while (words.length) {
    const word = words.shift()!;
    if (word === 'push') return true;
    if (['--no-pager', '--no-optional-locks', '--literal-pathspecs'].includes(word)) continue;
    if (['-C', '-c', '--git-dir', '--work-tree', '--config-env'].includes(word)) {
      const value = words.shift(); if (!value || value.startsWith('-') || /['"\\]/.test(value)) return false;
      continue;
    }
    if (/^--(?:git-dir|work-tree|config-env)=[^\s'"\\]+$/.test(word)) continue;
    return false;
  }
  return false;
}
export function gitPushAncestor(caller: { pid: number; start: string }): { pid: number; start: string } | null {
  if (processIdentity(caller.pid) !== caller.start) return null;
  let pid = caller.pid; const seen = new Set<number>();
  for (let depth = 0; depth < 32 && pid > 1 && !seen.has(pid); depth++) {
    seen.add(pid); const start = processIdentity(pid); if (!start) return null;
    try {
      const comm = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8', timeout: 2000 }).trim();
      const command = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8', timeout: 2000 }).trim();
      const parent = Number(execFileSync('/bin/ps', ['-p', String(pid), '-o', 'ppid='], { encoding: 'utf8', timeout: 2000 }).trim());
      if (processIdentity(pid) !== start) return null;
      if (basename(comm) === 'git' && isGitPushCommand(command) && descendantOf(caller.pid, caller.start, { pid, start })) return { pid, start };
      if (!Number.isSafeInteger(parent) || parent < 1) return null; pid = parent;
    } catch { return null; }
  }
  return null;
}
export interface ProcessResult { code: number; signal: string | null; stdout: string; stderr: string; timedOut: boolean; cancelled: boolean }
export interface RunOptions { cwd?: string; env?: NodeJS.ProcessEnv; input?: string | Buffer; timeoutMs?: number; maxBytes?: number;
  signal?: AbortSignal; output?: (text: string) => void; started?: (pid: number, start: string | null) => void }
export async function run(executable: string, argv: readonly string[], options: RunOptions = {}): Promise<ProcessResult> {
  requireValue(executable.startsWith('/'), 'INVALID_EXECUTABLE', 'Executables must resolve to an absolute approved path.', 2);
  if (options.signal?.aborted) throw new Fault('CANCELLED', 'Operation cancelled before dispatch.', 130);
  const environment: NodeJS.ProcessEnv = { ...process.env, ...options.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_OPTIONAL_LOCKS: '0' };
  // A caller's Git repository/index overrides must never retarget the service.
  for (const key of Object.keys(environment)) if (/^GIT_(?:DIR$|COMMON_DIR$|WORK_TREE$|INDEX_FILE$|OBJECT_DIRECTORY$|ALTERNATE_OBJECT_DIRECTORIES$|NAMESPACE$|PREFIX$|CONFIG(?:$|_)|REPLACE_REF_BASE$)/.test(key)) delete environment[key];
  Object.assign(environment, options.env ?? {});
  return new Promise((resolveResult, reject) => {
    const child = spawn(executable, [...argv], { cwd: options.cwd, env: environment, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', bytes = 0, timedOut = false, cancelled = false, killTimer: NodeJS.Timeout | undefined;
    const pending = { stdout: '', stderr: '' };
    const maxBytes = options.maxBytes ?? 4 * 1024 * 1024;
    const stop = (): void => {
      if (!child.pid) return;
      const members = groupMembers(child.pid);
      // A still-unreaped child belongs to this process; its PID cannot be reused.
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already exited */ }
      killTimer ??= setTimeout(() => {
        const current = groupMembers(child.pid!);
        if (current.some(member => members.some(prior => prior.pid === member.pid && prior.start === member.start)))
          try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* group exited */ }
      }, 1500);
    };
    const cancel = (): void => { cancelled = true; stop(); };
    options.signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => { timedOut = true; stop(); }, options.timeoutMs ?? 30000);
    const cleanup = (): void => { clearTimeout(timer); if (killTimer) clearTimeout(killTimer); options.signal?.removeEventListener('abort', cancel); };
    child.once('spawn', () => { if (child.pid) options.started?.(child.pid, processIdentity(child.pid)); });
    child.once('error', error => { cleanup(); reject(new Fault('EXECUTABLE_UNAVAILABLE', `Cannot start ${executable}: ${(error as NodeJS.ErrnoException).code ?? 'unknown error'}`, 3)); });
    const collect = (channel: 'stdout' | 'stderr', data: Buffer): void => {
      bytes += data.length;
      if (bytes > maxBytes) { stop(); return; }
      const text = data.toString('utf8'); if (channel === 'stdout') stdout += text; else stderr += text;
      pending[channel] += text;
      const newline = pending[channel].lastIndexOf('\n');
      if (newline >= 0) { options.output?.(pending[channel].slice(0, newline + 1)); pending[channel] = pending[channel].slice(newline + 1); }
      if (pending[channel].length > 65536) { pending[channel] = '[oversized log line omitted]\n'; }
    };
    child.stdout.on('data', (data: Buffer) => collect('stdout', data)); child.stderr.on('data', (data: Buffer) => collect('stderr', data));
    child.stdin.on('error', () => { /* child may exit before consuming input */ }); child.stdin.end(options.input);
    child.once('close', (code, signal) => { cleanup(); for (const text of Object.values(pending)) if (text) options.output?.(text); resolveResult({ code: bytes > maxBytes ? 5 : code ?? 5, signal, stdout, stderr,
      timedOut, cancelled }); });
  });
}
function groupMembers(group: number): { pid: number; start: string }[] {
  try {
    return execFileSync('/bin/ps', ['-axo', 'pid=,pgid=,lstart='], { encoding: 'utf8', timeout: 2000 }).split('\n').flatMap(line => {
      const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
      return match && Number(match[2]) === group ? [{ pid: Number(match[1]), start: match[3]!.trim() }] : [];
    });
  } catch { return []; }
}
export function executable(name: string): string {
  if (name.startsWith('/')) { requireValue(existsSync(name), 'EXECUTABLE_UNAVAILABLE', `Missing executable ${name}.`, 3); return name; }
  requireValue(!name.includes('/'), 'INVALID_EXECUTABLE', 'A command must be an absolute executable or a PATH name.', 2);
  for (const directory of (process.env['PATH'] ?? '/usr/bin:/bin').split(delimiter)) {
    if (!directory.startsWith('/')) continue;
    const path = join(directory, name); if (existsSync(path) && !lstatSync(path).isDirectory()) return path;
  }
  throw new Fault('EXECUTABLE_UNAVAILABLE', `The ${name} executable is unavailable.`, 3);
}
export interface LeaseOwner { pid: number; start: string; token: string; attemptId: string }
export class Lease {
  readonly owner: LeaseOwner;
  readonly directory: string;
  constructor(commonDirectory: string, attemptId: string) {
    this.directory = join(commonDirectory, 'contribution-writer.lock');
    const start = processIdentity(process.pid);
    requireValue(start, 'PROCESS_IDENTITY_UNAVAILABLE', 'Cannot verify the writer process identity.', 3);
    this.owner = { pid: process.pid, start, token: id(), attemptId };
    try { mkdirSync(this.directory, { mode: 0o700 }); }
    catch { throw new Fault('REPOSITORY_BUSY', 'A Contribution writer lease exists. Reconcile its owner before retrying.', 4, {}, true); }
    writeFileSync(join(this.directory, 'owner.json'), JSON.stringify(this.owner), { flag: 'wx', mode: 0o600 });
  }
  static inspect(commonDirectory: string): LeaseOwner | null {
    try { return JSON.parse(readFileSync(join(commonDirectory, 'contribution-writer.lock', 'owner.json'), 'utf8')) as LeaseOwner; } catch { return null; }
  }
  static reclaim(commonDirectory: string, expected: LeaseOwner): boolean {
    const directory = join(commonDirectory, 'contribution-writer.lock'), marker = join(directory, 'reclaim');
    if (!existsSync(directory) || lstatSync(directory).isSymbolicLink() || lstatSync(directory).uid !== process.getuid?.()) return false;
    let fd: number;
    try { fd = openSync(marker, 'wx', 0o600); closeSync(fd); } catch { return false; }
    try {
      const owner = Lease.inspect(commonDirectory);
      if (!owner || owner.token !== expected.token || owner.attemptId !== expected.attemptId || (alive(owner.pid) && (!processIdentity(owner.pid) || processIdentity(owner.pid) === owner.start))) return false;
      unlinkSync(join(directory, 'owner.json')); unlinkSync(marker); rmdirSync(directory); return true;
    } finally { if (existsSync(marker)) unlinkSync(marker); }
  }
  release(): void {
    const current = Lease.inspect(resolve(this.directory, '..'));
    if (current?.token !== this.owner.token) return;
    unlinkSync(join(this.directory, 'owner.json')); rmdirSync(this.directory);
  }
}
