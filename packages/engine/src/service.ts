import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertContract, buildIdentity } from '@contribution/contracts';
import type { Response, Machine, Repository, DeviceOperation } from '@contribution/contracts';
import { completed, rejected, requireValue, string, object, digest, Fault, terminal, now, isGitJob } from './core.js';
import type { ObjectValue } from './core.js';
import { Journal } from './journal.js';
import type { Operation } from './journal.js';
import type { Enrolled } from './repositories.js';
import { Repositories } from './repositories.js';
import { Workflows } from './workflows.js';
import { discover, identity, git, gitText, inputFingerprint } from './git.js';
import { Lease, alive, processIdentity, gitPushAncestor } from './process.js';
import type { Payload } from './payload.js';
import { GitHubMonitor } from './github.js';
import { Peers, remoteDeviceCommands, remoteDeviceReads } from './peers.js';
import type { PeerTransport } from './peers.js';
import { Devices } from './devices.js';
import type { DeviceBackend } from './devices.js';
import type { DeviceBuildDriver } from './device-builds.js';
import { DeviceArtifactTransfers } from './device-transfer.js';
import { DeviceOwnershipTransfers } from './device-ownership.js';
import { CoreDeviceBackend } from './device-coredevice.js';
import { ProjectRuntimes } from './project-runtime.js';
import { Adoptions } from './adoption.js';
import { LegacyReporting } from './legacy-reporting.js';
import { LegacyHookBorrow } from './legacy-hook-borrow.js';
import { LegacyPrimaryLease } from './legacy-lease.js';
import { policyInventory, identifyAdoption } from '@contribution/adapters';
import { Milestones } from './notifications.js';
import type { Notice } from './notifications.js';
import { Maintenance } from './maintenance.js';
import { StorageRetention } from './storage.js';
import { OwnedWorktrees } from './owned-worktrees.js';
import { RepositoryRemoval } from './repository-removal.js';

export interface Request { schemaVersion: 1; command: string; args: ObjectValue; cwd: string }
const allowed: Record<string, string[]> = {
  'version': [], 'doctor': [], 'service.status': [], 'service.pause': [], 'service.resume': [], 'service.restart': ['whenIdle'],
  'service.storage': ['preview', 'scopeToken', 'requestId', 'worktrees'],
  'maintenance.begin': ['requestId'], 'maintenance.status': [], 'maintenance.stop': ['windowId'],
  'maintenance.resume': ['windowId', 'observedPayload', 'outcome'],
  'repos.list': [], 'repos.discover': ['root'], 'repos.add': ['path', 'profile', 'availability', 'config'], 'repos.create': ['path', 'requestId'],
  'repos.resolve': ['repo', 'host', 'path', 'expectedRevision'],
  'repos.pair': ['repo', 'host', 'requestId'], 'repos.seed': ['repo', 'requestId'], 'repos.mirror': ['repo', 'requestId'],
  'repos.runtime': ['repo', 'node', 'pnpm'], 'repos.migration': ['repo', 'adapter', 'prepareReporting', 'requestId', 'prepareAdoption', 'prepareExistingAdoption', 'originalTip', 'migrationTip', 'applyAdoption', 'activateAdoption', 'rollbackAdoption', 'adoptionPlan', 'expectedRevision'],
  'repos.initialize': ['repo', 'requestId', 'expectedRevision'], 'repos.inspect': ['repo'], 'repos.configure': ['repo', 'config', 'expectedRevision', 'requestId'],
  'repos.relocate': ['repo', 'path'], 'repos.remove': ['repo'], 'status': ['repo', 'refresh'],
  'push': ['repo', 'preview', 'expectedTip', 'scopeToken', 'requestId'], 'submit': ['repo', 'sourcePath', 'sourceTip', 'base', 'requestId', 'metadata'],
  'checks.run': ['repo', 'sourcePath', 'canonical', 'checkId', 'fresh', 'requestId'],
  'runs.list': ['repo'], 'runs.get': ['operationId'], 'runs.cancel': ['operationId'], 'runs.pin': ['operationId'], 'runs.unpin': ['operationId'],
  'runs.events': ['operationId', 'after'], 'runs.reconcile': ['operationId'], 'logs': ['operationId', 'tail'], 'repair-context': ['operationId'], 'codex.open': ['repo', 'operationId'],
  'settings.get': [], 'settings.apply': ['config', 'expectedRevision', 'requestId'], 'hosts.list': [], 'hosts.pair': ['sshAlias'], 'hosts.sync': ['host'], 'peer.exchange': ['envelope'],
  'hook.pre-push': ['repo', 'operationId', 'hookToken', 'remote', 'url', 'stdin', 'caller'], 'update.check': [], 'update.apply': ['whenIdle'],
  'hook.borrow': ['repo', 'operationId', 'hookToken', 'caller'], 'hook.release-borrow': ['repo', 'operationId', 'hookToken', 'caller', 'borrowToken'],
  'hook.adopted.begin': ['repo', 'operationId', 'hookToken', 'caller', 'remote', 'url', 'stdin'], 'hook.adopted.finish': ['repo', 'operationId', 'hookToken', 'caller', 'gateExit', 'gateOutput', 'outputTruncated'],
  'github.jobs': ['repo', 'runId', 'attempt'], 'github.logs': ['repo', 'runId', 'attempt', 'jobId'],
  'notifications.pending': [], 'notifications.context': ['repo', 'originHostId', 'noticeId'],
  'notifications.claim': ['repo', 'originHostId', 'noticeId', 'revision', 'requestId'],
  'notifications.acknowledge': ['repo', 'originHostId', 'noticeId', 'revision', 'token', 'delivered'],
};
for (const name of ['connect', 'prepare', 'install', 'launch', 'logs', 'test', 'ui', 'debug', 'capture', 'disconnect', 'qualify'])
  allowed[`devices.${name}`] = ['repo', 'host', 'device', 'requestId', 'artifact', 'launch', 'sourceTip', 'buildProfile', 'appRef', 'plan', 'sessionProfile', 'durationSeconds', 'maxBytes', 'kind'];
