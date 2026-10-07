import { assertContract } from '@contribution/contracts';
import type { Connectivity } from '@contribution/contracts';
import type { Journal } from './journal.js';
import { digest, Fault, requireValue } from './core.js';
import { ownedProcess, processLifecycle } from './resource-process.js';
import type { ProcessOwnership } from './process.js';
import type { ProcessResult, RunOptions } from './process.js';
import { run, alive } from './process.js';
import { isIP } from 'node:net';

const policies = new WeakMap<Journal, PeerConnectivity>();
const gitObserved = new WeakMap<Journal, Map<string, number>>();
export interface ConnectivityClock { wall(): number; mono(): number; random(): number }
export const systemClock: ConnectivityClock = { wall: Date.now, mono: () => performance.now(), random: Math.random };
export const connectivityPolicy = { connectSeconds: 8, healthMs: 10000, rpcMs: 45000, healthBytes: 65536, rpcBytes: 2 * 1024 * 1024, ttlMs: 30000, maxBackoffMs: 300000, concurrency: 4 } as const;
export function retryDelay(failures: number, random: number): number { return Math.min(300000, Math.min(300000, 2000 * 2 ** Math.min(20, Math.max(0, failures - 1))) * (0.8 + Math.max(0, Math.min(1, random)) * 0.4)); }
export function sshDestination(value: string): void {
  requireValue(value.length <= 253 && (isIP(value) !== 0 || /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)), 'INVALID_SSH_ALIAS', 'Use one configured SSH alias, hostname, IPv4 or IPv6 address. User and port belong in SSH configuration.', 2);
}
export function sshArguments(destination: string): string[] {
  sshDestination(destination);
  return ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=8', '-o', 'ConnectionAttempts=1', '-o', 'ServerAliveInterval=10', '-o', 'ServerAliveCountMax=2', '--', destination, '"$HOME/.local/bin/contribution" peer --stdio'];
}
export const connectionReasons = ['NONE', 'PEER_UNAVAILABLE', 'SSH_TIMEOUT', 'SSH_REFUSED', 'SSH_ROUTE_UNAVAILABLE', 'SSH_RESOLUTION_FAILED', 'SSH_AUTH_DENIED', 'SSH_HOST_KEY_CHANGED', 'SSH_HOST_UNAPPROVED', 'SSH_CONFIG_INVALID', 'INVALID_SSH_ALIAS', 'EXECUTABLE_UNAVAILABLE', 'SSH_PERMISSION_DENIED', 'PEER_HELPER_UNAVAILABLE', 'PEER_PROTOCOL_ERROR', 'PEER_IDENTITY_CHANGED', 'PEER_VERSION_MISMATCH', 'PROBE_CANCELLED', 'PROBE_OUTPUT_LIMIT', 'PROCESS_RELEASE_UNCONFIRMED', 'PEER_RETRY_WAIT', 'PEER_ACTION_UNSUPPORTED'] as const;
export function transportFailure(result: ProcessResult): Fault {
  const text = result.stderr;
  let code = 'PEER_UNAVAILABLE', stage: Connectivity['stage'] = 'connection', retryable = true;
  if (result.cleanup?.released === false) { code = 'PROCESS_RELEASE_UNCONFIRMED'; retryable = false; }
  else if (result.cancelled) { code = 'PROBE_CANCELLED'; retryable = false; }
  else if (result.timedOut) code = 'SSH_TIMEOUT';
  else if (result.outputLimited) { code = 'PROBE_OUTPUT_LIMIT'; retryable = false; stage = 'protocol'; }
  else if (result.cleanup && !result.cleanup.released) { code = 'PROCESS_RELEASE_UNCONFIRMED'; retryable = false; }
  else if (/REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(text)) { code = 'SSH_HOST_KEY_CHANGED'; stage = 'trust'; retryable = false; }
  else if (/Host key verification failed|No .*host key is known/i.test(text)) { code = 'SSH_HOST_UNAPPROVED'; stage = 'trust'; retryable = false; }
  else if (/Permission denied \((?:publickey|password|keyboard-interactive)/i.test(text)) { code = 'SSH_AUTH_DENIED'; stage = 'authentication'; retryable = false; }
  else if (/Bad configuration option|Bad port|Bad owner or permissions on .*config/i.test(text)) { code = 'SSH_CONFIG_INVALID'; stage = 'configuration'; retryable = false; }
  else if (/Could not resolve hostname/i.test(text)) { code = 'SSH_RESOLUTION_FAILED'; stage = 'resolution'; }
  else if (/Connection refused/i.test(text)) code = 'SSH_REFUSED';
  else if (/No route to host|Network is unreachable/i.test(text)) code = 'SSH_ROUTE_UNAVAILABLE';
  else if (/Connection timed out|Operation timed out/i.test(text)) code = 'SSH_TIMEOUT';
  else if (result.code === 126) { code = 'SSH_PERMISSION_DENIED'; stage = 'configuration'; retryable = false; }
  else if (result.code === 127 || /contribution.*(?:not found|No such file)/i.test(text)) { code = 'PEER_HELPER_UNAVAILABLE'; stage = 'helper'; retryable = false; }
  return new Fault(code, connectionMessage(code), 3, { stage, source: 'ssh', confidence: code === 'PEER_UNAVAILABLE' ? 'unknown' : 'observed', ...(code === 'PROCESS_RELEASE_UNCONFIRMED' ? { cleanup: result.cleanup ?? null, initiatingReason: result.cancelled ? 'PROBE_CANCELLED' : result.timedOut ? 'SSH_TIMEOUT' : result.outputLimited ? 'PROBE_OUTPUT_LIMIT' : null } : {}) }, retryable);
}
export function connectionMessage(code: string): string {
  const messages: Record<string, string> = {
    SSH_HOST_KEY_CHANGED: 'The remote host key changed. Verify this Mac before continuing.', SSH_HOST_UNAPPROVED: 'The SSH host is not approved. Verify its identity in connection settings.',
    SSH_AUTH_DENIED: 'SSH authentication was denied in the background worker context. Review the configured credentials and authentication agent.',
    PEER_HELPER_UNAVAILABLE: 'SSH reached the remote host, but the Contribution helper is unavailable.', SSH_TIMEOUT: 'The SSH connection timed out. A VPN, firewall, or unavailable remote Mac could explain this.',
    SSH_REFUSED: 'The configured SSH connection was refused.', SSH_RESOLUTION_FAILED: 'OpenSSH could not resolve its configured destination.', SSH_ROUTE_UNAVAILABLE: 'OpenSSH reported an unavailable network route.',
    PEER_IDENTITY_CHANGED: 'The destination identifies a different Contribution host. Verify the configured Mac.', PEER_VERSION_MISMATCH: 'The peer protocol or version is incompatible. Update the selected hosts.',
    PEER_PROTOCOL_ERROR: 'The remote helper returned an incompatible response.', PROBE_CANCELLED: 'The connection observation was cancelled.', PROBE_OUTPUT_LIMIT: 'The connection response exceeded its output bound.',
    PROCESS_RELEASE_UNCONFIRMED: 'The local connection process release is unconfirmed. Inspect its retained ownership before another attempt.', PEER_RETRY_WAIT: 'The configured peer is waiting for its shared retry time.',
    INVALID_SSH_ALIAS: 'The configured SSH destination is invalid.', EXECUTABLE_UNAVAILABLE: 'An executable is unavailable in the background worker context.', SSH_CONFIG_INVALID: 'OpenSSH rejected its configured options or permissions.', SSH_PERMISSION_DENIED: 'The configured executable cannot run in this worker context.'
  };
  return messages[code] ?? 'The configured connection is unavailable. Its cause is unknown; accepted work remains retained.';
}
export function failureFacts(error: unknown): { code: string; stage: Connectivity['stage']; retryable: boolean } | null {
  if (error instanceof Fault && error.code === 'PEER_ACTION_UNSUPPORTED') return null;
  if (error instanceof Fault && !connectionReasons.includes(error.code as typeof connectionReasons[number]) && !['SERVICE_UNAVAILABLE', 'SERVICE_TIMEOUT', 'SERVICE_NOT_INSTALLED', 'SERVICE_PROTOCOL_ERROR'].includes(error.code)) return null;
  const code = error instanceof Fault ? error.code : 'PEER_UNAVAILABLE';
  const stage = error instanceof Fault && ['configuration', 'resolution', 'connection', 'trust', 'authentication', 'helper', 'protocol', 'identity', 'operation', 'none'].includes(String(error.details['stage'])) ? error.details['stage'] as Connectivity['stage'] :
    code === 'PEER_IDENTITY_CHANGED' ? 'identity' : code === 'PEER_VERSION_MISMATCH' || code === 'PEER_PROTOCOL_ERROR' ? 'protocol' : code.startsWith('SERVICE_') ? 'helper' : code === 'INVALID_SSH_ALIAS' || code === 'EXECUTABLE_UNAVAILABLE' ? 'configuration' : 'connection';
  return { code, stage, retryable: error instanceof Fault ? error.retryable || ['PEER_UNAVAILABLE', 'SERVICE_UNAVAILABLE', 'SERVICE_TIMEOUT'].includes(code) : true };
}

/** Policy owned by Peers/Engine. Uses the existing journal and service tick. */
export class PeerConnectivity {
  private retryTimes = new Map<string, { wall: number; mono: number }>();
  connectionDelay(host: string, error: unknown, businessDelay: number): number {
    if (!failureFacts(error) && !(error instanceof Fault && error.code === 'PEER_RETRY_WAIT')) return businessDelay;
    const value = this.store.record<Connectivity>('connectivity', host);
    if (!value?.retryable || !value.nextRetryAt) return businessDelay;
    return this.due.has(host) ? Math.max(0, this.due.get(host)! - this.clock.mono()) : Math.max(0, Math.min(connectivityPolicy.maxBackoffMs, Date.parse(value.nextRetryAt) - this.clock.wall()));
  }
  nextAttempt(key: string, delay: number): number { const bounded = Math.max(0, Math.min(connectivityPolicy.maxBackoffMs, delay)), wall = this.clock.wall() + bounded; this.retryTimes.set(key, { wall, mono: this.clock.mono() + bounded }); return wall; }
  attemptDue(key: string, wall: number): boolean {
    let retained = this.retryTimes.get(key);
    if (!retained || retained.wall !== wall) { retained = { wall, mono: this.clock.mono() + Math.max(0, Math.min(connectivityPolicy.maxBackoffMs, wall - this.clock.wall())) }; this.retryTimes.set(key, retained); }
    return this.clock.mono() >= retained.mono;
  }
  private chains = new Map<string, Promise<unknown>>();
  private running = 0;
  private slots: (() => void)[] = [];
  private generation = new Map<string, number>();
  private expedited = new Map<string, number>();
  private due = new Map<string, number>();
  private providerObserved = new Map<string, number>();
  private observed = new Map<string, number>();
  private controllers = new Map<string, AbortController>();
  private owned = new Set<string>();
  processOwnership(host: string, diagnostic = false): ProcessOwnership {
    const scope = `connectivity:${diagnostic ? 'diagnostic' : 'peer'}:${host}`, owner = ownedProcess(processLifecycle(this.store), null, [], 'process', scope);
    return { ...owner, intent: (...args) => { owner.intent(...args); this.owned.add(scope); }, finished: result => { try { owner.finished(result); } finally { this.owned.delete(scope); } }, uncertain: reason => { try { owner.uncertain(reason); } finally { this.owned.delete(scope); } } };
  }
  private retainedProcesses(host: string) { return this.store.records<import('@contribution/contracts').Resource>('resource').filter(r => r.scopeType === 'host' && r.scope === `connectivity:peer:${host}` && r.state !== 'stopped'); }
  constructor(readonly store: Journal, readonly clock: ConnectivityClock = systemClock) { policies.set(store, this); }
  snapshot(hostId: string, alias: string): Connectivity {
    const revision = digest(alias), saved = this.store.record<Connectivity>('connectivity', hostId);
    const base: Connectivity = saved?.endpointRevision === revision ? { ...saved } : { schemaVersion: 1, targetKind: 'contribution-peer', targetId: hostId, endpointRevision: revision,
      generation: 0, state: 'unknown', freshness: 'unknown', observedAt: null, lastSuccessAt: null, reasonCode: 'NONE', stage: 'none', retryable: false, confidence: 'unknown', source: 'service', helper: 'unknown', failures: 0, nextRetryAt: null, actions: ['retry', 'diagnostics'], capabilities: [], provider: { status: 'not_applicable', client: 'unknown', target: 'unknown', path: 'unknown' } };
    if (!this.generation.has(hostId) || !this.observed.has(hostId) || this.clock.mono() - (this.observed.get(hostId) ?? 0) > connectivityPolicy.ttlMs) base.freshness = base.observedAt ? 'stale' : 'unknown';
    base.provider = { ...base.provider, observedAt: base.provider.observedAt ?? null, freshness: base.provider.observedAt ? this.providerObserved.has(hostId) && this.clock.mono() - this.providerObserved.get(hostId)! <= connectivityPolicy.ttlMs ? 'fresh' : 'stale' : 'unknown' };
    if (this.controllers.has(hostId)) base.state = 'checking';
    if (this.retainedProcesses(hostId).length && !this.controllers.has(hostId) || this.store.record<{ absenceConfirmed: boolean }>('peerProcessRelease', hostId)?.absenceConfirmed === false) { base.state = 'requires_action'; base.reasonCode = 'PROCESS_RELEASE_UNCONFIRMED'; base.stage = 'connection'; base.retryable = false; base.nextRetryAt = null; base.actions = ['reconcile', 'diagnostics']; }
    assertContract('connectivity', base); return base;
  }
  private save(value: Connectivity): void { assertContract('connectivity', value); this.store.enableConnectivity(); this.store.put('connectivity', value.targetId, value); }
  provider(host: string, alias: string, provider: Connectivity['provider'], revision: string, generation: number): void {
    const current = this.snapshot(host, alias);
    if (current.endpointRevision !== revision || current.generation !== generation) return;
    const saved = this.store.record<Connectivity>('connectivity', host);
    this.providerObserved.set(host, this.clock.mono());
    provider = { ...provider, observedAt: new Date(this.clock.wall()).toISOString(), freshness: 'fresh' };
    this.save({ ...current, state: current.state === 'checking' ? saved?.state ?? 'unknown' : current.state, provider });
  }
  eligible(host: string, alias: string): void {
    const value = this.snapshot(host, alias);
    requireValue(value.state !== 'requires_action', value.reasonCode, connectionMessage(value.reasonCode), 3);
    const wallRemaining = value.nextRetryAt ? Math.max(0, Math.min(connectivityPolicy.maxBackoffMs, Date.parse(value.nextRetryAt) - this.clock.wall())) : 0;
    if (!this.due.has(host)) this.due.set(host, this.clock.mono() + wallRemaining);
    if ((this.due.get(host) ?? 0) > this.clock.mono()) throw new Fault('PEER_RETRY_WAIT', connectionMessage('PEER_RETRY_WAIT'), 3, {}, true);
  }
  invalidate(host: string, alias: string, explicit = false): boolean {
    const last = this.expedited.get(host) ?? -Infinity;
    if (this.clock.mono() - last < 2000) return false;
    const value = this.snapshot(host, alias);
    if (value.reasonCode === 'PROCESS_RELEASE_UNCONFIRMED' && this.store.record<{ absenceConfirmed: boolean }>('peerProcessRelease', host)?.absenceConfirmed !== true || value.state === 'requires_action' && !explicit) return false;
    this.expedited.set(host, this.clock.mono());
    this.controllers.get(host)?.abort();
    const generation = (this.generation.get(host) ?? value.generation) + 1; this.generation.set(host, generation); this.due.set(host, 0);
    this.save({ ...value, generation, state: 'unknown', freshness: value.observedAt ? 'stale' : 'unknown', reasonCode: 'NONE', stage: 'none', retryable: false, nextRetryAt: null }); return true;
  }
  changeEndpoint(host: string, alias: string): void {
    const value = this.snapshot(host, alias);
    this.controllers.get(host)?.abort();
    const generation = (this.generation.get(host) ?? value.generation) + 1; this.generation.set(host, generation); this.due.set(host, 0);
    this.save({ ...value, generation, state: 'unknown', freshness: 'unknown', observedAt: null, lastSuccessAt: null, reasonCode: 'NONE', stage: 'none', failures: 0, nextRetryAt: null, capabilities: [], provider: { status: 'not_applicable', client: 'unknown', target: 'unknown', path: 'unknown' } });
  }
  async reconcile(host: string, alias: string): Promise<{ reconciled: boolean; reason: string }> {
    if (this.controllers.has(host) || this.owned.has(`connectivity:peer:${host}`) || this.owned.has(`connectivity:diagnostic:${host}`)) return { reconciled: false, reason: 'PROCESS_OBSERVATION_ACTIVE' };
    await processLifecycle(this.store).reconcile(5000, r => r.scopeType === 'host' && [`connectivity:peer:${host}`, `connectivity:diagnostic:${host}`].includes(r.scope));
    if (this.retainedProcesses(host).length) return { reconciled: false, reason: 'OWNERSHIP_OBSERVATION_REQUIRED' };
    const retained = this.store.record<{ members: { pid: number; start: string }[]; complete: boolean; absenceConfirmed: boolean }>('peerProcessRelease', host);
    if (!retained || retained.absenceConfirmed) return { reconciled: true, reason: 'NO_UNRESOLVED_PROCESS' };
    if (retained.complete !== true || !Array.isArray(retained.members) || !retained.members.length || retained.members.length > 64 || !retained.members.every(member => Number.isSafeInteger(member.pid) && member.pid > 0 && typeof member.start === 'string' && member.start.length <= 128)) return { reconciled: false, reason: 'OWNERSHIP_OBSERVATION_REQUIRED' };
    const observation = await run('/bin/ps', ['-p', retained.members.map(member => member.pid).join(','), '-o', 'pid=,lstart='], { timeoutMs: 3000, maxBytes: 16384 });
    if (![0, 1].includes(observation.code) || observation.timedOut || observation.cancelled || observation.outputLimited || observation.cleanup?.released === false) return { reconciled: false, reason: 'OWNERSHIP_OBSERVATION_UNAVAILABLE' };
    const current = new Map(observation.stdout.split('\n').flatMap(line => { const match = line.match(/^\s*(\d+)\s+(.+?)\s*$/); return match ? [[Number(match[1]), match[2]!] as const] : []; }));
    if (retained.members.some(member => current.get(member.pid) === member.start || !current.has(member.pid) && alive(member.pid))) return { reconciled: false, reason: 'OWNED_PROCESS_STILL_PRESENT' };
    this.store.put('peerProcessRelease', host, { ...retained, absenceConfirmed: true, reconciledAt: new Date(this.clock.wall()).toISOString() });
    this.invalidate(host, alias, true);
    return { reconciled: true, reason: 'OWNED_PROCESS_ABSENCE_CONFIRMED' };
  }
  cancel(): void { for (const controller of this.controllers.values()) controller.abort(); }
  private async acquire(): Promise<void> {
    if (this.running < connectivityPolicy.concurrency) { this.running++; return; }
    await new Promise<void>(resolve => this.slots.push(resolve));
  }
  private release(): void {
    const next = this.slots.shift(); if (next) next(); else this.running--;
  }
  async execute<T>(host: string, alias: string, action: string, fn: (signal: AbortSignal) => Promise<T>, capabilities?: (result: T) => string[]): Promise<T> {
    const previous = this.chains.get(host) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      const prior = this.store.record<Connectivity>('connectivity', host);
      requireValue(!prior || prior.endpointRevision === digest(alias), 'PROBE_CANCELLED', 'The configured endpoint changed before this observation dispatched.', 3);
      const expectedGeneration = this.generation.get(host) ?? prior?.generation ?? 0;
      this.eligible(host, alias);
      await this.acquire();
      try {
      requireValue((this.generation.get(host) ?? this.snapshot(host, alias).generation) === expectedGeneration, 'PROBE_CANCELLED', 'The observation changed while waiting for capacity.', 3);
      this.eligible(host, alias);
      if (action === 'health' && (this.store.getMeta('paused') || this.store.getMeta('maintenance'))) throw new Fault('PROBE_CANCELLED', connectionMessage('PROBE_CANCELLED'), 3);
      this.store.enableConnectivity();
      const controller = new AbortController(); this.controllers.set(host, controller);
      const generation = this.generation.get(host) ?? this.snapshot(host, alias).generation; this.generation.set(host, generation);
      const timer = setTimeout(() => controller.abort(), action === 'health' ? connectivityPolicy.healthMs : connectivityPolicy.rpcMs);
      try {
        // Deadline races even an injected or uncooperative boundary; its late
        // result cannot update evidence. The real runner also owns cleanup.
        const aborted = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Fault('SSH_TIMEOUT', connectionMessage('SSH_TIMEOUT'), 3, {}, true)), { once: true }));
        const invocation = fn(controller.signal);
        let result: T;
        try { result = await Promise.race([invocation, aborted]); } catch (error) {
          if (controller.signal.aborted) {
            let releaseTimer: ReturnType<typeof setTimeout> | undefined;
            try { await Promise.race([invocation.then(() => {}, releaseError => { if (releaseError instanceof Fault && releaseError.code === 'PROCESS_RELEASE_UNCONFIRMED') throw releaseError; }), new Promise<never>((_, reject) => { releaseTimer = setTimeout(() => reject(new Fault('PROCESS_RELEASE_UNCONFIRMED', connectionMessage('PROCESS_RELEASE_UNCONFIRMED'), 3)), 4500); })]); } finally { if (releaseTimer) clearTimeout(releaseTimer); }
          }
          throw error;
        }
        if (this.generation.get(host) === generation) {
          const stamp = new Date(this.clock.wall()).toISOString(), value = this.snapshot(host, alias);
          this.due.set(host, 0); this.observed.set(host, this.clock.mono());
          this.save({ ...value, generation, state: 'ready', freshness: 'fresh', observedAt: stamp, lastSuccessAt: stamp, reasonCode: 'NONE', stage: 'none', retryable: false, confidence: 'observed', source: 'helper', helper: 'available', failures: 0, nextRetryAt: null, actions: ['diagnostics'], capabilities: (capabilities?.(result) ?? value.capabilities) as Connectivity['capabilities'] });
        }
        return result;
      } catch (error) {
        if (action === 'health' && error instanceof Fault && error.code === 'PEER_ACTION_UNSUPPORTED' && this.generation.get(host) === generation) {
          const value = this.snapshot(host, alias);
          this.save({ ...value, state: 'unknown', freshness: 'stale', observedAt: new Date(this.clock.wall()).toISOString(), reasonCode: 'PEER_ACTION_UNSUPPORTED', stage: 'protocol', retryable: false, confidence: 'observed', source: 'helper', helper: 'incompatible', nextRetryAt: null, actions: ['update_peer', 'diagnostics'] });
        }
        if (error instanceof Fault && error.code === 'PROCESS_RELEASE_UNCONFIRMED') {
          const cleanup = error.details['cleanup'] as { members?: unknown } | undefined;
          const members = Array.isArray(cleanup?.members) ? cleanup.members.filter((value): value is { pid: number; start: string } => Boolean(value && typeof value === 'object' && Number.isSafeInteger(value.pid) && value.pid > 0 && typeof value.start === 'string' && value.start.length <= 128)).slice(0, 64).map(value => ({ pid: value.pid, start: value.start })) : [];
          this.store.put('peerProcessRelease', host, { complete: Array.isArray(cleanup?.members) && cleanup.members.length > 0 && cleanup.members.length === members.length, endpointRevision: digest(alias), observedAt: new Date(this.clock.wall()).toISOString(), reason: 'PROCESS_RELEASE_UNCONFIRMED', members, absenceConfirmed: false });
        }
        const facts = failureFacts(error);
        if (facts && (this.generation.get(host) === generation || facts.code === 'PROCESS_RELEASE_UNCONFIRMED') && facts.code !== 'PEER_RETRY_WAIT') {
          const value = this.snapshot(host, alias), failures = value.failures + 1, delay = retryDelay(failures, this.clock.random());
          this.due.set(host, this.clock.mono() + delay); this.observed.set(host, this.clock.mono());
          this.save({ ...value, generation, state: facts.retryable ? 'unavailable' : 'requires_action', freshness: 'fresh', observedAt: new Date(this.clock.wall()).toISOString(), reasonCode: facts.code, stage: facts.stage, retryable: facts.retryable,
            confidence: facts.code === 'PEER_UNAVAILABLE' ? 'unknown' : 'observed', failures, nextRetryAt: facts.retryable ? new Date(this.clock.wall() + delay).toISOString() : null,
            helper: facts.stage === 'helper' ? 'unavailable' : facts.stage === 'protocol' ? 'incompatible' : 'unknown', actions: facts.retryable ? ['retry', 'diagnostics'] : ['connection_settings', 'diagnostics'] });
        }
        throw error;
      } finally { clearTimeout(timer); if (this.controllers.get(host) === controller) this.controllers.delete(host); }
      } finally { this.release(); }
    });
    this.chains.set(host, next); void next.finally(() => { if (this.chains.get(host) === next) this.chains.delete(host); }).catch(() => {}); return next;
  }
}

