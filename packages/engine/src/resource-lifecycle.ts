import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { assertContract, validateContractFormat } from '@contribution/contracts';
import type { Resource, ResourcePolicy } from '@contribution/contracts';
import type { Journal, Operation } from './journal.js';
import { digest, id, now, requireValue, Fault } from './core.js';
import type { ObjectValue } from './core.js';
import type { Enrolled } from './repositories.js';
import { readStableFile } from './bounded-file.js';

export type ResourceIdentity = NonNullable<Resource['identity']>;
export interface ResourceContext { clone: string; revision: string }
export interface ResourceAdapter {
  id: string; version: number;
  observe(resource: Resource, signal: AbortSignal): Promise<ResourceIdentity | 'absent' | 'unknown'>;
  /** Invoke the synchronous guard after the adapter's final awaited preflight,
   * immediately before its supported owning API. No guessed global fallback. */
  stop(resource: Resource, guard: () => void, signal: AbortSignal): Promise<void>;
}
export interface ResourceIntent {
  requestId: string; kind: Resource['kind']; owner: Resource['owner']; lifetime: Resource['lifetime'];
  adapter: string; adapterVersion: number; scope: string; reason: string; stopAction: string;
  parentId?: string; dependencies?: string[]; deadlineAt?: string; pinned?: boolean;
}
interface Preview { token: string; resources: Resource[]; createdAt: string }
interface Cleanup { requestId: string; preview: Preview; completed: string[]; state: 'stopping' | 'completed'; result?: ObjectValue }
interface CleanupExpectation { requestId: string; current: string }
const locks = new WeakMap<Journal, Set<string>>();
let boot: string | undefined;
export function bootIdentity(): string {
  if (boot) return boot;
  try {
    if (process.platform === 'darwin') boot = execFileSync('/usr/sbin/sysctl', ['-n', 'kern.bootsessionuuid'], { encoding: 'utf8', timeout: 2000 }).trim();
    else if (process.platform === 'linux') boot = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
  } catch { /* Denied boot inspection is never the current time or a fake UUID. */ }
  requireValue(boot, 'BOOT_IDENTITY_UNAVAILABLE', 'This platform cannot establish the current host boot identity.', 3); return boot;
}
export function enrolledResourceContext(store: Journal, repositoryId: string): ResourceContext {
  const row = store.db.prepare('SELECT body FROM repositories WHERE id=?').get(repositoryId);
  requireValue(row, 'REPOSITORY_NOT_ENROLLED', 'Resource ownership requires the enrolled local clone.', 3);
  const repo = JSON.parse(String(row['body'])) as Enrolled;
  const paths = [repo.path, repo.commonDir].map(path => {
    const stat = lstatSync(path);
    requireValue(!stat.isSymbolicLink() && stat.isDirectory() && realpathSync(path) === path, 'RESOURCE_CONTEXT_CHANGED', 'The enrolled clone path was replaced or linked.', 3);
    return { path, dev: stat.dev, ino: stat.ino };
  });
  const config = join(repo.path, 'contribution.json');
  if (repo.policySource === 'tracked') requireValue(existsSync(config) && digest(JSON.parse(readStableFile(config, 1024 * 1024, 'RESOURCE_CONTEXT_CHANGED').toString('utf8'))) === repo.revision, 'RESOURCE_CONTEXT_CHANGED', 'Enrolled policy changed; preserve its retained resources.', 3);
  return { clone: digest({ paths, owner: repo.canonicalHostId, authority: store.record('authority', repositoryId) ?? null }), revision: repo.revision };
}
/** One journal and scheduler own this lifecycle. Adapters contain platform/API
 * identity mechanics; discovery can never create allocation or stop authority. */