allowed['devices.configure'] = ['repo', 'host', 'config', 'expectedRevision', 'requestId'];
allowed['devices.profile'] = ['repo', 'host'];
allowed['devices.artifacts.list'] = ['repo', 'host'];
allowed['devices.artifacts.get'] = ['repo', 'host', 'artifact'];
allowed['devices.artifacts.transfer'] = ['repo', 'host', 'fromHost', 'artifact', 'toHost', 'requestId'];
allowed['devices.list'] = ['repo', 'host']; allowed['devices.status'] = ['repo', 'host', 'device', 'refresh'];
allowed['devices.apps'] = ['repo', 'host', 'device'];
allowed['devices.authorize'] = ['repo', 'host', 'device', 'operations', 'requestId']; allowed['devices.revoke'] = allowed['devices.authorize']!;
allowed['devices.reconcile'] = ['host', 'operationId', 'requestId'];
allowed['devices.transfer-host'] = ['repo', 'device', 'fromHost', 'host', 'expectedRevision', 'requestId', 'releaseRef'];
allowed['devices.evidence.record'] = ['repo', 'host', 'config', 'requestId'];
allowed['devices.evidence.get'] = ['repo', 'host', 'evidence'];
allowed['devices.evidence.review'] = ['repo', 'host', 'evidence', 'expectedRevision', 'requestId'];
export class Engine {
  readonly repos: Repositories;
  readonly workflows: Workflows;
  readonly adoptions: Adoptions;
  readonly github: GitHubMonitor;
  readonly peers: Peers;
  readonly devices: Devices;
  readonly artifacts: DeviceArtifactTransfers;
  readonly deviceOwnership: DeviceOwnershipTransfers;
  readonly maintenance: Maintenance;
  readonly active = new Map<string, AbortController>();
  readonly activeRepositories = new Set<string>();
  private readonly externalHooks = new Map<string, { lease: LegacyPrimaryLease; timer: NodeJS.Timeout }>();
  stopping = false;
  restartRequested = false;
  private scheduled = false;
  private notificationRefresh = false;
  private notificationRefreshAt = 0;
  private requests = 0;
  get backgroundBusy(): boolean { return this.notificationRefresh || this.github.busy || this.peers.busy || this.maintenance.busy || this.requests > 0; }
  constructor(readonly store: Journal, readonly payload: Payload, peerTransport?: PeerTransport, deviceRuntime?: { backend: DeviceBackend; mode: 'observed' | 'fixture'; buildDriver?: DeviceBuildDriver }) {
    this.maintenance = new Maintenance(store, payload.identity);
    this.repos = new Repositories(store); this.adoptions = new Adoptions(store, this.repos); this.workflows = new Workflows(store, this.repos, payload); this.github = new GitHubMonitor(store);
    this.peers = new Peers(store, this.repos, payload.identity, peerTransport);
    this.peers.cancelLocal = op => this.cancel(op);
    this.peers.prepareFence = repo => this.workflows.ensureHook(repo);
    this.peers.dispatchLocal = (command, args) => this.dispatch({ schemaVersion: 1, command, args, cwd: this.store.directory });
    this.devices = new Devices(store, deviceRuntime?.backend ?? new CoreDeviceBackend(store), payload.identity, deviceRuntime?.mode ?? 'observed', deviceRuntime?.buildDriver);
    this.artifacts = new DeviceArtifactTransfers(store, deviceRuntime?.mode ?? 'observed', (host, action, body) => this.peers.call(host, action, body));
    this.peers.receiveArtifact = (repo, from, action, body) => this.artifacts.receive(repo, from, action, body);
    this.deviceOwnership = new DeviceOwnershipTransfers(store, this.devices, (host, action, body) => this.peers.call(host, action, body));
    this.peers.receiveDeviceOwnership = (repo, from, release) => this.deviceOwnership.receive(repo, from, release);
    if (!store.getMeta('settings')) {
      const settings: Machine = { schemaVersion: 1, hostId: store.hostId, label: 'This Mac', role: 'standalone', primaryHostId: store.hostId,
        primarySshAlias: null, projectRoots: [], repositories: [], notifications: { preferredHostId: store.hostId, success: true, failure: true },
        retention: { rawLogDays: 30, summaryDays: 365, maxLogBytes: 2147483648 }, remoteDevices: { enabled: false, maintainSession: false } };
      store.setMeta('settings', settings);
    }
    for (const op of store.list(100000).filter(item => item.state === 'running')) {
      let result = op.result;
      if (op.kind === 'device') {
        const receipt = structuredClone(op.result['deviceOperation']) as DeviceOperation;
        if (receipt) {
          receipt.operationState = op.effectDispatched ? 'outcome_unknown' : 'interrupted';
          if (!op.effectDispatched) for (const effect of receipt.effects) if (effect.state === 'running') {
            effect.state = 'needs_attention'; effect.reasonCodes = ['WORKER_INTERRUPTED']; effect.missingProof = ['Inspect retained local output; no physical effect was dispatched.'];
          }
          if (op.effectDispatched) {
            receipt.resultCertainty = 'uncertain'; receipt.reconciliation.status = 'required'; receipt.missingProof = ['The service stopped before device effects were reconciled.'];
            for (const effect of receipt.effects) if (effect.state === 'running') { effect.state = 'outcome_unknown'; effect.certainty = 'uncertain'; effect.missingProof = [...receipt.missingProof]; }
            const owner = this.devices.ownership(receipt.deviceId); this.devices.saveOwnership({ ...owner, state: 'blocked', mutationsPermitted: false, activeOperationIds: [op.operationId], reasonCodes: ['OUTCOME_UNCERTAIN'] });
          }
          assertContract('device-operation', receipt); result = { ...result, deviceOperation: receipt };
        }
      }
      store.update(op, { state: op.effectDispatched ? 'outcome_unknown' : 'interrupted', stage: 'reconciliation_required', result, error: {
        code: op.effectDispatched ? 'OUTCOME_UNCERTAIN' : 'WORKER_INTERRUPTED', message: 'The prior service stopped without a confirmed completion. Inspect the retained process and effect evidence before retrying.', retryable: false,
        nextActions: [{ id: 'inspect', label: 'Inspect retained operation', argv: ['contribution', 'runs', 'get', op.operationId, '--json'] }] } });
    }
  }
  settings(): Machine { return this.store.getMeta<Machine>('settings')!; }
  async refreshNotifications(): Promise<void> {
    if (this.notificationRefresh || this.stopping || this.store.getMeta('maintenance') || Date.now() < this.notificationRefreshAt) return;
    this.notificationRefresh = true; this.notificationRefreshAt = Date.now() + 30000;
    try {
      await Promise.all(this.repos.all().filter(repo => repo.availability === 'both-macs').map(async repo => {
        const authority = this.store.record<{ peerHostId: string }>('authority', repo.id); if (!authority) return;
        try {
          const response = await this.peers.call(authority.peerHostId, 'notifications.pending', { repositoryId: repo.id });
          const notices = response['notices'];
          requireValue(Array.isArray(notices) && notices.length <= 100 && notices.every(value => object(value)['repositoryId'] === repo.id && object(value)['originHostId'] === authority.peerHostId), 'PEER_PROTOCOL_ERROR', 'Notification scope did not match the paired host.');
          this.store.put('notificationInbox', repo.id, { observedAt: now(), notices });
        } catch { /* Cached attention stays separate from permission to dispatch a banner. */ }
      }));
    } finally { this.notificationRefresh = false; }
  }
  kick(): void {
    if (this.scheduled || this.stopping) return; this.scheduled = true;
    setImmediate(() => { this.scheduled = false; void this.schedule(); });
  }
  private async schedule(): Promise<void> {
    if (this.stopping || this.store.getMeta<boolean>('paused') || this.store.getMeta<boolean>('maintenance')) return;
    for (const op of this.store.queue()) {
      if (this.active.size >= 2 || this.activeRepositories.has(op.repositoryId) || this.adoptions.isBusy(op.repositoryId)) continue;
      const blocked = isGitJob(op.kind) && this.store.unsettled().some(other => other.repositoryId === op.repositoryId && isGitJob(other.kind) && other.operationId !== op.operationId && !other.result['remoteOperationId'] && ['outcome_unknown', 'needs_attention', 'waiting'].includes(other.state));
      if (blocked) continue;
      const controller = new AbortController(); this.active.set(op.operationId, controller); this.activeRepositories.add(op.repositoryId);
      void this.execute(op, controller.signal).finally(() => { this.active.delete(op.operationId); this.activeRepositories.delete(op.repositoryId); this.kick(); });
    }
  }
  private async execute(op: Operation, signal: AbortSignal): Promise<void> {
    let lease: Lease | LegacyPrimaryLease | undefined;
    try {
      // This schema-v1 payload understands these immutable requests; individual
      // handlers revalidate accepted policy/source before dispatching effects.
      this.store.update(op, { state: 'running', stage: 'starting', payload: this.payload.identity }, 'operation.started');
      let result: ObjectValue;
      if (op.kind === 'settings.apply') result = this.applySettings(op);
      else {
        const repo = await this.repos.get(op.repositoryId);
        if (isGitJob(op.kind) && !(op.kind === 'submit' && repo.config.integration.adapter !== 'generic-v1'))
          lease = op.kind === 'checks' || repo.config.integration.adapter === 'generic-v1' ? new Lease(repo.commonDir, op.attemptId) : new LegacyPrimaryLease(repo.commonDir, op.attemptId);
        if (['initialize', 'submit', 'push', 'seed'].includes(op.kind)) this.peers.assertWriter(repo);
        if (op.kind === 'initialize') result = await this.workflows.initialize(op, repo);
        else if (op.kind === 'submit') result = await this.workflows.landing(op, repo, signal);
        else if (op.kind === 'push') result = await this.workflows.push(op, repo, signal, lease!);
        else if (op.kind === 'device') result = await this.devices.execute(op, repo, signal);
        else if (op.kind === 'artifact_transfer') result = await this.artifacts.execute(op, signal);
        else if (op.kind === 'device_transfer') result = await this.deviceOwnership.execute(op, repo, signal);
        else if (op.kind === 'seed' || op.kind === 'mirror') result = await this.peers.applyHistory(op, repo);
        else if (op.kind === 'checks') {
          requireValue(op.input['policy'] === repo.revision, 'POLICY_CHANGED', 'Check policy changed after admission.');
          const source = string(op.input['sourcePath'], 'sourcePath');
          requireValue((await identity(source)).tip === op.input['sourceTip'] && await inputFingerprint(source) === op.input['fingerprint'], 'SOURCE_CHANGED', 'The selected source changed while this check was queued. Select the current source in a new request.');
          result = await this.workflows.checks(op, repo, source, signal);
        } else throw new Fault('OPERATION_UNSUPPORTED', 'This payload does not implement the retained operation.', 3);
      }
      const latest = this.store.get(op.operationId);
      this.store.update(latest, { state: 'succeeded', stage: 'completed', result: { ...latest.result, ...result, completedAt: now() }, error: null }, 'operation.succeeded',
        op.kind === 'settings.apply' ? () => this.store.setMeta('settings', op.input['config']) : undefined);
      if (op.kind === 'submit') {
        const repo = await this.repos.get(op.repositoryId);
        if (repo.availability === 'both-macs') {
          try { await this.peers.captureHistory(repo, 'mirror', crypto.randomUUID()); }
          catch (error) { this.store.put('mirrorPending', repo.id, { operationId: op.operationId, reason: error instanceof Fault ? error.code : 'MIRROR_CAPTURE_FAILED' }); }
        }
      }
    } catch (error) {
      const fault = error instanceof Fault ? error : new Fault('INTERNAL_ERROR', 'The worker stopped unexpectedly. Retained effect evidence needs inspection.', 5);
      const latest = this.store.get(op.operationId);
      const device = latest.result['deviceOperation'] as DeviceOperation | undefined;
      const uncertain = fault.exit === 6 || (latest.effectDispatched && (device ? device.resultCertainty !== 'confirmed' : !['PUSH_FAILED', 'GATE_FAILED'].includes(fault.code)));
      const state = uncertain ? 'outcome_unknown' : device?.operationState === 'failed' ? 'failed' : fault.exit === 130 ? 'cancelled' : fault.exit === 3 ? 'waiting' : 'failed';
      if (device) {
        device.operationState = state;
        if (uncertain) {
          device.resultCertainty = 'uncertain'; device.reconciliation.status = 'required';
          if (!device.missingProof.length) device.missingProof = ['Retained device effects require observation before any retry.'];
          for (const effect of device.effects) if (effect.state === 'running') { effect.state = 'outcome_unknown'; effect.certainty = 'uncertain'; effect.missingProof = [...device.missingProof]; }
          const owner = this.devices.ownership(device.deviceId);
          this.devices.saveOwnership({ ...owner, state: 'blocked', mutationsPermitted: false, activeOperationIds: [op.operationId], reasonCodes: ['OUTCOME_UNCERTAIN'] });
        }
        assertContract('device-operation', device);
      }
      this.store.log(latest, `\n${fault.code}: ${fault.message}\n`);
      this.store.update(latest, { state, stage: state === 'outcome_unknown' ? 'reconciliation_required' : 'stopped',
        result: { ...latest.result, ...fault.details, ...(device ? { deviceOperation: device } : {}), exitCode: uncertain ? 6 : fault.exit }, error: {
          code: uncertain ? 'OUTCOME_UNCERTAIN' : fault.code, message: fault.message, retryable: fault.retryable,
          nextActions: [{ id: 'repair', label: 'Read focused repair context', argv: ['contribution', 'repair-context', op.operationId, '--json'] }] } }, `operation.${state}`);
    } finally { lease?.release(); }
  }
  private admit(requestId: unknown, kind: string, repositoryId: string, input: ObjectValue): Response {
    const identity = string(requestId, 'requestId'), existing = this.store.existing(identity, kind, repositoryId, input);
    if (existing) return this.store.response(existing);
    const op = this.store.admit(identity, kind, repositoryId, input, this.payload.identity); this.kick(); return this.store.response(op);
  }
  private cancel(op: Operation): Response {
    if (op.kind === 'external_gate' && this.externalHooks.has(op.operationId)) throw new Fault('EXTERNAL_CLIENT_OWNS_GATE', 'Cancel this push in its original Git client. Contribution retains its lease until the gate confirms completion or needs reconciliation.', 3);
    if (terminal.has(op.state) && !(op.state === 'needs_attention' && op.result['transferAttempted'] && !op.effectDispatched)) return this.store.response(op);
    const controller = this.active.get(op.operationId);
    if (controller) { controller.abort(); return this.store.response(this.store.get(op.operationId)); }
    if (op.result['remoteOperationId'] || (['queued_local', 'needs_attention'].includes(op.state) && op.result['transferAttempted'])) return this.store.response(this.store.update(op, { state: 'queued_local', error: null, result: { ...op.result, cancelRequested: true, nextPeerAttempt: 0 } }));
    const receipt = op.result['deviceOperation'] as DeviceOperation | undefined;
    if (receipt) { receipt.operationState = 'cancelled'; receipt.completedAt = now(); for (const effect of receipt.effects) if (effect.state === 'queued') effect.state = 'cancelled'; assertContract('device-operation', receipt); }
    return this.store.response(this.store.update(op, { state: 'cancelled', stage: 'cancelled_before_dispatch', ...(receipt ? { result: { ...op.result, deviceOperation: receipt } } : {}) }));
  }
  private applySettings(op: Operation): ObjectValue {
    const config = op.input['config'] as unknown as Machine; assertContract('machine', config);
    const previous = this.settings(); requireValue(digest(previous) === op.input['expectedRevision'], 'REVISION_CONFLICT', 'Settings changed since they were read.');
    requireValue(config.hostId === previous.hostId && config.role === previous.role && config.primaryHostId === previous.primaryHostId && config.primarySshAlias === previous.primarySshAlias && digest(config.repositories) === digest(previous.repositories),
      'AUTHORITY_TRANSITION_REQUIRED', 'Host roles and repository authority require a reconciled transition; raw settings cannot grant ownership.');
    requireValue(!config.remoteDevices?.maintainSession, 'CAPABILITY_UNVERIFIED', 'Persistent session maintenance requires measured and approved device qualification.', 3);
    return { settings: config, revision: digest(config) };
  }
  async dispatch(value: unknown): Promise<Response> {
    // Track the complete asynchronous request, including operations outside the
    // scheduler (pairing, capture, observations and hooks), before any await.
    const command = (value as Request | null)?.command;
    const lifecycle = typeof command === 'string' && (command.startsWith('maintenance.') || ['service.restart', 'update.apply', 'service.status'].includes(command));
    if (!lifecycle) this.requests++;
    try {
      const response = await this.handle(value);
      // Even an early maintenance/version/usage refusal must not make the
      // native client forget a previously retained partial cleanup.
      const args = (value as Request | null)?.args;
      if (command === 'repos.create' && response.error && typeof args?.['requestId'] === 'string' && typeof args['path'] === 'string') {
        const requestId = args['requestId'], intent = this.store.record<{ requestedPath: string }>('creationIntent', requestId);
        if (intent?.requestedPath === resolve(args['path']) && !this.store.byRequest(requestId)) {
          response.result = { ...response.result, requestRetained: true, requestId, path: intent.requestedPath };
          response.error.nextActions = [{ id: 'resume-creation', label: 'Resolve the reported condition and resume this project creation', argv: ['contribution', 'repos', 'create', intent.requestedPath, '--request-id', requestId, '--json'] }];
        }
      }
      if (command === 'service.storage' && response.error && typeof args?.['requestId'] === 'string') {
        const worktrees = args['worktrees'] === true, requestId = args['requestId'];
        const retained = this.store.record<{ state: string; token?: string; preview?: { token: string } }>(worktrees ? 'worktreeCleanup' : 'storageCleanup', requestId);
        const token = retained?.token ?? retained?.preview?.token;
        if (retained?.state === 'removing' && token) {
          response.result = { ...response.result, requestRetained: true, requestId, scopeToken: token, worktrees };
          response.error.nextActions = [{ id: 'resume-cleanup', label: 'Resume the same reviewed cleanup after resolving the reported condition', argv: ['contribution', 'service', 'storage',
            ...(worktrees ? ['--worktrees'] : []), '--scope-token', token, '--request-id', requestId, '--json'] }];
        }
      }
      return response;
    } finally { if (!lifecycle) this.requests--; }
  }
  private async handle(value: unknown): Promise<Response> {
    try {
      const input = object(value); requireValue(input['schemaVersion'] === 1, 'SCHEMA_UNSUPPORTED', 'Only request schema version 1 is supported.', 2);
      requireValue(Object.keys(input).every(key => ['schemaVersion', 'command', 'args', 'cwd'].includes(key)), 'INVALID_REQUEST', 'Unexpected request fields.', 2);
      const command = string(input['command'], 'command'), args = object(input['args']), cwd = string(input['cwd'], 'cwd');
      const fields = allowed[command]; requireValue(fields, 'OPERATION_UNSUPPORTED', 'This command is not available in this payload.', 3);
      requireValue(Object.keys(args).every(key => fields.includes(key)), 'INVALID_USAGE', 'Unsupported argument combination.', 2);
      requireValue(!this.maintenance.busy || ['version', 'service.status', 'maintenance.status'].includes(command), 'MAINTENANCE_BUSY', 'The final update checkpoint is being saved. Wait for it to finish.', 4);
      requireValue(!this.stopping || ['version', 'service.status', 'maintenance.status'].includes(command), 'SERVICE_STOPPING', 'The service is stopping. Reconnect after the maintenance window is reconciled.', 3);
      if (this.store.getMeta('maintenance') && !command.startsWith('maintenance.')) {
        const reads = ['version', 'doctor', 'service.status', 'repos.list', 'repos.inspect', 'runs.list', 'runs.get', 'runs.events', 'logs', 'repair-context', 'settings.get', 'hosts.list', 'devices.profile', 'devices.artifacts.list', 'devices.artifacts.get'];
        // An existing managed Git child must finish its gate so the active job
        // can drain. A new external push cannot start inside this window.
        requireValue(reads.includes(command) || (['hook.pre-push', 'hook.borrow', 'hook.release-borrow', 'hook.adopted.begin', 'hook.adopted.finish'].includes(command) && typeof args['operationId'] === 'string' && this.active.has(args['operationId'])),
          'SERVICE_MAINTENANCE', 'An update maintenance window is held. Existing work is draining and queued work remains retained.', 3);
      }
      if (command === 'maintenance.begin') return completed({ window: this.maintenance.begin(string(args['requestId'], 'requestId')) });
      if (command === 'maintenance.status') {
        const blockers = this.maintenance.blockers(this.active.size, this.notificationRefresh || this.github.busy || this.peers.busy || this.maintenance.busy, this.requests);
        return completed({ window: this.maintenance.current() ?? null, ready: this.maintenance.isReady(blockers), blockers, payload: this.payload.identity });
      }
      if (command === 'maintenance.stop') {
        const blockers = this.maintenance.blockers(this.active.size, this.notificationRefresh || this.github.busy || this.peers.busy, this.requests);
        const window = await this.maintenance.stop(string(args['windowId'], 'windowId'), blockers);
        this.stopping = true; return completed({ window, state: 'stop_requested', helperStopped: false });
      }
      if (command === 'maintenance.resume') {
        requireValue(['cancelled', 'activated'].includes(String(args['outcome'])), 'INVALID_MAINTENANCE_OUTCOME', 'Select cancelled or activated.', 2);
        const result = this.maintenance.resume(string(args['windowId'], 'windowId'), string(args['observedPayload'], 'observedPayload'), args['outcome'] as 'cancelled' | 'activated');
        this.kick(); return completed(result);
      }
      if (command === 'version') return completed({ ...buildIdentity, interfaceVersion: buildIdentity.version, engineVersion: buildIdentity.version, supportedSchemaVersions: [1], compatibility: 'compatible', payload: this.payload.identity, manifestDigest: this.payload.manifestDigest ?? null, distribution: this.payload.distribution, service: 'running' });
      if (command === 'service.status') return completed({ state: this.stopping ? 'stopping' : 'running', paused: this.store.getMeta('paused') ?? false,
        maintenance: this.store.getMeta('maintenance') ?? false, maintenanceWindow: this.maintenance.current() ?? null,
        active: this.active.size, queued: this.store.queue().length, hostId: this.store.hostId, remoteDevicesEnabled: this.settings().remoteDevices?.enabled ?? false, payload: this.payload.identity, processId: process.pid });
      if (command === 'service.storage') {
        requireValue(args['worktrees'] === undefined || args['worktrees'] === true, 'INVALID_USAGE', 'Use --worktrees to select owned checkout cleanup.', 2);
        const storage = args['worktrees'] === true ? new OwnedWorktrees(this.store) : new StorageRetention(this.store);
        if (args['preview'] === true) {
          requireValue(args['scopeToken'] === undefined && args['requestId'] === undefined, 'INVALID_USAGE', 'Preview and cleanup are separate requests.', 2);
          return completed(await storage.preview());
        }
        requireValue(args['preview'] === undefined, 'INVALID_USAGE', 'Use --preview or select its scope token and a request UUID.', 2);
        return completed(await storage.apply(string(args['scopeToken'], 'scopeToken'), string(args['requestId'], 'requestId')));
      }
      if (command === 'doctor') return completed({ hostId: this.store.hostId, service: 'running', payloadVerified: true, distribution: this.payload.distribution,
        database: { version: 1, journalMode: 'wal', synchronous: 'full' }, storage: this.store.retention(), repositories: this.repos.all().map(repo => ({ repositoryId: repo.id, pathExists: existsSync(repo.path), adapter: repo.config.integration.adapter })),
        devices: { enabled: this.settings().remoteDevices?.enabled ?? false, physicalQualification: 'unverified' } });
      if (command === 'service.pause' || command === 'service.resume') {
        this.store.setMeta('paused', command === 'service.pause'); this.kick(); return completed({ paused: command === 'service.pause' });
      }
      if (command === 'service.restart' || command === 'update.apply') {
        requireValue(args['whenIdle'] === true, 'IDLE_WINDOW_REQUIRED', 'Use --when-idle for lifecycle changes.', 2);
        requireValue(this.active.size === 0 && !this.backgroundBusy, 'SERVICE_BUSY', 'Active work, observations and peer transfers must drain before restart or update.', 4);
        requireValue(!this.store.unsettled().some(op => op.state === 'outcome_unknown'), 'RECONCILIATION_REQUIRED', 'Resolve uncertain effects before lifecycle changes.');
        if (command === 'update.apply') throw new Fault('SIGNED_UPDATE_REQUIRED', 'No verified signed update is staged. Use the native updater once release signing is configured.', 3);
        requireValue(typeof process.execve === 'function', 'RESTART_UNAVAILABLE', 'This runtime cannot replace the service process safely.', 3);
        this.store.setMeta('maintenance', true); this.restartRequested = true; this.stopping = true; return completed({ state: 'restart_ready', queuedPreserved: this.store.queue().length });
      }
      if (command === 'update.check') return completed({ status: 'not_configured', reason: 'SIGNED_FEED_REQUIRED', automaticInstallation: false });
      if (command === 'hosts.list') return completed({ hosts: [{ hostId: this.store.hostId, label: this.settings().label, role: this.settings().role, readiness: 'available' }, ...this.peers.list().map(peer => ({ ...peer, registry: this.store.record('peerRegistrySync', peer.hostId) ?? null }))] });
      if (command === 'hosts.pair') return completed(await this.peers.pair(string(args['sshAlias'], 'sshAlias')));
      if (command === 'hosts.sync') {
        const hostId = string(args['host'], 'host'); requireValue(this.peers.list().some(peer => peer.hostId === hostId && peer.alias), 'PEER_ROUTE_REQUIRED', 'Select a paired host with a verified SSH route.', 3);
        await this.peers.syncRegistry(hostId, true); return completed({ hostId, registry: this.store.record('peerRegistrySync', hostId), peerProjects: this.peers.registry.view() });
      }
      if (command === 'peer.exchange') { const result = await this.peers.receive(object(args['envelope'])); this.kick(); return completed(result); }
      if (command.startsWith('devices.') && !['devices.artifacts.transfer', 'devices.reconcile', 'devices.transfer-host'].includes(command) && !remoteDeviceCommands.has(command) && !remoteDeviceReads.has(command)) requireValue(args['host'] === undefined || args['host'] === this.store.hostId, 'EXECUTION_HOST_ROUTE_REQUIRED', 'Invoke this configuration or authorization command on the selected host service.', 3);
      if (command === 'devices.list' && !args['repo']) {
        requireValue(!args['host'] || args['host'] === this.store.hostId, 'REPOSITORY_SCOPE_REQUIRED', 'Remote inventory requires an associated repository scope.', 3);
        return completed({ executionHostId: this.store.hostId, devices: await this.devices.backend.inventory(), discoveryGrantsAuthority: false });
      }
      if (command === 'devices.reconcile') {
        const op = this.store.get(string(args['operationId'], 'operationId'));
        if (op.kind === 'device_transfer') {
          requireValue(args['host'] === undefined || args['host'] === this.store.hostId, 'DEVICE_IDENTITY_MISMATCH', 'Reconcile ownership through the service that retained this transfer.', 2);
          if (['waiting', 'interrupted', 'outcome_unknown'].includes(op.state)) this.store.update(op, { state: 'queued', stage: 'reconciling_retained_ownership', error: null });
          this.kick(); return this.store.response(this.store.get(op.operationId));
        }
        if (op.kind === 'remote.device') {
          requireValue(args['host'] === undefined || args['host'] === op.input['destinationHostId'], 'DEVICE_IDENTITY_MISMATCH', 'Reconcile this operation on its original selected host.', 2);
          requireValue(op.result['remoteOperationId'], 'EXECUTION_ACCEPTANCE_UNCONFIRMED', 'The remote acceptance reply is unresolved; retain the outbox and query its original request.', 3);
          await this.peers.observeOperation(op, true); return this.store.response(this.store.get(op.operationId));
        }
        requireValue(op.kind === 'device' && (args['host'] === undefined || args['host'] === this.store.hostId), 'NOT_A_DEVICE_OPERATION', 'Select a retained device operation on this host.', 2);
        await this.devices.reconcile(op); return this.store.response(this.store.get(op.operationId));
      }
      if (command === 'settings.get') return completed({ settings: this.settings(), revision: digest(this.settings()) });
      if (command === 'notifications.pending') {
        const milestones = new Milestones(this.store); milestones.synchronize(this.repos.all()); void this.refreshNotifications();
        const remote = this.store.records<{ observedAt: string; notices: Notice[] }>('notificationInbox').filter(entry => Date.parse(entry.observedAt) > Date.now() - 120000).flatMap(entry => entry.notices);
        return completed({ notices: [...milestones.pending(this.store.hostId), ...remote].slice(0, 100) });
      }
      if (command === 'settings.apply') { assertContract('machine', args['config']); return this.admit(args['requestId'], command, this.store.hostId, { config: args['config'], expectedRevision: string(args['expectedRevision'], 'expectedRevision') }); }
      if (command === 'repos.list') return completed({ repositories: this.repos.all(), peerProjects: this.peers.registry.view(), pendingRemovals: new RepositoryRemoval(this.store, this.repos).pending() });
      if (command === 'repos.resolve') {
        const repositoryId = string(args['repo'], 'repo'), expectedRevision = string(args['expectedRevision'], 'expectedRevision');
        this.peers.registry.offer(string(args['host'], 'host'), repositoryId, expectedRevision);
        const repository = await this.repos.add(string(args['path'], 'path'), undefined, undefined, undefined, { repositoryId, revision: expectedRevision });
        return completed({ repository, authorityChanged: false, setupPerformed: false, peerProjects: this.peers.registry.view() });
      }
      if (command === 'repos.discover') return completed({ repositories: await discover(string(args['root'], 'root')), limits: { maxDepth: 3, maxDirectories: 250 } });
      if (command === 'repos.add') {
        requireValue(args['profile'] === undefined || ['local-development', 'standard'].includes(String(args['profile'])), 'INVALID_PROFILE', 'Unknown profile.', 2);
        requireValue(args['availability'] === undefined || ['this-mac', 'both-macs'].includes(String(args['availability'])), 'INVALID_AVAILABILITY', 'Unknown availability.', 2);
        return completed({ repository: await this.repos.add(string(args['path'], 'path'), args['profile'] as 'local-development' | 'standard' | undefined, args['availability'] as 'this-mac' | 'both-macs' | undefined, args['config'] as Repository | undefined) });
      }
      if (command === 'repos.create') {
        const requestId = string(args['requestId'], 'requestId');
        const repo = await this.repos.create(string(args['path'], 'path'), requestId); return this.admit(requestId, 'initialize', repo.id, { policy: repo.revision });
      }
      if (command === 'runs.list') return completed({ operations: this.store.list().filter(op => !args['repo'] || op.repositoryId === args['repo']) });
      if (command === 'runs.events') return completed({ events: this.store.events(Math.max(0, Number(args['after'] ?? 0)), typeof args['operationId'] === 'string' ? args['operationId'] : undefined) });
      if (['runs.get', 'runs.cancel', 'runs.pin', 'runs.unpin', 'runs.reconcile', 'logs', 'repair-context'].includes(command)) {
        let op = this.store.get(string(args['operationId'], 'operationId'));
        if (command === 'runs.reconcile') {
          if (['artifact_transfer', 'device_transfer'].includes(op.kind) && ['waiting', 'interrupted', 'outcome_unknown'].includes(op.state)) this.store.update(op, { state: 'queued', stage: 'resuming_retained_transfer', error: null });
          else if (op.kind === 'submit' && ['waiting', 'interrupted'].includes(op.state) && !op.effectDispatched && (await this.repos.get(op.repositoryId)).config.integration.adapter !== 'generic-v1') {
            const processes = op.result['processes'] as { pid: number; start: string | null }[] | undefined;
            requireValue(!this.active.has(op.operationId) && !processes?.some(proc => alive(proc.pid) && (!proc.start || !processIdentity(proc.pid) || processIdentity(proc.pid) === proc.start)),
              'WORKER_STILL_ACTIVE', 'The retained worker must stop before resuming its original selection.', 3);
            this.store.update(op, { state: 'queued', stage: 'rechecking_original_source', error: null });
          }
          else if (op.result['remoteOperationId']) await this.peers.observeOperation(op, true);
          else await this.recoverObservedEffects(op.operationId);
          this.kick(); op = this.store.get(op.operationId);
        }
        if (command === 'logs') {
          const cached = op.result['remoteOperationId'] ? this.store.record<ObjectValue>('remoteLog', op.operationId) : undefined;
          return completed({ operationId: op.operationId, attemptId: op.attemptId, ...(cached ?? {}), text: cached ? String(cached['text']).split('\n').slice(-Math.max(1, Math.min(2000, Number(args['tail'] ?? 200)))).join('\n') : this.store.logs(op, Number(args['tail'] ?? 200)), ...(op.result['remoteOperationId'] ? { freshness: 'cached' } : {}) });
        }
        if (command === 'repair-context') return completed({ operation: op, log: this.store.logs(op, 100), boundaries: ['Repair only the recorded failure.', 'Preserve unrelated work.', 'Publication needs a new explicit preview when scope changes.'] });
        if (command === 'runs.pin' || command === 'runs.unpin') return this.store.response(this.store.update(op, { pinned: command === 'runs.pin' }));
        if (command === 'runs.cancel') {
          return this.cancel(op);
        }
        return this.store.response(op);
      }
      const selector = typeof args['repo'] === 'string' ? args['repo'] : cwd;
      if (command === 'repos.remove' && !this.repos.all().some(row => row.id === selector || row.path === selector)) {
        const retained = new RepositoryRemoval(this.store, this.repos).completed(selector);
        if (retained) return completed(retained);
      }
      const repo = await this.repos.get(selector);
      if (!['repos.remove', 'repos.inspect', 'status'].includes(command)) this.store.assertRepositoryAvailable(repo.id);
      requireValue(!this.adoptions.isBusy(repo.id) || ['repos.inspect', 'status', 'repos.migration'].includes(command), 'REPOSITORY_BUSY', 'The reviewed adoption transaction is holding this repository.', 4);
      if (command === 'hook.adopted.begin' || command === 'hook.adopted.finish') {
        if (command === 'hook.adopted.finish') {
          const retained = this.workflows.adopted.retainedCompletion(repo, args); if (retained) return completed(retained);
        }
        this.peers.assertWriter(repo);
        if (command === 'hook.adopted.begin' && !args['operationId']) return completed(await this.beginExternalAdoptedHook(repo, args));
        requireValue(typeof args['operationId'] === 'string' && this.active.has(args['operationId']), 'HOOK_LEASE_INVALID', 'No live publication owns this adopted hook.', 3);
        const result = command === 'hook.adopted.begin' ? await this.workflows.adopted.begin(repo, args) : await this.workflows.adopted.finish(repo, args);
        if (command === 'hook.adopted.finish' && this.externalHooks.has(args['operationId'])) {
          const op = this.store.get(args['operationId']), passed = ['passed', 'inactive', 'not_run'].includes(String(result['state']));
          this.store.update(op, { state: passed ? 'succeeded' : 'failed', stage: 'gate_observed', result: { ...op.result, gate: result, delivery: 'unobserved', observation: 'pre_push_hook_only', exitCode: result['exitCode'] },
            error: passed ? null : { code: String(result['code'] ?? 'GATE_FAILED'), message: 'The original gate refused publication. Git delivery is not observed by this hook.', retryable: false, nextActions: [] } });
          this.finishExternalHook(op, true);
        }
        return completed(result);
      }
      if (command === 'hook.borrow' || command === 'hook.release-borrow') {
        this.peers.assertWriter(repo);
        const bridge = new LegacyHookBorrow(this.store);
        return completed(command === 'hook.borrow' ? bridge.borrow(repo, args) : bridge.release(repo, args));
      }
      if (remoteDeviceCommands.has(command) || remoteDeviceReads.has(command)) {
        const hostId = command === 'devices.artifacts.transfer' ? args['fromHost'] : args['host'];
        if (typeof hostId === 'string' && hostId !== this.store.hostId) {
          const authority = this.store.record<{ phase: string; peerHostId: string }>('authority', repo.id);
          requireValue(repo.availability === 'both-macs' && authority?.phase === 'active' && authority.peerHostId === hostId, 'REPOSITORY_PEER_UNAUTHORIZED', 'The selected execution host must be paired for this repository.', 3);
          const remoteArgs = { ...args, repo: repo.id };
          if (remoteDeviceReads.has(command)) {
            const reply = await this.peers.call(hostId, 'device.observe', { repositoryId: repo.id, command, args: remoteArgs });
            const observation = reply['response'] as Response;
            if (command === 'devices.profile' && !observation.error && typeof observation.result?.['policyRevision'] === 'string')
              this.store.put('remoteDeviceProfile', `${hostId}:${repo.id}`, { revision: observation.result['policyRevision'], observedAt: now() });
            return reply['response'] as Response;
          }
          const requestId = string(args['requestId'], 'requestId'), input = { command, args: remoteArgs, destinationHostId: hostId };
          const existing = this.store.existing(requestId, 'remote.device', repo.id, input); if (existing) return this.store.response(existing);
          const profileKey = `${hostId}:${repo.id}`;
          try {
            const reply = await this.peers.call(hostId, 'device.observe', { repositoryId: repo.id, command: 'devices.profile', args: { repo: repo.id, host: hostId } });
            const observation = reply['response'] as Response;
            requireValue(!observation.error && typeof observation.result?.['policyRevision'] === 'string', 'DEVICE_ADAPTER_UNCONFIGURED', 'The selected host needs its project device profile before remote admission.', 3);
            this.store.put('remoteDeviceProfile', profileKey, { revision: observation.result['policyRevision'], observedAt: now() });
          } catch (error) {
            if (!(error instanceof Fault) || !['PEER_UNAVAILABLE', 'SERVICE_UNAVAILABLE', 'SERVICE_TIMEOUT', 'SERVICE_CONNECTION_LOST'].includes(error.code)) throw error;
          }
          const profile = this.store.record<{ revision: string }>('remoteDeviceProfile', profileKey);
          requireValue(profile, 'DEVICE_PROFILE_OBSERVATION_REQUIRED', 'Observe the selected host’s device profile once before queueing offline work.', 3);
          const op = this.store.admit(requestId, 'remote.device', repo.id, input, this.payload.identity, 'queued_local', operation => ({ remotePolicyRevision: profile.revision,
            acceptance: { localDurable: true, executionHostAccepted: false, executionHostId: hostId, acceptedAt: operation.createdAt }, executionHostId: hostId }));
          void this.peers.tick(); return this.store.response(op);
        }
      }
      if (command === 'repos.runtime') return completed({ runtime: await new ProjectRuntimes(this.store).register(repo, string(args['node'], 'node'), string(args['pnpm'], 'pnpm')) });
      if (command === 'repos.migration') {
        requireValue(['prepareReporting', 'prepareAdoption', 'prepareExistingAdoption', 'applyAdoption', 'activateAdoption', 'rollbackAdoption', 'adoptionPlan'].filter(key => args[key]).length <= 1, 'INVALID_USAGE', 'Choose one migration action.', 2);
        requireValue(args['prepareExistingAdoption'] || (!args['originalTip'] && !args['migrationTip']), 'INVALID_USAGE', 'History selectors require an existing-adoption review.', 2);
        if (args['prepareExistingAdoption']) return completed(await this.adoptions.prepareExisting(repo, string(args['originalTip'], 'originalTip'), string(args['migrationTip'], 'migrationTip'), string(args['requestId'], 'requestId')));
        if (args['adoptionPlan']) return completed(this.adoptions.inspect(repo, string(args['adoptionPlan'], 'proposal')));
        for (const [key, action] of [['applyAdoption', 'apply'], ['activateAdoption', 'activate'], ['rollbackAdoption', 'rollback']] as const) if (args[key]) return completed(await this.adoptions.change(repo, string(args[key], 'proposal'), action, string(args['expectedRevision'], 'expectedRevision'), string(args['requestId'], 'requestId')));
        const adapter = typeof args['adapter'] === 'string' ? args['adapter'] : identifyAdoption(repo.path)?.id;
        requireValue(adapter, 'ADAPTER_UNKNOWN', 'Select an installed repository adapter for parity inspection.', 3);
        if (args['prepareAdoption']) return completed(await this.adoptions.prepare(repo, adapter, string(args['requestId'], 'requestId')));
        const inventory = policyInventory(repo.path, adapter);
        if (args['prepareReporting']) {
          requireValue(adapter === repo.config.validation.adapter || repo.config.validation.adapter === 'migration-required', 'ADAPTER_SELECTION_MISMATCH', 'The reporting proposal must match the enrolled validation owner or its pending adoption.', 2);
          return completed({ inventory, proposal: await new LegacyReporting(this.store).proposal(repo, string(args['requestId'], 'requestId'), adapter) });
        }
        return completed({ inventory, sourceTip: (await identity(repo.path)).tip, branch: repo.config.integration.branch, hookOwner: repo.hookPath,
          mutation: 'none', cutover: 'pending_parity_and_compatible_writer_adoption' });
      }
      if (command === 'devices.configure') return completed(this.devices.builds.configure(repo, args['config'], string(args['expectedRevision'], 'expectedRevision'), string(args['requestId'], 'requestId')));
      if (command === 'devices.evidence.record') return completed(this.devices.recordEvidence(repo, args['config'], string(args['requestId'], 'requestId')));
      if (command === 'devices.evidence.get') return completed(this.devices.inspectEvidence(repo, string(args['evidence'], 'evidence')));
      if (command === 'devices.evidence.review') return completed(this.devices.reviewEvidence(repo, string(args['evidence'], 'evidence'), string(args['expectedRevision'], 'expectedRevision'), string(args['requestId'], 'requestId')));
      if (command === 'devices.transfer-host') {
        const op = this.deviceOwnership.admit(repo, args, this.payload.identity); this.kick(); return this.store.response(op);
      }
      if (command === 'devices.profile') return completed({ ...this.devices.builds.inspect(repo), policyRevision: this.store.record<{ revision: string }>('deviceProfile', repo.id)?.revision ?? null });
      if (command === 'devices.artifacts.list' || command === 'devices.artifacts.get') return completed(this.devices.builds.artifacts(repo, command === 'devices.artifacts.get' ? string(args['artifact'], 'artifact') : undefined));
      if (command === 'devices.artifacts.transfer') {
        requireValue(args['fromHost'] === undefined || args['fromHost'] === this.store.hostId, 'EXECUTION_HOST_ROUTE_REQUIRED', 'Invoke artifact transfer on the selected build/source host service.', 3);
        requireValue(!args['toHost'] || !args['host'] || args['toHost'] === args['host'], 'INVALID_USAGE', 'Destination host selections disagree.', 2);
        const op = this.artifacts.admit(repo, string(args['artifact'], 'artifact'), string(args['toHost'] ?? args['host'], 'destination host'), string(args['requestId'], 'requestId'), this.payload.identity);
        this.kick(); return this.store.response(op);
      }
      if (command === 'devices.status') return this.devices.status(repo, string(args['device'], 'device'), args['refresh'] === true);
      if (command === 'devices.list') return completed({ executionHostId: this.store.hostId, devices: await this.devices.backend.inventory(), discoveryGrantsAuthority: false });
      if (command === 'devices.apps') return completed(this.devices.installedApps(repo, string(args['device'], 'device')));
      if (command === 'devices.authorize' || command === 'devices.revoke') {
        requireValue(Array.isArray(args['operations']) && args['operations'].every(value => typeof value === 'string'), 'INVALID_DEVICE_SCOPE', 'Supply named operations.', 2);
        return completed(this.devices.authorize(repo, string(args['device'], 'device'), args['operations'] as string[], command === 'devices.revoke', string(args['requestId'], 'requestId')));
      }
      if (command.startsWith('devices.')) {
        let action = command.slice('devices.'.length);
        const deviceArgs = { ...args };
        if (action === 'install' && args['launch']) action = 'install_and_launch';
        if (action === 'capture') { requireValue(['screenshot', 'screen'].includes(String(args['kind'])), 'INVALID_CAPTURE_KIND', 'Select screenshot or screen.', 2); action = args['kind'] === 'screen' ? 'screen_capture' : 'screenshot'; }
        if (action === 'qualify') {
          const planId = string(args['plan'], 'plan'), plan = this.devices.profile(repo).plans[planId]; requireValue(plan, 'QUALIFICATION_PLAN_UNCONFIGURED', 'Select an installed project qualification plan.', 3);
          action = plan.operation; deviceArgs['qualificationPlan'] = planId;
        }
        const op = await this.devices.admit(repo, action as DeviceOperation['intent']['operation'], deviceArgs); this.kick(); return this.store.response(op);
      }
      if (command.startsWith('notifications.')) {
        const origin = string(args['originHostId'], 'originHostId');
        return completed(origin === this.store.hostId ? new Milestones(this.store).dispatch(command, this.store.hostId, repo, args) :
          await this.peers.call(origin, command, { ...args, repositoryId: repo.id }));
      }
      if (command === 'github.jobs') return completed(await this.github.jobs(repo, Number(args['runId']), Number(args['attempt'])));
      if (command === 'github.logs') return completed(await this.github.logs(repo, Number(args['runId']), Number(args['attempt']), Number(args['jobId'])));
      if (command === 'repos.pair') return completed(await this.peers.bind(repo, string(args['host'], 'host'), string(args['requestId'], 'requestId')));
      if (command === 'repos.seed' || command === 'repos.mirror') return this.store.response(await this.peers.captureHistory(repo, command === 'repos.seed' ? 'seed' : 'mirror', string(args['requestId'], 'requestId')));
      if (command === 'repos.inspect') return completed({ repository: repo.config, revision: repo.revision, path: repo.path, commonDirectory: repo.commonDir, availability: repo.availability, canonicalHostId: repo.canonicalHostId });
      if (command === 'repos.relocate') return completed({ repository: await this.repos.relocate(repo, string(args['path'], 'path')) });
      if (command === 'repos.remove') {
        return completed(await new RepositoryRemoval(this.store, this.repos).remove(repo));
      }
      if (command === 'repos.configure') {
        const requestId = string(args['requestId'], 'requestId'), config = args['config'] as unknown as Repository;
        const requestDigest = digest({ repo: repo.id, config, expectedRevision: args['expectedRevision'] });
        const prior = this.store.record<{ digest: string; result: ObjectValue }>('configurationRequests', requestId);
        if (prior) { requireValue(prior.digest === requestDigest, 'REQUEST_ID_CONFLICT', 'Configuration request ID was reused with different inputs.'); return completed(prior.result); }
        const result = { repository: this.repos.configure(repo, config, string(args['expectedRevision'], 'expectedRevision'), requestId) };
        this.store.put('configurationRequests', requestId, { digest: requestDigest, result }); return completed(result);
      }
      if (command === 'repos.initialize') {
        requireValue(args['expectedRevision'] === undefined || args['expectedRevision'] === repo.revision, 'REVISION_CONFLICT', 'Repository configuration changed since initialization was reviewed. Review the current configuration first.', 3);
        return this.admit(args['requestId'], 'initialize', repo.id, { policy: repo.revision });
      }
      if (command === 'status') {
        if (repo.canonicalHostId !== this.store.hostId) {
          if (args['refresh'] === true) {
            try {
              const observed = await this.peers.call(repo.canonicalHostId, 'repository.status', { repositoryId: repo.id });
              const response = observed['response'] as Response;
              if (response.error) return response;
              this.store.put('canonicalStatus', repo.id, { ...response.result, canonicalObservedAt: now() });
              return completed({ ...response.result, canonicalObservedAt: now(), ownerFreshness: 'fresh', localMirrorTip: (await identity(repo.path)).tip });
            } catch (error) {
              return completed({ canonicalHostId: repo.canonicalHostId, canonicalTip: null, ownerFreshness: 'unavailable', lastKnown: this.store.record('canonicalStatus', repo.id) ?? null,
                reason: error instanceof Fault ? error.code : 'PEER_UNAVAILABLE', localMirrorTip: (await identity(repo.path)).tip });
            }
          }
          return completed({ canonicalHostId: repo.canonicalHostId, canonicalTip: null, ownerFreshness: 'stale', lastKnown: this.store.record('canonicalStatus', repo.id) ?? null, localMirrorTip: (await identity(repo.path)).tip });
        }
        const github = args['refresh'] === true ? await this.github.refresh(repo) : await this.github.cached(repo);
        return completed({ ...await this.repos.status(repo, args['refresh'] === true), github });
      }
      if (command === 'push') {
        if (repo.canonicalHostId !== this.store.hostId) {
          if (args['preview'] === true) {
            const result = await this.peers.call(repo.canonicalHostId, 'publication.preview', { repositoryId: repo.id });
            return result['response'] as Response;
          }
          const requestId = string(args['requestId'], 'requestId'), input = { expectedTip: string(args['expectedTip'], 'expectedTip'), scopeToken: string(args['scopeToken'], 'scopeToken'), destinationHostId: repo.canonicalHostId };
          return this.store.response(this.store.admit(requestId, 'remote.push', repo.id, input, this.payload.identity, 'queued_local'));
        }
        if (args['preview'] === true) return completed(await this.workflows.preview(repo));
        const requestId = string(args['requestId'], 'requestId');
        const input = await this.workflows.pushInput(repo, string(args['expectedTip'], 'expectedTip'), string(args['scopeToken'], 'scopeToken'), requestId);
        return this.admit(requestId, 'push', repo.id, input);
      }
      if (command === 'submit') { assertContract('submission-metadata', args['metadata'] ?? { schemaVersion: 1 });
        const op = await this.workflows.capture(repo, string(args['requestId'], 'requestId'), string(args['sourcePath'], 'sourcePath'), string(args['sourceTip'], 'sourceTip'), string(args['base'], 'base'), object(args['metadata'] ?? { schemaVersion: 1 }));
        this.kick(); return this.store.response(op);
      }
      if (command === 'checks.run') {
        requireValue(!(args['sourcePath'] && args['canonical']), 'SOURCE_SELECTION_CONFLICT', 'Choose a local source or the canonical checkout.', 2);
        if (args['canonical'] && repo.canonicalHostId !== this.store.hostId) {
          const requestId = string(args['requestId'], 'requestId'), input = { destinationHostId: repo.canonicalHostId, checkId: args['checkId'] ?? null, fresh: args['fresh'] === true };
          const previous = this.store.existing(requestId, 'remote.checks', repo.id, input); if (previous) return this.store.response(previous);
          // Canonical source selection is frozen by the owner at admission. An
          // unavailable owner cannot silently substitute the local mirror.
          const receipt = await this.peers.call(repo.canonicalHostId, 'checks.start', { repositoryId: repo.id, requestId, ...input });
          const response = receipt['response'] as Response; assertContract('response', response);
          if (response.error) return response;
          requireValue(response.operationId, 'PEER_PROTOCOL_ERROR', 'The canonical owner did not retain a check identity.', 3);
          const op = this.store.admit(requestId, 'remote.checks', repo.id, input, this.payload.identity, 'queued_local', () => ({ remoteOperationId: response.operationId, canonicalHostAccepted: true, canonicalHostId: repo.canonicalHostId, canonicalObservation: response }));
          return this.store.response(op);
        }
        const sourcePath = args['canonical'] ? repo.path : typeof args['sourcePath'] === 'string' ? args['sourcePath'] : cwd;
        const selection = { sourcePath, checkId: args['checkId'] ?? null, fresh: args['fresh'] === true };
        const requestId = string(args['requestId'], 'requestId');
        const previous = this.store.db.prepare('SELECT body FROM operations WHERE request_id=?').get(requestId);
        if (previous) {
          const op = JSON.parse(String(previous['body'])) as Operation;
          requireValue(op.kind === 'checks' && op.repositoryId === repo.id && digest(op.input['selection']) === digest(selection), 'REQUEST_ID_CONFLICT', 'This request ID already identifies a different check.');
          return this.store.response(op);
        }
        const source = await identity(sourcePath);
        requireValue(source.commonDir === repo.commonDir, 'SOURCE_OWNERSHIP_REQUIRED', 'Source belongs to a different repository.');
        requireValue(source.tip, 'UNBORN_REPOSITORY', 'Initialize history before checking a committed source.', 3);
        const adoptedCheck = repo.config.validation.adapter === 'generic-v1' ? {} : { adoptedCheck: await this.workflows.adoptedChecks.select(repo, sourcePath, selection.checkId, selection.fresh) };
        return this.admit(requestId, 'checks', repo.id, { ...selection, selection, sourceTip: source.tip, fingerprint: await inputFingerprint(sourcePath), policy: repo.revision, ...adoptedCheck });
      }
      if (command === 'hook.pre-push') {
        this.peers.assertWriter(repo);
        if (!args['operationId']) {
          const op = this.store.admit(crypto.randomUUID(), 'external_gate', repo.id, args, this.payload.identity, 'running');
          const controller = new AbortController(); let lease: Lease | undefined;
          try {
            lease = new Lease(repo.commonDir, op.attemptId); this.active.set(op.operationId, controller); this.activeRepositories.add(repo.id);
            const result = await this.workflows.externalHook(repo, args, op, controller.signal);
            return this.store.response(this.store.update(this.store.get(op.operationId), { state: 'succeeded', stage: 'gate_completed', result }));
          } catch (error) {
            const failure = rejected(error);
            return this.store.response(this.store.update(this.store.get(op.operationId), { state: 'failed', stage: 'gate_failed', error: failure.error, result: { ...failure.result, delivery: 'unobserved' } }));
          } finally {
            lease?.release(); this.active.delete(op.operationId); if (lease) this.activeRepositories.delete(repo.id); this.kick();
          }
        }
        const controller = this.active.get(string(args['operationId'], 'operationId'));
        requireValue(controller, 'HOOK_LEASE_INVALID', 'No active managed invocation owns this hook. External hook reporting requires the adopted dispatcher.', 4);
        return completed(await this.workflows.hook(repo, args, controller.signal));
      }
      if (command === 'codex.open') {
        // Installed CLI help documents `codex app PATH`, but also says it may
        // open an installer when the desktop app is missing. Do not invent a
        // deep link or trigger installation without a qualified platform route.
        const operationId = args['operationId'] ? string(args['operationId'], 'operationId') : null;
        if (operationId) requireValue(this.store.get(operationId).repositoryId === repo.id, 'OPERATION_REPOSITORY_MISMATCH', 'Select an operation belonging to this repository.', 2);
        return completed({ state: 'manual_action_required', reason: 'DOCUMENTED_OPEN_ROUTE_UNVERIFIED', localPath: repo.path,
          projectRegistration: 'manual', nextStep: 'Use Add Project in Codex and select this exact local folder.',
          suggestedPrompt: operationId ? `Inspect Contribution operation ${operationId} using repair-context. Preserve unrelated work and existing publication authority.` : null,
          promptSubmitted: false });
      }
      throw new Fault('OPERATION_UNSUPPORTED', 'This command is not implemented.', 3);
    } catch (error) { return rejected(error); }
  }
  private finishExternalHook(op: Operation, release: boolean): void {
    const held = this.externalHooks.get(op.operationId); if (!held) return;
    clearInterval(held.timer); if (release) held.lease.release();
    this.externalHooks.delete(op.operationId); this.active.delete(op.operationId); this.activeRepositories.delete(op.repositoryId); this.kick();
  }
  private async beginExternalAdoptedHook(repo: Enrolled, args: ObjectValue): Promise<ObjectValue> {
    requireValue(!this.store.getMeta('paused') && !this.activeRepositories.has(repo.id) && this.active.size < 2 &&
      !this.store.unsettled().some(op => op.repositoryId === repo.id && isGitJob(op.kind) && !op.result['remoteOperationId']),
      'REPOSITORY_BUSY', 'Existing, paused or unsettled work must finish before an external gate starts.', 4);
    const caller = object(args['caller']);
    requireValue(typeof caller['pid'] === 'number' && typeof caller['start'] === 'string', 'HOOK_PROCESS_MISMATCH', 'A live Git hook client is required.');
    const identity = { pid: caller['pid'], start: caller['start'] }, ancestor = gitPushAncestor(identity);
    requireValue(ancestor, 'HOOK_PROCESS_MISMATCH', 'This hook client has no verifiable live Git push ancestor. Use Contribution Push for an unsupported client command shape.');
    const op = this.store.admit(crypto.randomUUID(), 'external_gate', repo.id, args, this.payload.identity, 'running');
    // Reserve the repository synchronously, before checking policy or contacting
    // the destination, so a concurrent queue tick cannot enter the same writer.
    this.active.set(op.operationId, new AbortController()); this.activeRepositories.add(repo.id);
    let lease: LegacyPrimaryLease | undefined, dispatched = false;
    try {
      lease = new LegacyPrimaryLease(repo.commonDir, op.attemptId);
      const scope = await this.workflows.scope(repo);
      const remote = await git(repo.path, ['ls-remote', '--exit-code', scope.destination, scope.ref], { timeoutMs: 15000 });
      requireValue(remote.code === 0 || remote.code === 2, 'REMOTE_UNAVAILABLE', 'Cannot observe this external publication destination.', 3);
      const before = remote.code === 2 ? null : remote.stdout.split('\t')[0]!;
      const environment = await this.workflows.adopted.prepare(op, repo, scope, before, lease, true);
      this.workflows.adopted.started(op, ancestor.pid, ancestor.start);
      const plan = await this.workflows.adopted.begin(repo, { ...args, operationId: op.operationId, hookToken: environment['CONTRIBUTION_HOOK_TOKEN'] });
      dispatched = true;
      this.store.update(this.store.get(op.operationId), { effectDispatched: true, stage: 'external_gate_running', result: { delivery: 'unobserved', observation: 'pre_push_hook_only', processes: [ancestor, identity] } });
      const deadline = Date.now() + 3630000;
      const timer = setInterval(() => {
        if (processIdentity(identity.pid) === identity.start && Date.now() < deadline) return;
        const current = this.store.get(op.operationId);
        this.store.update(current, { state: 'outcome_unknown', stage: 'external_gate_reconciliation_required', result: { ...current.result, gate: this.store.record('gate', op.operationId) ?? { state: 'unobserved' }, delivery: 'unobserved' },
          error: { code: 'EXTERNAL_GATE_INTERRUPTED', message: 'The external gate client disappeared or exceeded its budget. Its lease and evidence remain retained; no gate or publication will replay.', retryable: false, nextActions: [] } });
        this.finishExternalHook(current, false);
      }, 1000); timer.unref();
      this.externalHooks.set(op.operationId, { lease, timer }); return plan;
    } catch (error) {
      const failure = rejected(error);
      this.store.update(this.store.get(op.operationId), { state: dispatched ? 'outcome_unknown' : 'failed', stage: 'external_gate_stopped', error: failure.error, result: { ...failure.result, delivery: 'unobserved' } });
      if (!dispatched) lease?.release(); this.active.delete(op.operationId); this.activeRepositories.delete(repo.id); this.kick(); throw error;
    }
  }
  async recoverObservedEffects(operationId?: string): Promise<void> {
    for (const op of this.store.unsettled().filter(item => item.state === 'outcome_unknown' && (!operationId || item.operationId === operationId))) {
      const processes = op.result['processes'] as { pid: number; start: string | null }[] | undefined;
      if (processes?.some(proc => alive(proc.pid) && (!proc.start || !processIdentity(proc.pid) || processIdentity(proc.pid) === proc.start))) continue;
      const repo = await this.repos.get(op.repositoryId);
      if (op.kind === 'initialize' && op.result['bootstrapIntent']) {
        const old = Lease.inspect(repo.commonDir);
        if (old && (old.attemptId !== op.attemptId || !Lease.reclaim(repo.commonDir, old))) continue;
        let lease: Lease | undefined;
        try {
          this.peers.assertWriter(repo); lease = new Lease(repo.commonDir, op.attemptId);
          const result = await this.workflows.initialize(op, repo);
          this.store.update(this.store.get(op.operationId), { state: 'succeeded', stage: 'reconciled', error: null, result: { ...this.store.get(op.operationId).result, ...result } });
        } catch (error) {
          this.store.put('bootstrapReconciliation', op.operationId, { code: error instanceof Fault ? error.code : 'RECONCILIATION_FAILED', observedAt: now() });
        } finally { lease?.release(); }
      } else if (op.kind === 'push') {
        const scope = op.input['scope'] as { destination: string; ref: string; tip: string };
        const observed = await git(repo.path, ['ls-remote', '--exit-code', scope.destination, scope.ref], { timeoutMs: 15000 });
        if (observed.code === 0 && observed.stdout.split('\t')[0] === scope.tip) {
          // A crash may precede copying the hook's durable receipt into the
          // outer operation. Remote delivery alone never proves that gate.
          const gate = this.store.record<ObjectValue>('gate', op.operationId) ?? op.result['gate'] as ObjectValue | undefined;
          const gateObserved = gate && ['passed', 'inactive'].includes(String(gate['state'])) && gate['sourceTip'] === scope.tip;
          const result = { ...op.result, gate: gate ?? { state: 'not_run' }, delivery: 'delivered', observedBy: 'remote_ref_reconciliation', gateReconciliationRequired: !gateObserved };
          if (gateObserved) this.store.update(op, { state: 'succeeded', stage: 'reconciled', error: null, result });
          else this.store.update(op, { stage: 'gate_reconciliation_required', result });
        }
      } else if (op.kind === 'submit' && repo.config.integration.adapter !== 'generic-v1') {
        try {
          const result = await this.workflows.adoptedLanding.reconcile(op, repo, { output: text => this.store.log(op, text) });
          this.store.update(this.store.get(op.operationId), { state: 'succeeded', stage: 'reconciled', error: null, result: { ...this.store.get(op.operationId).result, ...result, completedAt: now() } });
        } catch (error) { this.store.put('adoptedLandingReconciliation', op.operationId, { code: error instanceof Fault ? error.code : 'RECONCILIATION_FAILED', observedAt: now() }); }
      } else if (op.kind === 'submit' && typeof op.result['landedTip'] === 'string') {
        const current = await identity(repo.path);
        if (current.tip === op.result['landedTip']) {
          this.store.put('landing', digest({ repositoryId: repo.id, tip: op.input['tip'], base: op.input['base'] }), op.result);
          this.store.update(op, { state: 'succeeded', stage: 'reconciled', error: null });
        }
      } else if (op.kind === 'initialize' && op.result['bootstrapTip'] === (await identity(repo.path)).tip) {
        const cleanGenerated = await git(repo.path, ['diff', '--quiet', String(op.result['bootstrapTip']), '--', 'contribution.json', 'CONTRIBUTION.md']);
        if (cleanGenerated.code !== 0) continue;
        await gitText(repo.path, ['add', '--', 'contribution.json', 'CONTRIBUTION.md']);
        this.repos.save({ ...repo, policySource: 'tracked' }); this.store.update(op, { state: 'succeeded', stage: 'reconciled', error: null });
      } else if (['seed', 'mirror'].includes(op.kind) && op.result['historyTip'] === (await identity(repo.path)).tip && !(await gitText(repo.path, ['status', '--porcelain=v1']))) {
        this.store.put('historyReceipt', op.requestId, op.result);
        this.store.update(op, { state: 'succeeded', stage: 'reconciled', error: null });
      }
    }
    for (const repo of this.repos.all()) {
      const lease = Lease.inspect(repo.commonDir); if (!lease) continue;
      const owner = this.store.list(100000).find(op => op.attemptId === lease.attemptId);
      if (!owner || !['succeeded', 'failed', 'cancelled', 'interrupted'].includes(owner.state)) continue;
      const children = owner.result['processes'] as { pid: number; start: string | null }[] | undefined;
      if (children?.some(proc => alive(proc.pid) && (!proc.start || !processIdentity(proc.pid) || processIdentity(proc.pid) === proc.start))) continue;
      if (Lease.reclaim(repo.commonDir, lease)) this.store.put('leaseRecovery', lease.attemptId, { recoveredAt: now(), operationId: owner.operationId });
    }
  }
}