export type SSHRunner = (executable: string, argv: readonly string[], options: RunOptions) => Promise<ProcessResult>;
export async function invokeSSH(alias: string, envelope: unknown, options: { signal?: AbortSignal; health?: boolean; ownership?: ProcessOwnership } = {}, runner: SSHRunner = run): Promise<ProcessResult> {
  return runner('/usr/bin/ssh', sshArguments(alias), { ...(options.ownership ? { ownership: options.ownership } : {}), input: JSON.stringify(envelope) + '\n', ...(options.signal ? { signal: options.signal } : {}),
    timeoutMs: options.health ? connectivityPolicy.healthMs : connectivityPolicy.rpcMs, maxBytes: options.health ? connectivityPolicy.healthBytes : connectivityPolicy.rpcBytes });
}

/** Git evidence belongs to the exact configured destination, never a helper
 * on a Contribution peer. A missing ref is a successful remote observation. */
export function recordGitConnectivity(store: Journal, repositoryId: string, destination: string, result: ProcessResult): Connectivity {
  const endpointRevision = digest(destination), previous = store.record<Connectivity>('gitConnectivity', repositoryId);
  const clock = policies.get(store)?.clock ?? systemClock;
  const observations = gitObserved.get(store) ?? new Map<string, number>(); gitObserved.set(store, observations); observations.set(repositoryId, clock.mono());
  const repo = store.db.prepare('SELECT body FROM repositories WHERE id=?').get(repositoryId);
  store.put('gitConnectivityContext', repositoryId, { publication: repo ? digest(JSON.parse(String(repo['body'])).config.publication) : null });
  const observedAt = new Date(clock.wall()).toISOString(), ready = [0, 2].includes(result.code) && !result.timedOut && !result.cancelled && !result.outputLimited && result.cleanup?.released !== false;
  const failure = transportFailure(result), facts = failureFacts(failure)!;
  const value: Connectivity = { schemaVersion: 1, targetKind: 'git-remote', targetId: repositoryId, endpointRevision, generation: previous?.endpointRevision === endpointRevision ? previous.generation : (previous?.generation ?? 0) + 1,
    state: ready ? 'ready' : facts.retryable ? 'unavailable' : 'requires_action', freshness: 'fresh', observedAt, lastSuccessAt: ready ? observedAt : previous?.endpointRevision === endpointRevision ? previous.lastSuccessAt : null,
    reasonCode: ready ? 'NONE' : facts.code === 'PEER_UNAVAILABLE' ? 'GIT_REMOTE_UNAVAILABLE' : facts.code, stage: ready ? 'none' : facts.stage, retryable: !ready && facts.retryable, confidence: ready || facts.code !== 'PEER_UNAVAILABLE' ? 'observed' : 'unknown', source: 'git', helper: 'not_applicable', failures: ready ? 0 : (previous?.failures ?? 0) + 1, nextRetryAt: null, actions: ready ? ['diagnostics'] : ['retry', 'diagnostics'], capabilities: [], provider: { status: 'not_applicable', client: 'unknown', target: 'unknown', path: 'unknown' } };
  assertContract('connectivity', value); store.enableConnectivity(); store.put('gitConnectivity', repositoryId, value); return value;
}