export class ResourceLifecycle {
  private readonly adapters = new Map<string, ResourceAdapter>();
  constructor(readonly store: Journal, readonly context: (repo: string) => ResourceContext = repo => enrolledResourceContext(store, repo), readonly bootContext: () => string = bootIdentity) {}
  register(adapter: ResourceAdapter): void {
    const key = `${adapter.id}@${adapter.version}`;
    requireValue(!this.adapters.has(key), 'RESOURCE_ADAPTER_CONFLICT', 'An adapter version already has its owner.'); this.adapters.set(key, adapter);
  }
  all(): Resource[] {
    const rows = this.store.db.prepare("SELECT body FROM records WHERE namespace='resource' LIMIT 10001").all().map(row => JSON.parse(String(row['body'])) as Resource);
    requireValue(rows.length <= 10000, 'RESOURCE_CENSUS_LIMIT', 'Resource census exceeds its bounded inspection limit.', 3);
    for (const row of rows) assertContract('resource', row); return rows;
  }
  get(resourceId: string): Resource {
    const value = this.store.record<Resource>('resource', resourceId);
    requireValue(value, 'RESOURCE_NOT_FOUND', 'Select an exact retained resource.'); assertContract('resource', value); return value;
  }
  private save(value: Resource): Resource { assertContract('resource', value); this.store.put('resource', value.resourceId, value); return value; }
  policy(): { policy: ResourcePolicy; revision: string } {
    // Empty maps deliberately inherit external adapter admission, without a new
    // guessed global limit. The existing service/storage budgets still apply.
    const policy = this.store.getMeta<ResourcePolicy>('resourcePolicy') ?? { schemaVersion: 1, hostLimits: {}, projectLimits: {} };
    assertContract('resource-policy', policy); return { policy, revision: digest(policy) };
  }
  configure(value: unknown, revision: string, requestId: string): ObjectValue {
    assertContract('resource-policy', value); requireValue(validateContractFormat('uuid', requestId), 'INVALID_USAGE', 'Policy requires an immutable request UUID.', 2);
    const input = digest({ value, revision }), prior = this.store.record<{ input: string; result: ObjectValue }>('resourcePolicyRequest', requestId);
    if (prior) { requireValue(prior.input === input, 'REQUEST_ID_CONFLICT', 'The policy request has other inputs.'); return prior.result; }
    requireValue(!this.store.byRequest(requestId) && !this.all().some(r => r.requestId === requestId), 'REQUEST_ID_CONFLICT', 'The request belongs to another owner.');
    requireValue(this.policy().revision === revision, 'REVISION_CONFLICT', 'Resource policy changed.');
    const result = { policy: value, revision: digest(value), requestId };
    this.store.transaction(() => { this.store.setMeta('resourcePolicy', value); this.store.put('resourcePolicyRequest', requestId, { input, result }); }); return result;
  }
  begin(op: Operation, input: ResourceIntent): Resource {
    requireValue(validateContractFormat('uuid', input.requestId), 'INVALID_USAGE', 'Resource intent needs an immutable request UUID.', 2);
    const key = digest({ operationId: op.operationId, attemptId: op.attemptId, input });
    const prior = this.all().find(r => r.requestId === input.requestId);
    if (prior) { requireValue(this.store.record<{ digest: string }>('resourceRequest', input.requestId)?.digest === key, 'REQUEST_ID_CONFLICT', 'The resource request has changed inputs.'); return prior; }
    const context = this.context(op.repositoryId), rows = this.all(), { policy } = this.policy();
    requireValue(!this.store.records<Cleanup>('resourceCleanup').some(c => c.state === 'stopping' && c.preview.resources.some(r => r.scope === input.scope)), 'RESOURCE_CLEANUP_PENDING', 'Resume the exact pending cleanup before admitting this scope.', 3);
    const occupied = rows.filter(r => r.state !== 'stopped' && ['utility', 'borrowed'].includes(r.owner));
    requireValue(!occupied.some(r => r.scope === input.scope && r.hostId === this.store.hostId && r.resourceId !== input.parentId), 'RESOURCE_BUSY', 'This exact resource scope has an unreleased owner.', 4);
    if (input.owner === 'utility') {
      for (const [limit, count] of [[policy.hostLimits[input.kind], occupied.filter(r => r.kind === input.kind).length], [policy.projectLimits[input.kind], occupied.filter(r => r.kind === input.kind && r.repositoryId === op.repositoryId).length]])
        requireValue(limit === undefined || count! < limit, 'RESOURCE_LIMIT', 'Resource admission reached its configured budget.', 4);
    }
    if (input.parentId) {
      const parent = this.get(input.parentId);
      requireValue(parent.hostId === this.store.hostId && parent.repositoryId === op.repositoryId && parent.bootId === this.bootContext() && ['active', 'retained'].includes(parent.state) && input.owner === 'borrowed', 'RESOURCE_PARENT_CHANGED', 'Nested operations borrow an active outer owner; they never dispose of it.');
    }
    this.store.assertAdmissionStorage();
    const stamp = now();
    const record: Resource = { schemaVersion: 1, resourceId: id(), requestId: input.requestId, operationId: op.operationId, attemptId: op.attemptId, repositoryId: op.repositoryId,
      hostId: this.store.hostId, bootId: this.bootContext(), clone: context.clone, enrollmentRevision: context.revision, parentId: input.parentId ?? null, dependencies: input.dependencies ?? [],
      kind: input.kind, owner: input.owner, lifetime: input.lifetime, adapter: input.adapter, adapterVersion: input.adapterVersion, scope: input.scope, token: id(), generation: 1,
      state: 'intent', identity: null, reason: input.reason, stopAction: input.stopAction, deadlineAt: input.deadlineAt ?? null, pinned: input.pinned ?? false,
      createdAt: stamp, updatedAt: stamp, retries: 0, retryAfter: null, outcome: null };
    this.store.transaction(() => {
      // Transactional compatibility migration, before the first allocation.
      // A v1 reader refuses user_version=2 before any write or worker dispatch.
      this.store.db.exec('PRAGMA user_version=2'); this.save(record); this.store.put('resourceRequest', input.requestId, { digest: key, resourceId: record.resourceId });
    }); return record;
  }
  assertCurrent(expected: Resource): void {
    const latest = this.get(expected.resourceId), context = this.context(expected.repositoryId);
    requireValue(digest(latest) === digest(expected) && expected.hostId === this.store.hostId && expected.bootId === this.bootContext() &&
      context.clone === expected.clone && context.revision === expected.enrollmentRevision,
      'RESOURCE_IDENTITY_CHANGED', 'Resource ownership, host boot, clone or enrollment changed; preserve the resource.', 3);
  }
  classifyBorrowed(expected: Resource): Resource {
    this.assertCurrent(expected); requireValue(expected.state === 'intent', 'RESOURCE_TRANSITION_INVALID', 'A preexisting observation must precede any grant.');
    return this.save({ ...expected, owner: 'borrowed', lifetime: 'borrowed', generation: expected.generation + 1, updatedAt: now() });
  }
  allocate(expected: Resource, identity: ResourceIdentity): Resource {
    this.assertCurrent(expected); requireValue(expected.state === 'intent', 'RESOURCE_TRANSITION_INVALID', 'Allocation cannot be replayed.');
    requireValue(identity.type === (['process', 'server'].includes(expected.kind) ? 'process' : expected.kind), 'RESOURCE_IDENTITY_INVALID', 'Resource kind and exact identity disagree.');
    return this.save({ ...expected, identity, state: 'allocated', generation: expected.generation + 1, updatedAt: now() });
  }
  grant(expected: Resource): Resource {
    this.assertCurrent(expected); requireValue(expected.state === 'allocated' && expected.identity && !this.store.getMeta('maintenance') && !this.store.getMeta('paused'), 'RESOURCE_GRANT_UNAVAILABLE', 'The allocation, policy or service state cannot grant execution.', 3);
    return this.save({ ...expected, state: expected.owner === 'utility' && expected.lifetime === 'ephemeral' ? 'active' : 'retained', generation: expected.generation + 1, updatedAt: now() });
  }
  unresolved(expected: Resource, reason: string): Resource {
    const latest = this.get(expected.resourceId);
    // Never overwrite a newer owner's record after an awaited inspection.
    requireValue(digest(latest) === digest(expected), 'RESOURCE_IDENTITY_CHANGED', 'The resource record changed during reconciliation.');
    return this.save({ ...latest, state: 'unresolved', reason, generation: latest.generation + 1, updatedAt: now() });
  }
  finish(expected: Resource, outcome: ObjectValue, released: boolean): Resource {
    this.assertCurrent(expected);
    return this.save({ ...expected, state: released ? 'stopped' : 'unresolved', outcome, generation: expected.generation + 1, updatedAt: now() });
  }
  transition(expected: Resource, patch: Pick<Partial<Resource>, 'identity' | 'state' | 'pinned' | 'deadlineAt'>): Resource {
    this.assertCurrent(expected); return this.save({ ...expected, ...patch, generation: expected.generation + 1, updatedAt: now() });
  }
  blockers(repositoryId?: string): Resource[] { return this.all().filter(r => ['utility', 'borrowed'].includes(r.owner) && r.state !== 'stopped' && (!repositoryId || r.repositoryId === repositoryId)); }
  static pending(store: Journal, repositoryId: string, exceptOperation?: string): boolean {
    return store.records<Resource>('resource').some(r => r.repositoryId === repositoryId && ['utility', 'borrowed'].includes(r.owner) && r.operationId !== exceptOperation && ['ephemeral', 'borrowed'].includes(r.lifetime) && r.state !== 'stopped');
  }
  private cleanupOwns(cleanup: Cleanup, expected: Resource): boolean {
    const selected = cleanup.preview.resources.find(r => r.resourceId === expected.resourceId);
    const proof = this.store.record<CleanupExpectation>('resourceCleanupExpectation', expected.resourceId);
    return cleanup.state === 'stopping' && !cleanup.completed.includes(expected.resourceId) && Boolean(selected &&
      (digest(selected) === digest(expected) || proof?.requestId === cleanup.requestId && proof.current === digest(expected)));
  }
  /** Only unchanged, host-local records already endorsed by this review can
   * carry observation transitions into its continuation. Never adopt drift. */
  private observationCleanup(expected: Resource): string | undefined {
    try { this.assertCurrent(expected); } catch { return undefined; }
    const owners = this.store.records<Cleanup>('resourceCleanup').filter(c => this.cleanupOwns(c, expected));
    return owners.length === 1 ? owners[0]!.requestId : undefined;
  }
  /** Caller holds the journal transaction: the resource and its continuation
   * must commit or roll back together, including observation and error paths. */
  private saveTransition(expected: Resource, patch: Pick<Partial<Resource>, 'state' | 'reason' | 'outcome' | 'retries' | 'retryAfter'>, cleanupRequest?: string): Resource {
    requireValue(digest(this.get(expected.resourceId)) === digest(expected), 'RESOURCE_IDENTITY_CHANGED', 'The resource changed before its retained transition.');
    if (cleanupRequest) {
      const cleanup = this.store.record<Cleanup>('resourceCleanup', cleanupRequest);
      requireValue(cleanup && this.cleanupOwns(cleanup, expected), 'RESOURCE_SELECTION_CHANGED', 'This transition is outside the retained cleanup selection.');
    }
    const result = this.save({ ...expected, ...patch, generation: expected.generation + 1, updatedAt: now() });
    if (cleanupRequest) this.store.put('resourceCleanupExpectation', expected.resourceId, { requestId: cleanupRequest, current: digest(result) });
    return result;
  }
  private saveObservation(expected: Resource, patch: Pick<Partial<Resource>, 'state' | 'reason' | 'outcome'>): Resource {
    return this.saveTransition(expected, patch, this.observationCleanup(expected));
  }
  async stop(resourceId: string, manual = false, deadlineMs = 10000, cleanupRequest?: string): Promise<Resource> {
    requireValue(Number.isSafeInteger(deadlineMs) && deadlineMs > 0 && deadlineMs <= 30000, 'RESOURCE_DEADLINE_INVALID', 'Cleanup has a finite deadline no longer than thirty seconds.');
    let record = this.get(resourceId); if (record.state === 'stopped') return record;
    requireValue(record.owner === 'utility' && !record.pinned && (manual || record.lifetime === 'ephemeral'), 'RESOURCE_PROTECTED', 'Borrowed, native, unknown, pinned or retained resources require their owning action.', 3);
    this.assertCurrent(record);
    requireValue(!this.all().some(r => r.resourceId !== record.resourceId && r.state !== 'stopped' && (r.dependencies.includes(record.resourceId) || r.parentId === record.resourceId || record.kind === 'simulator' && r.kind === 'simulator' && r.identity?.value['udid'] === record.identity?.value['udid'])), 'RESOURCE_DEPENDENCY_ACTIVE', 'Stop owned dependants before this resource.', 3);
    requireValue(record.identity && record.retries < 3 && (!record.retryAfter || Date.now() >= Date.parse(record.retryAfter)), 'RESOURCE_RECONCILIATION_REQUIRED', 'Identity is missing or the bounded recovery budget needs explicit inspection.', 3);
    const adapter = this.adapters.get(`${record.adapter}@${record.adapterVersion}`);
    requireValue(adapter, 'RESOURCE_ADAPTER_UNAVAILABLE', `Use the retained owning action: ${record.stopAction}`, 3);
    const busy = locks.get(this.store) ?? new Set<string>(); locks.set(this.store, busy);
    requireValue(!busy.has(resourceId), 'RESOURCE_BUSY', 'The same resource is being reconciled.', 4); busy.add(resourceId);
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Fault('RESOURCE_CLEANUP_TIMEOUT', 'Resource cleanup reached its finite deadline.', 3)); }, deadlineMs); });
    try {
      record = this.store.transaction(() => this.saveTransition(record, { state: 'stopping', retries: record.retries + 1, retryAfter: null }, cleanupRequest));
      const selected = record;
      const guard = (): void => { requireValue(!controller.signal.aborted, 'RESOURCE_CLEANUP_TIMEOUT', 'Cleanup authority expired.', 3); this.assertCurrent(selected); };
      const effect = async (): Promise<Resource> => {
        const observation = await adapter.observe(selected, controller.signal); guard();
        if (observation !== 'absent') {
          requireValue(observation !== 'unknown' && digest(observation) === digest(selected.identity), 'RESOURCE_IDENTITY_CHANGED', 'Live resource identity is changed or unknown.', 3);
          await adapter.stop(selected, guard, controller.signal); guard();
          requireValue(await adapter.observe(selected, controller.signal) === 'absent', 'RESOURCE_RELEASE_UNCONFIRMED', 'The owning tool has not confirmed release.', 3); guard();
        }
        this.assertCurrent(selected);
        return this.store.transaction(() => this.saveTransition(selected, { state: 'stopped', outcome: { released: true, confirmedAt: now(), adapter: adapter.id } }, cleanupRequest));
      };
      return await Promise.race([effect(), timeout]);
    } catch (error) {
      const current = this.get(resourceId);
      if (digest(current) === digest(record)) this.store.transaction(() => this.saveTransition(current, { state: 'unresolved', reason: error instanceof Fault ? error.code : 'RESOURCE_CLEANUP_FAILED', retryAfter: new Date(Date.now() + 30000).toISOString() }, cleanupRequest));
      throw error;
    } finally { controller.abort(); if (timer) clearTimeout(timer); busy.delete(resourceId); }
  }
  async reconcile(deadlineMs = 5000): Promise<void> {
    requireValue(Number.isSafeInteger(deadlineMs) && deadlineMs > 0 && deadlineMs <= 30000, 'RESOURCE_DEADLINE_INVALID', 'Observation requires a finite total deadline.', 3);
    const deadline = performance.now() + deadlineMs, pending = this.all().filter(r => r.state !== 'stopped' && ['utility', 'borrowed'].includes(r.owner));
    // Startup is observation-only. No allocation, repeated start, kill or lease
    // release is inferred from an expired wall clock or missing parent.
    for (const prior of pending) {
      if (performance.now() >= deadline) {
        this.store.transaction(() => { for (const deferred of pending) if (['ephemeral', 'borrowed'].includes(deferred.lifetime) && digest(this.get(deferred.resourceId)) === digest(deferred)) this.saveObservation(deferred, { state: 'unresolved', reason: 'RESOURCE_OBSERVATION_DEFERRED: resume bounded observation for this exact owner.' }); });
        break;
      }
      try {
        this.assertCurrent(prior);
        const adapter = this.adapters.get(`${prior.adapter}@${prior.adapterVersion}`);
        const controller = new AbortController(); let timer: NodeJS.Timeout | undefined, observed: ResourceIdentity | 'absent' | 'unknown';
        try { observed = adapter ? await Promise.race([adapter.observe(prior, controller.signal), new Promise<'unknown'>(resolve => { timer = setTimeout(() => { controller.abort(); resolve('unknown'); }, Math.max(1, Math.ceil(Math.min(2000, deadline - performance.now())))); })]) : 'unknown'; }
        finally { controller.abort(); if (timer) clearTimeout(timer); }
        this.assertCurrent(prior);
        if (observed === 'absent' && prior.identity) this.store.transaction(() => this.saveObservation(prior, { state: 'stopped', outcome: { released: true, observedAt: now(), recovery: 'observation' } }));
        else if (['ephemeral', 'borrowed'].includes(prior.lifetime)) this.store.transaction(() => this.saveObservation(prior, { state: 'unresolved', reason: 'Restart requires the exact retained owning action; no start or teardown was replayed.' }));
      } catch { const latest = this.get(prior.resourceId); if (digest(latest) === digest(prior)) this.store.transaction(() => this.saveObservation(prior, { state: 'unresolved', reason: 'RESOURCE_OBSERVATION_UNCONFIRMED' })); }
    }
  }
  async preview(): Promise<ObjectValue> {
    const resources: Resource[] = [], protectedRows: ObjectValue[] = [];
    for (const record of this.all().filter(r => r.state !== 'stopped')) {
      try {
        this.assertCurrent(record);
        requireValue(record.owner === 'utility' && !record.pinned && record.identity && this.adapters.has(`${record.adapter}@${record.adapterVersion}`), 'RESOURCE_PROTECTED', record.stopAction, 3);
        requireValue(this.store.get(record.operationId).state !== 'running', 'RESOURCE_OPERATION_ACTIVE', 'Cancel/drain the active owner first.', 3);
        resources.push(record);
      } catch (error) { protectedRows.push({ resourceId: record.resourceId, reason: error instanceof Fault ? error.code : 'RESOURCE_INSPECTION_UNAVAILABLE', stopAction: record.stopAction }); }
    }
    const preview: Preview = { token: id(), resources, createdAt: now() }; this.store.put('resourcePreview', preview.token, preview);
    return { scopeToken: preview.token, candidates: resources.map(r => ({ resourceId: r.resourceId, kind: r.kind, identity: r.identity, owner: r.owner, lifetime: r.lifetime, reason: r.reason, stopAction: r.stopAction, dependencies: r.dependencies, estimatedBytes: null, recoverability: 'retained receipt; resource-specific restart may require a new grant' })), protected: protectedRows, mutation: 'none' };
  }
  async apply(token: string, requestId: string): Promise<ObjectValue> {
    requireValue(validateContractFormat('uuid', token) && validateContractFormat('uuid', requestId), 'INVALID_USAGE', 'Use the exact review token and request UUID.', 2);
    let cleanup = this.store.record<Cleanup>('resourceCleanup', requestId);
    if (cleanup) { requireValue(cleanup.preview.token === token, 'REQUEST_ID_CONFLICT', 'Cleanup request has a different selection.'); if (cleanup.result) return cleanup.result; }
    const preview = cleanup?.preview ?? this.store.record<Preview>('resourcePreview', token);
    requireValue(preview, 'RESOURCE_PREVIEW_REQUIRED', 'Review exact resources before cleanup.', 3);
    requireValue(!this.store.records<Cleanup>('resourceCleanup').some(r => r.requestId !== requestId && r.state === 'stopping' && r.preview.resources.some(a => preview.resources.some(b => a.scope === b.scope))), 'RESOURCE_CLEANUP_PENDING', 'Resume the original cleanup in this scope.', 3);
    if (!cleanup) {
      for (const r of preview.resources) { this.assertCurrent(r); requireValue(this.store.get(r.operationId).state !== 'running', 'RESOURCE_OPERATION_ACTIVE', 'Cancel/drain the exact owner first.', 3); }
      cleanup = { requestId, preview, completed: [], state: 'stopping' };
      this.store.transaction(() => {
        this.store.put('resourceCleanup', requestId, cleanup);
        for (const selected of preview.resources) this.store.put('resourceCleanupExpectation', selected.resourceId, { requestId, current: digest(selected) });
      });
    }
    // Dependencies first. A cycle remains protected and receives an action.
    let remaining = preview.resources.filter(r => !cleanup!.completed.includes(r.resourceId));
    while (remaining.length) {
      const selected = remaining.find(r => !remaining.some(other => other.dependencies.includes(r.resourceId) || other.parentId === r.resourceId));
      requireValue(selected, 'RESOURCE_DEPENDENCY_CYCLE', 'Inspect the retained dependency graph before cleanup.', 3);
      const current = this.get(selected.resourceId), expected = this.store.record<CleanupExpectation>('resourceCleanupExpectation', selected.resourceId);
      requireValue(digest(current) === digest(selected) || expected?.requestId === requestId && expected.current === digest(current), 'RESOURCE_SELECTION_CHANGED', 'Generation/state changed outside this retained cleanup; preserve the resource.', 3);
      requireValue(digest(current.identity) === digest(selected.identity) && current.token === selected.token && current.owner === selected.owner && current.lifetime === selected.lifetime && current.pinned === selected.pinned && current.deadlineAt === selected.deadlineAt && current.adapter === selected.adapter && current.adapterVersion === selected.adapterVersion && current.parentId === selected.parentId && current.hostId === selected.hostId && current.bootId === selected.bootId && current.clone === selected.clone && current.enrollmentRevision === selected.enrollmentRevision && digest(current.dependencies) === digest(selected.dependencies), 'RESOURCE_SELECTION_CHANGED', 'The reviewed resource changed; preserve it.');
      if (current.state !== 'stopped') await this.stop(current.resourceId, true, 10000, requestId);
      cleanup.completed.push(current.resourceId); this.store.put('resourceCleanup', requestId, cleanup); remaining = remaining.filter(r => r.resourceId !== current.resourceId);
    }
    const result = { requestId, scopeToken: token, released: cleanup.completed };
    this.store.put('resourceCleanup', requestId, { ...cleanup, state: 'completed', result }); return result;
  }
}
