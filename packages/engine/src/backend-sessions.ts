import { randomBytes } from 'node:crypto';
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, realpathSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrivateBackendControl } from './backend-control.js';
import { readStableFile, stableFileDigest } from './bounded-file.js';
import { digest, id, now, requireValue } from './core.js';
import type { Journal } from './journal.js';
import { alive, processIdentity, run } from './process.js';

export interface BackendSession {
  sessionId: string; hostId: string; deviceId: string; udid: string; createdAt: string;
  state: 'preparing' | 'prepared' | 'starting' | 'running' | 'exited' | 'unconfirmed';
  directory: string; directoryIdentity: string | null; keyDigest: string | null;
  executable: { path: string; sha256: string; revision: string };
  process: { pid: number; start: string } | null; dispatchGranted: boolean;
  durationSeconds: number; deadlineAt: string | null; materialDigest: string | null; completedAt: string | null;
  localProcess: 'not_started' | 'running' | 'exited' | 'unknown';
  phoneSession: 'not_started' | 'unknown';
  controlIdentity: string | null;
  exit: { code: number; actualExitCode: number | null; signal: string | null; timedOut: boolean; cancelled: boolean; outputLimited: boolean } | null;
  control: { observedAt: string; authenticated: true; ready: boolean; tunnelPresent: boolean; scope: 'selected_private_backend_only' } | null;
}
const code = 'BACKEND_SESSION_CHANGED';
function privateDirectoryIdentity(path: string): string {
  const stat = lstatSync(path, { bigint: true });
  requireValue(realpathSync(path) === path && stat.isDirectory() && stat.uid === BigInt(process.getuid?.() ?? -1) && (stat.mode & 0o777n) === 0o700n,
    code, 'Backend state must remain an exact owned private directory.', 3);
  return [stat.dev, stat.ino, stat.uid, stat.mode].map(String).join(':');
}
/** Internal lifecycle boundary for the pinned private backend. Preparation is
 * not trust bootstrap. Every actual start still requires the device dispatcher's
 * current authorization/ownership checks; this module is not a public command. */