/** Offline presentation shared by app, CLI and allowlisted reports. */
export function gitConnectivitySnapshot(store: Journal, repositoryId: string, publication?: unknown): Connectivity | null {
  const value = store.record<Connectivity>('gitConnectivity', repositoryId); if (!value) return null;
  const row = store.db.prepare('SELECT body FROM repositories WHERE id=?').get(repositoryId);
  const config = publication ?? (row ? JSON.parse(String(row['body'])).config.publication : undefined);
  if (config && (digest(config) !== store.record<{publication:string}>('gitConnectivityContext', repositoryId)?.publication || !(config as {remote?:string}).remote || !(config as {branch?:string}).branch)) return null;
  const clock = policies.get(store)?.clock ?? systemClock, observed = gitObserved.get(store)?.get(repositoryId);
  return { ...value, freshness: observed !== undefined && clock.mono() - observed <= connectivityPolicy.ttlMs ? 'fresh' : value.observedAt ? 'stale' : 'unknown' };
}
export function connectivitySnapshots(store: Journal): Connectivity[] {
  const policy = policies.get(store) ?? new PeerConnectivity(store);
  const peers = store.records<{hostId:string;alias:string|null}>('peer').filter(p => p.alias).map(p => policy.snapshot(p.hostId, p.alias!));
  const git = store.records<Connectivity>('gitConnectivity').flatMap(value => { const current = gitConnectivitySnapshot(store, value.targetId); return current ? [current] : []; });
  return [...peers, ...git];
}
