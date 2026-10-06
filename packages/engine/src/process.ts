import { fileURLToPath } from 'node:url';
import type { Writable } from 'node:stream';
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
export interface ProcessMember { pid: number; start: string }
export interface ProcessOwnership {
  intent(executable: string, argv: readonly string[]): void;
  allocated(pid: number, start: string): void;
  grant(): void;
  members(members: ProcessMember[]): void;
  stopping(): void;
  finished(result: ProcessResult): void;
  uncertain(reason: string): void;
}
export interface ProcessResult { cleanup?: { released: boolean; reason: string | null; members: ProcessMember[] };  code: number; actualExitCode?: number | null; signal: string | null; stdout: string; stderr: string; timedOut: boolean; cancelled: boolean; outputLimited?: boolean }
export interface RunOptions { ownership?: ProcessOwnership | (() => ProcessOwnership); cwd?: string; env?: NodeJS.ProcessEnv; input?: string | Buffer; timeoutMs?: number; maxBytes?: number; terminationGraceMs?: number;
  /** Grant a waiting wrapper its input only after its exact process identity
   * has been retained. A throwing callback closes input and stops the wrapper. */
  inputAfterStarted?: (pid: number, start: string) => string | Buffer;
  stdoutSink?: { maxBytes: number; write: (data: Buffer) => void };
  signal?: AbortSignal; output?: (text: string) => void; started?: (pid: number, start: string | null) => void }