export class BackendSessions {
  private readonly active = new Map<string, AbortController>();
  private readonly controls = new Map<string, PrivateBackendControl>();
  constructor(readonly store: Journal, readonly executable: BackendSession['executable']) {}
  static recover(store: Journal): void {
    for (const session of store.records<BackendSession>('backendSession')) {
      if (!['prepared', 'exited'].includes(session.state)) new BackendSessions(store, session.executable).reconcile(session.sessionId);
    }
  }
  static status(store: Journal): { total: number; limited: boolean; sessions: unknown[] } {
    const records = store.records<BackendSession>('backendSession').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { total: records.length, limited: records.length > 100, sessions: records.slice(0, 100).map(session => ({
      sessionId: session.sessionId, deviceId: session.deviceId, state: session.state, localProcess: session.localProcess,
      phoneSession: session.phoneSession, dispatchGranted: session.dispatchGranted, deadlineAt: session.deadlineAt,
      completedAt: session.completedAt, exit: session.exit, control: session.control
    })) };
  }
  private save(session: BackendSession): BackendSession { this.store.put('backendSession', session.sessionId, session); return session; }
  get(sessionId: string): BackendSession {
    const value = this.store.record<BackendSession>('backendSession', sessionId);
    requireValue(value?.hostId === this.store.hostId, 'BACKEND_SESSION_UNKNOWN', 'Select a retained session on this host.', 3); return value;
  }
  prepare(deviceId: string, udid: string, durationSeconds: number): BackendSession {
    requireValue(/^device-[a-f0-9]{32}$/.test(deviceId) && /^[A-Za-z0-9-]{8,128}$/.test(udid), 'DEVICE_IDENTITY_REQUIRED', 'Select an exact retained device identity.', 2);
    requireValue(Number.isSafeInteger(durationSeconds) && durationSeconds > 0 && durationSeconds <= 86400, 'SESSION_BOUNDS_REQUIRED', 'Select a session deadline no longer than one day.', 2);
    this.store.assertAdmissionStorage();
    requireValue(!this.store.records<BackendSession>('backendSession').some(value => (value.deviceId === deviceId || value.udid === udid) && (value.state !== 'exited' || value.phoneSession !== 'not_started')),
      'BACKEND_SESSION_UNRECONCILED', 'A prior session still needs reconciliation. An expired deadline or absent process never proves the phone session was released.', 3);
    const parent = join(realpathSync(this.store.directory), 'backend-sessions');
    try { mkdirSync(parent, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    privateDirectoryIdentity(parent);
    const sessionId = id(), directory = join(parent, sessionId);
    const session: BackendSession = { sessionId, hostId: this.store.hostId, deviceId, udid, createdAt: now(), state: 'preparing', directory, directoryIdentity: null, keyDigest: null,
      executable: { ...this.executable }, process: null, dispatchGranted: false, durationSeconds, deadlineAt: null, materialDigest: null, completedAt: null,
      localProcess: 'not_started', phoneSession: 'not_started', controlIdentity: null, exit: null, control: null };
    this.save(session); // Durable intent precedes private material creation.
    mkdirSync(directory, { mode: 0o700 }); mkdirSync(join(directory, 'pairings'), { mode: 0o700 });
    const key = randomBytes(32), fd = openSync(join(directory, 'session.key'), 'wx', 0o600);
    try { writeSync(fd, key); fsyncSync(fd); } finally { closeSync(fd); }
    session.directoryIdentity = privateDirectoryIdentity(directory); session.keyDigest = digest(key); session.state = 'prepared'; return this.save(session);
  }
  private material(session: BackendSession): string {
    requireValue(session.directory === join(realpathSync(this.store.directory), 'backend-sessions', session.sessionId) && privateDirectoryIdentity(session.directory) === session.directoryIdentity,
      code, 'The retained backend directory changed.', 3);
    const keyPath = join(session.directory, 'session.key'), keyInfo = lstatSync(keyPath);
    requireValue((keyInfo.mode & 0o777) === 0o600 && digest(readStableFile(keyPath, 32, code)) === session.keyDigest, code, 'The private backend key changed.', 3);
    const pairings = join(session.directory, 'pairings'), identity = privateDirectoryIdentity(pairings), names = readdirSync(pairings).sort();
    requireValue(names.length > 0 && names.length <= 100, 'BACKEND_TRUST_REQUIRED', 'Independently approved private pairing material is required. Apple trust is never copied or recreated here.', 3);
    let size = 0;
    const files = names.map(name => {
      const path = join(pairings, name), info = lstatSync(path);
      requireValue((info.mode & 0o777) === 0o600, code, 'Pairing files must remain private.', 3);
      const bytes = readStableFile(path, 1024 ** 2, code); size += bytes.length;
      requireValue(size <= 4 * 1024 ** 2, code, 'Private pairing material exceeds its finite bound.', 3);
      return { name, digest: digest(bytes) };
    });
    requireValue(privateDirectoryIdentity(pairings) === identity && names.join('\0') === readdirSync(pairings).sort().join('\0'), code, 'Pairing state changed during inspection.', 3);
    return digest({ identity, files, key: session.keyDigest, directory: session.directoryIdentity });
  }
  private verifyExecutable(session: BackendSession): void {
    const info = lstatSync(session.executable.path);
    requireValue(digest(session.executable) === digest(this.executable) && !info.isSymbolicLink() && (info.mode & 0o222) === 0 && (info.mode & 0o111) !== 0 &&
      stableFileDigest(session.executable.path, 256 * 1024 ** 2, 'BACKEND_EXECUTABLE_CHANGED').sha256 === session.executable.sha256,
      'BACKEND_EXECUTABLE_CHANGED', 'The selected immutable backend no longer matches the approved payload.', 3);
  }
  async start(sessionId: string, assertAuthorized: () => void, signal?: AbortSignal): Promise<BackendSession> {
    const session = this.get(sessionId);
    requireValue(session.state === 'prepared' && !this.active.has(sessionId), 'BACKEND_SESSION_UNRECONCILED', 'Reconcile the retained session instead of starting it again.', 3);
    requireValue(!signal?.aborted && !this.store.getMeta('paused') && !this.store.getMeta('maintenance'), 'SESSION_START_UNAVAILABLE', 'Session startup is cancelled, paused or draining.', 3);
    assertAuthorized(); this.verifyExecutable(session); session.materialDigest = this.material(session);
    const controller = new AbortController(), cancel = (): void => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true }); this.active.set(sessionId, controller);
    session.state = 'starting'; session.deadlineAt = new Date(Date.now() + session.durationSeconds * 1000).toISOString(); this.save(session);
    try {
      const environment: Record<string, string> = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: session.directory, TMPDIR: session.directory, CONTRIBUTION_BACKEND_STATE: session.directory };
      const cleared: NodeJS.ProcessEnv = {};
      for (const key of Object.keys(process.env)) cleared[key] = undefined;
      const result = await run(process.execPath, [fileURLToPath(new URL('./backend-session-worker.js', import.meta.url))], {
        cwd: session.directory, env: { ...cleared, ...environment }, signal: controller.signal,
        timeoutMs: session.durationSeconds * 1000, maxBytes: 64 * 1024, terminationGraceMs: 5000,
        inputAfterStarted: (pid, start) => {
          // The waiting wrapper has made no backend call. Persist its identity
          // before granting exec; a crash on either side remains conservative.
          requireValue(digest(this.get(sessionId)) === digest(session), code, 'The retained session changed before its process could be granted.', 3);
          session.process = { pid, start }; session.localProcess = 'running'; this.save(session);
          assertAuthorized(); this.verifyExecutable(session);
          requireValue(!controller.signal.aborted && !this.store.getMeta('paused') && !this.store.getMeta('maintenance') && this.material(session) === session.materialDigest &&
            digest(this.get(sessionId)) === digest(session) && Date.now() < Date.parse(session.deadlineAt!),
            code, 'Session scope, authority, maintenance or private material changed before dispatch.', 3);
          session.dispatchGranted = true; session.phoneSession = 'unknown'; session.state = 'running'; this.save(session);
          return JSON.stringify({ executable: session.executable.path, sha256: session.executable.sha256, deadline: Date.parse(session.deadlineAt!),
            argv: ['tunnel', 'start', '--userspace', '--udid', session.udid, '--pair-record-path', join(session.directory, 'pairings')], environment });
        }
      });
      session.exit = { code: result.code, actualExitCode: result.actualExitCode ?? null, signal: result.signal, timedOut: result.timedOut, cancelled: result.cancelled, outputLimited: result.outputLimited ?? false };
      session.control = this.get(sessionId).control; session.controlIdentity = this.get(sessionId).controlIdentity;
      session.localProcess = 'exited'; session.state = 'exited'; session.completedAt = now(); return this.save(session);
    } catch (error) {
      this.reconcile(sessionId); throw error;
    } finally { signal?.removeEventListener('abort', cancel); this.active.delete(sessionId); this.controls.delete(sessionId); }
  }
  reconcile(sessionId: string): BackendSession {
    const session = this.get(sessionId);
    if (session.state === 'prepared' || session.state === 'exited') return session;
    const identity = session.process;
    if (identity && !alive(identity.pid)) session.localProcess = 'exited';
    else if (identity && processIdentity(identity.pid) === identity.start) session.localProcess = 'running';
    else session.localProcess = 'unknown';
    // A reused PID, missing observation or dead local worker is not release
    // evidence for the phone. Recovery never reconnects, kills or unlinks.
    session.state = !session.dispatchGranted && session.localProcess === 'exited' ? 'exited' : 'unconfirmed';
    if (session.state === 'exited') session.completedAt = now();
    return this.save(session);
  }
  cancel(sessionId: string): BackendSession {
    const session = this.get(sessionId), controller = this.active.get(sessionId);
    if (controller) { controller.abort(); return session; }
    return this.reconcile(sessionId);
  }
  async observe(sessionId: string, signal?: AbortSignal): Promise<BackendSession> {
    const session = this.get(sessionId);
    requireValue(session.dispatchGranted && session.process && alive(session.process.pid) && processIdentity(session.process.pid) === session.process.start,
      'BACKEND_PROCESS_UNCONFIRMED', 'The retained backend process is absent or unconfirmed.', 3);
    requireValue(this.material(session) === session.materialDigest, code, 'Private session material changed.', 3);
    let client = this.controls.get(sessionId);
    if (!client) {
      client = new PrivateBackendControl(session.directory, session.udid, session.controlIdentity ?? undefined); this.controls.set(sessionId, client);
      if (!session.controlIdentity) { session.controlIdentity = client.identity; this.save(session); }
    }
    const result = await client.observe(signal), latest = this.get(sessionId);
    requireValue(digest(latest) === digest(session) && processIdentity(session.process.pid) === session.process.start && this.material(session) === session.materialDigest,
      code, 'The retained session changed while it was observed.', 3);
    session.control = { observedAt: now(), authenticated: true, ready: result.ready, tunnelPresent: result.tunnel !== null, scope: result.scope };
    return this.save(session);
  }
}