export async function run(executable: string, argv: readonly string[], options: RunOptions = {}): Promise<ProcessResult> {
  requireValue(executable.startsWith('/'), 'INVALID_EXECUTABLE', 'Executables must resolve to an absolute approved path.', 2);
  requireValue(options.terminationGraceMs === undefined || Number.isSafeInteger(options.terminationGraceMs) && options.terminationGraceMs >= 0 && options.terminationGraceMs <= 30000,
    'INVALID_TERMINATION_BOUND', 'Process termination grace must remain between zero and thirty seconds.', 2);
  requireValue(!options.stdoutSink || (Number.isSafeInteger(options.stdoutSink.maxBytes) && options.stdoutSink.maxBytes >= 0 && options.stdoutSink.maxBytes <= 4 * 1024 ** 3),
    'INVALID_OUTPUT_BOUND', 'Binary process output requires a finite byte limit.', 2);
  requireValue(!options.inputAfterStarted || options.input === undefined, 'INVALID_PROCESS_INPUT', 'Select ordinary input or a retained-process grant, never both.', 2);
  if (options.signal?.aborted) throw new Fault('CANCELLED', 'Operation cancelled before dispatch.', 130);
  const environment: NodeJS.ProcessEnv = { ...process.env, ...options.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_OPTIONAL_LOCKS: '0' };
  // A caller's Git repository/index overrides must never retarget the service.
  for (const key of Object.keys(environment)) if (/^GIT_(?:DIR$|COMMON_DIR$|WORK_TREE$|INDEX_FILE$|OBJECT_DIRECTORY$|ALTERNATE_OBJECT_DIRECTORIES$|NAMESPACE$|PREFIX$|CONFIG(?:$|_)|REPLACE_REF_BASE$)/.test(key)) delete environment[key];
  Object.assign(environment, options.env ?? {});
  const timeoutMs = options.timeoutMs ?? 30000;
  requireValue(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 86400000, 'INVALID_PROCESS_DEADLINE', 'Select a finite command deadline no longer than one day.', 2);
  const ownership = typeof options.ownership === 'function' ? options.ownership() : options.ownership;
  ownership?.intent(executable, argv);
  const granted = Boolean(ownership);
  return new Promise((resolveResult, reject) => {
    const child = spawn(granted ? process.execPath : executable, granted ? [fileURLToPath(new URL('./resource-process-worker.js', import.meta.url))] : [...argv],
      { cwd: options.cwd, env: environment, detached: true, stdio: granted ? ['pipe', 'pipe', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', bytes = 0, binaryBytes = 0, binaryOverflow = false, timedOut = false, cancelled = false, stopped = false, settled = false;
    let exitCode: number | null = null, exitSignal: string | null = null, exited = false, streamsClosed = false, identityUnknown = false;
    let callbackFailure: 'OUTPUT_SINK_FAILED' | 'PROCESS_OBSERVER_FAILED' | undefined;
    let drainTimer: NodeJS.Timeout | undefined, killTimer: NodeJS.Timeout | undefined, finalTimer: NodeJS.Timeout | undefined;
    const known = new Map<number, string>(), pending = { stdout: '', stderr: '' };
    const maxBytes = options.maxBytes ?? 4 * 1024 * 1024;
    const retain = (): ProcessMember[] | null => {
      const census = processCensus(); if (!census) { identityUnknown = true; return null; }
      let changed = false;
      // Membership is acquired only from exact ancestry while a retained parent
      // exists, or the still-owned detached group while the leader is live.
      for (let depth = 0; depth < 32; depth++) {
        let added = false;
        for (const row of census) if (!known.has(row.pid) && ((known.get(row.parent) && census.some(p => p.pid === row.parent && p.start === known.get(row.parent))) ||
          (!exited && row.group === child.pid && census.some(p => p.pid === child.pid && p.start === known.get(child.pid!))))) {
          known.set(row.pid, row.start); changed = added = true;
        }
        if (!added) break;
      }
      const group = census.filter(r => r.group === child.pid);
      if (group.some(r => known.get(r.pid) !== r.start)) identityUnknown = true;
      if (changed) { try { ownership?.members([...known].map(([pid, start]) => ({ pid, start }))); } catch { callbackFailure = 'PROCESS_OBSERVER_FAILED'; identityUnknown = true; } }
      return census.filter(r => known.get(r.pid) === r.start).map(r => ({ pid: r.pid, start: r.start }));
    };
    const signalOwned = (signal: 'SIGTERM' | 'SIGKILL'): void => {
      const members = retain();
      if (members) for (const member of members) if (processIdentity(member.pid) === member.start) {
        try { process.kill(member.pid, signal); } catch { /* exit is verified separately */ }
      }
      // Before grant an unreaped direct wrapper cannot be a reused PID. This
      // fallback closes only that wrapper, never an unobserved process group.
      if (!exited && child.pid && !known.has(child.pid)) try { child.kill(signal); } catch { /* already exited */ }
    };
    const cleanup = (): void => { clearTimeout(timer); clearInterval(poll); if (drainTimer) clearTimeout(drainTimer); if (killTimer) clearTimeout(killTimer); if (finalTimer) clearTimeout(finalTimer); options.signal?.removeEventListener('abort', cancel); };
    const finish = (released: boolean, reason: string | null): void => {
      if (settled) return; settled = true; cleanup();
      for (const text of Object.values(pending)) if (text && !callbackFailure) try { options.output?.(text); } catch { callbackFailure = 'OUTPUT_SINK_FAILED'; }
      const result: ProcessResult = { code: cancelled ? 130 : timedOut ? 124 : bytes > maxBytes || binaryOverflow || !released ? 5 : exitCode ?? 5,
        actualExitCode: exitCode, signal: exitSignal, stdout, stderr, timedOut, cancelled, outputLimited: binaryOverflow || bytes > maxBytes,
        cleanup: { released, reason, members: [...known].map(([pid, start]) => ({ pid, start })) } };
      try { ownership?.finished(result); } catch { callbackFailure = 'PROCESS_OBSERVER_FAILED'; }
      child.stdout?.destroy(); child.stderr?.destroy(); child.stdin?.destroy(); if (granted) (child.stdio[3] as Writable | null)?.destroy(); child.unref();
      if (callbackFailure) { try { ownership?.uncertain(callbackFailure); } catch { /* existing intent remains retained */ }
        reject(new Fault(callbackFailure, 'Retaining process output or execution ownership failed. Inspect the retained cleanup result.', 5, { actualExitCode: exitCode, cleanup: result.cleanup })); }
      else resolveResult(result);
    };
    const check = (): void => {
      if (settled) return; const members = retain();
      if (exited && streamsClosed && members && members.length === 0) finish(!identityUnknown, identityUnknown ? 'PROCESS_IDENTITY_UNCONFIRMED' : null);
      else if (exited && !stopped) stop();
    };
    const stop = (): void => {
      if (stopped || settled) return; stopped = true;
      try { ownership?.stopping(); } catch { callbackFailure = 'PROCESS_OBSERVER_FAILED'; }
      signalOwned('SIGTERM');
      killTimer = setTimeout(() => { signalOwned('SIGKILL'); check(); }, options.terminationGraceMs ?? 1500);
      finalTimer = setTimeout(() => finish(false, 'PROCESS_RELEASE_UNCONFIRMED'), (options.terminationGraceMs ?? 1500) + 2500);
    };
    const cancel = (): void => { cancelled = true; stop(); };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    const poll = setInterval(check, 200);
    options.signal?.addEventListener('abort', cancel, { once: true });
    const emit = (text: string): void => { if (callbackFailure) return; try { options.output?.(text); } catch { callbackFailure = 'OUTPUT_SINK_FAILED'; stop(); } };
    child.once('spawn', () => {
      try {
        if (child.pid) {
          const start = processIdentity(child.pid); if (start) known.set(child.pid, start);
          if (granted) {
            requireValue(start && !stopped && !options.signal?.aborted, 'PROCESS_IDENTITY_UNAVAILABLE', 'Retain the waiting process before execution.', 3);
            ownership!.allocated(child.pid, start);
          }
          options.started?.(child.pid, start);
          const input = options.inputAfterStarted ? (() => {
            requireValue(start && !stopped && !options.signal?.aborted, 'PROCESS_IDENTITY_UNAVAILABLE', 'The waiting process needs an exact identity.', 3);
            return options.inputAfterStarted(child.pid!, start);
          })() : options.input;
          if (granted) {
            requireValue(!stopped && !options.signal?.aborted, 'CANCELLED', 'Dispatch was cancelled.', 130); ownership!.grant();
            const env = Object.fromEntries(Object.entries(environment).filter((e): e is [string, string] => typeof e[1] === 'string'));
            const grant = JSON.stringify({ executable, argv, environment: env, deadline: Date.now() + timeoutMs });
            requireValue(Buffer.byteLength(grant) <= 1024 * 1024, 'PROCESS_GRANT_TOO_LARGE', 'Private execution grant exceeds its bound.', 2);
            (child.stdio[3] as Writable).end(grant);
          }
          child.stdin!.end(input);
        }
      } catch { callbackFailure = 'PROCESS_OBSERVER_FAILED'; child.stdin?.end(); (child.stdio[3] as Writable | null)?.end(); stop(); }
    });
    child.once('error', error => {
      if (settled) return; settled = true; cleanup();
      try { ownership?.uncertain('EXECUTABLE_UNAVAILABLE'); } catch { /* retained intent survives */ }
      reject(new Fault('EXECUTABLE_UNAVAILABLE', `Cannot start ${executable}: ${(error as NodeJS.ErrnoException).code ?? 'unknown error'}`, 3));
    });
    const collect = (channel: 'stdout' | 'stderr', data: Buffer): void => {
      if (settled || callbackFailure || binaryOverflow || bytes > maxBytes) return;
      if (channel === 'stdout' && options.stdoutSink) {
        binaryBytes += data.length; if (binaryBytes > options.stdoutSink.maxBytes) { binaryOverflow = true; stop(); return; }
        try { options.stdoutSink.write(data); } catch { callbackFailure = 'OUTPUT_SINK_FAILED'; stop(); } return;
      }
      bytes += data.length; if (bytes > maxBytes) { stop(); return; }
      const text = data.toString('utf8'); if (channel === 'stdout') stdout += text; else stderr += text;
      pending[channel] += text; const newline = pending[channel].lastIndexOf('\n');
      if (newline >= 0) { emit(pending[channel].slice(0, newline + 1)); pending[channel] = pending[channel].slice(newline + 1); }
      if (pending[channel].length > 65536) pending[channel] = '[oversized log line omitted]\n';
    };
    child.stdout!.on('data', (data: Buffer) => collect('stdout', data)); child.stderr!.on('data', (data: Buffer) => collect('stderr', data));
    child.stdin!.on('error', () => { /* child can finish without consuming stdin */ });
    if (granted) (child.stdio[3] as Writable).on('error', () => { if (!exited && !settled) { callbackFailure = 'PROCESS_OBSERVER_FAILED'; stop(); } });
    child.once('exit', (code, signal) => { exitCode = code; exitSignal = signal; exited = true; drainTimer = setTimeout(check, 10); });
    child.once('close', (code, signal) => { exitCode = code; exitSignal = signal; exited = true; streamsClosed = true; check(); });
  });
}
interface CensusMember extends ProcessMember { parent: number; group: number }
export function processCensus(): CensusMember[] | null {
  try {
    const output = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,stat=,lstart='], { encoding: 'utf8', timeout: 2000, maxBuffer: 4 * 1024 * 1024 });
    const rows: CensusMember[] = [];
    for (const line of output.split('\n').filter(x => x.trim())) {
      const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/.exec(line); if (!match) return null;
      if (!match[4]!.startsWith('Z')) rows.push({ pid: Number(match[1]), parent: Number(match[2]), group: Number(match[3]), start: match[5]!.trim() });
    }
    return rows;
  } catch { return null; }
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
