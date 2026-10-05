import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { assertContract, buildIdentity } from '@contribution/contracts';
import type { Response, Machine, Repository } from '@contribution/contracts';
import { completed, rejected, requireValue, string, object, digest, Fault, terminal, now } from './core.js';
import type { ObjectValue } from './core.js';
import { Journal } from './journal.js';
import type { Operation } from './journal.js';
import { Repositories } from './repositories.js';
import { Workflows } from './workflows.js';
import { discover, identity, git, gitText, inputFingerprint } from './git.js';
import { Lease, alive, processIdentity } from './process.js';
import type { Payload } from './payload.js';
import { GitHubMonitor } from './github.js';

export interface Request { schemaVersion: 1; command: string; args: ObjectValue; cwd: string }
const allowed: Record<string, string[]> = {
  'version': [], 'doctor': [], 'service.status': [], 'service.pause': [], 'service.resume': [], 'service.restart': ['whenIdle'],
  'repos.list': [], 'repos.discover': ['root'], 'repos.add': ['path', 'profile', 'availability'], 'repos.create': ['path', 'requestId'],
  'repos.initialize': ['repo', 'requestId'], 'repos.inspect': ['repo'], 'repos.configure': ['repo', 'config', 'expectedRevision', 'requestId'],
  'repos.relocate': ['repo', 'path'], 'repos.remove': ['repo'], 'status': ['repo', 'refresh'],
  'push': ['repo', 'preview', 'expectedTip', 'scopeToken', 'requestId'], 'submit': ['repo', 'sourcePath', 'sourceTip', 'base', 'requestId', 'metadata'],
  'checks.run': ['repo', 'sourcePath', 'canonical', 'checkId', 'fresh', 'requestId'],
  'runs.list': ['repo'], 'runs.get': ['operationId'], 'runs.cancel': ['operationId'], 'runs.pin': ['operationId'], 'runs.unpin': ['operationId'],
  'runs.events': ['operationId', 'after'], 'logs': ['operationId', 'tail'], 'repair-context': ['operationId'], 'codex.open': ['repo', 'operationId'],
  'settings.get': [], 'settings.apply': ['config', 'expectedRevision', 'requestId'], 'hosts.list': [],
  'hook.pre-push': ['repo', 'operationId', 'hookToken', 'remote', 'url', 'stdin'], 'update.check': [], 'update.apply': ['whenIdle'],
};
export class Engine {
  readonly repos: Repositories;
  readonly workflows: Workflows;
  readonly github: GitHubMonitor;
  readonly active = new Map<string, AbortController>();
  readonly activeRepositories = new Set<string>();
  stopping = false;
  private scheduled = false;
  constructor(readonly store: Journal, readonly payload: Payload) {
    this.repos = new Repositories(store); this.workflows = new Workflows(store, this.repos, payload); this.github = new GitHubMonitor(store);
    if (!store.getMeta('settings')) {
      const settings: Machine = { schemaVersion: 1, hostId: store.hostId, label: 'This Mac', role: 'standalone', primaryHostId: store.hostId,
        primarySshAlias: null, projectRoots: [], repositories: [], notifications: { preferredHostId: store.hostId, success: true, failure: true },
        retention: { rawLogDays: 30, summaryDays: 365, maxLogBytes: 2147483648 }, remoteDevices: { enabled: false, maintainSession: false } };
      store.setMeta('settings', settings);
    }
    for (const op of store.list(100000).filter(item => item.state === 'running')) {
      store.update(op, { state: op.effectDispatched ? 'outcome_unknown' : 'interrupted', stage: 'reconciliation_required', error: {
        code: op.effectDispatched ? 'OUTCOME_UNCERTAIN' : 'WORKER_INTERRUPTED', message: 'The prior service stopped without a confirmed completion. Inspect the retained process and effect evidence before retrying.', retryable: false,
        nextActions: [{ id: 'inspect', label: 'Inspect retained operation', argv: ['contribution', 'runs', 'get', op.operationId, '--json'] }] } });
    }
  }
  settings(): Machine { return this.store.getMeta<Machine>('settings')!; }
  kick(): void {
    if (this.scheduled || this.stopping) return; this.scheduled = true;
    setImmediate(() => { this.scheduled = false; void this.schedule(); });
  }
  private async schedule(): Promise<void> {
    if (this.stopping || this.store.getMeta<boolean>('paused') || this.store.getMeta<boolean>('maintenance')) return;
    for (const op of this.store.queue()) {
      if (this.active.size >= 2 || this.activeRepositories.has(op.repositoryId)) continue;
      const blocked = this.store.unsettled().some(other => other.repositoryId === op.repositoryId && other.operationId !== op.operationId && ['outcome_unknown', 'needs_attention', 'waiting'].includes(other.state));
      if (blocked) continue;
      const controller = new AbortController(); this.active.set(op.operationId, controller); this.activeRepositories.add(op.repositoryId);
      void this.execute(op, controller.signal).finally(() => { this.active.delete(op.operationId); this.activeRepositories.delete(op.repositoryId); this.kick(); });
    }
  }
  private async execute(op: Operation, signal: AbortSignal): Promise<void> {
    let lease: Lease | undefined;
    try {
      // This schema-v1 payload understands these immutable requests; individual
      // handlers revalidate accepted policy/source before dispatching effects.
      this.store.update(op, { state: 'running', stage: 'starting', payload: this.payload.identity }, 'operation.started');
      let result: ObjectValue;
      if (op.kind === 'settings.apply') result = this.applySettings(op);
      else {
        const repo = await this.repos.get(op.repositoryId);
        lease = new Lease(repo.commonDir, op.attemptId);
        if (op.kind === 'initialize') result = await this.workflows.initialize(op, repo);
        else if (op.kind === 'submit') result = await this.workflows.landing(op, repo);
        else if (op.kind === 'push') result = await this.workflows.push(op, repo, signal, lease);
        else if (op.kind === 'checks') {
          requireValue(op.input['policy'] === repo.revision, 'POLICY_CHANGED', 'Check policy changed after admission.');
          const source = string(op.input['sourcePath'], 'sourcePath');
          requireValue((await identity(source)).tip === op.input['sourceTip'] && await inputFingerprint(source) === op.input['fingerprint'], 'SOURCE_CHANGED', 'The selected source changed while this check was queued. Select the current source in a new request.');
          result = await this.workflows.checks(op, repo, source, signal);
        } else throw new Fault('OPERATION_UNSUPPORTED', 'This payload does not implement the retained operation.', 3);
      }
      const latest = this.store.get(op.operationId);
      this.store.update(latest, { state: 'succeeded', stage: 'completed', result: { ...latest.result, ...result, completedAt: now() }, error: null }, 'operation.succeeded');
    } catch (error) {
      const fault = error instanceof Fault ? error : new Fault('INTERNAL_ERROR', 'The worker stopped unexpectedly. Retained effect evidence needs inspection.', 5);
      const latest = this.store.get(op.operationId);
      const uncertain = fault.exit === 6 || (latest.effectDispatched && !['PUSH_FAILED', 'GATE_FAILED'].includes(fault.code));
      const state = uncertain ? 'outcome_unknown' : fault.exit === 130 ? 'cancelled' : fault.exit === 3 ? 'waiting' : 'failed';
      this.store.log(latest, `\n${fault.code}: ${fault.message}\n`);
      this.store.update(latest, { state, stage: state === 'outcome_unknown' ? 'reconciliation_required' : 'stopped',
        result: { ...latest.result, ...fault.details, exitCode: uncertain ? 6 : fault.exit }, error: {
          code: uncertain ? 'OUTCOME_UNCERTAIN' : fault.code, message: fault.message, retryable: fault.retryable,
          nextActions: [{ id: 'repair', label: 'Read focused repair context', argv: ['contribution', 'repair-context', op.operationId, '--json'] }] } }, `operation.${state}`);
    } finally { lease?.release(); }
  }
  private admit(requestId: unknown, kind: string, repositoryId: string, input: ObjectValue): Response {
    const settings = this.settings();
    const logBytes = readdirSync(join(this.store.directory, 'logs')).reduce((total, name) => total + statSync(join(this.store.directory, 'logs', name)).size, 0);
    requireValue(logBytes < settings.retention.maxLogBytes, 'STORAGE_PRESSURE', 'Retained logs reached the configured quota. Free or export eligible evidence before more work.', 3);
    const op = this.store.admit(string(requestId, 'requestId'), kind, repositoryId, input, this.payload.identity); this.kick(); return this.store.response(op);
  }
  private applySettings(op: Operation): ObjectValue {
    const config = op.input['config'] as unknown as Machine; assertContract('machine', config);
    const previous = this.settings(); requireValue(digest(previous) === op.input['expectedRevision'], 'REVISION_CONFLICT', 'Settings changed since they were read.');
    requireValue(config.hostId === previous.hostId && config.role === previous.role && config.primaryHostId === previous.primaryHostId && config.primarySshAlias === previous.primarySshAlias && digest(config.repositories) === digest(previous.repositories),
      'AUTHORITY_TRANSITION_REQUIRED', 'Host roles and repository authority require a reconciled transition; raw settings cannot grant ownership.');
    requireValue(!config.remoteDevices?.maintainSession, 'CAPABILITY_UNVERIFIED', 'Persistent session maintenance requires measured and approved device qualification.', 3);
    this.store.setMeta('settings', config); return { settings: config, revision: digest(config) };
  }
  async dispatch(value: unknown): Promise<Response> {
    try {
      const input = object(value); requireValue(input['schemaVersion'] === 1, 'SCHEMA_UNSUPPORTED', 'Only request schema version 1 is supported.', 2);
      requireValue(Object.keys(input).every(key => ['schemaVersion', 'command', 'args', 'cwd'].includes(key)), 'INVALID_REQUEST', 'Unexpected request fields.', 2);
      const command = string(input['command'], 'command'), args = object(input['args']), cwd = string(input['cwd'], 'cwd');
      const fields = allowed[command]; requireValue(fields, 'OPERATION_UNSUPPORTED', 'This command is not available in this payload.', 3);
      requireValue(Object.keys(args).every(key => fields.includes(key)), 'INVALID_USAGE', 'Unsupported argument combination.', 2);
      if (command === 'version') return completed({ ...buildIdentity, interfaceVersion: buildIdentity.version, engineVersion: buildIdentity.version, supportedSchemaVersions: [1], compatibility: 'compatible', payload: this.payload.identity, distribution: this.payload.distribution, service: 'running' });
      if (command === 'service.status') return completed({ state: this.stopping ? 'stopping' : 'running', paused: this.store.getMeta('paused') ?? false,
        maintenance: this.store.getMeta('maintenance') ?? false, active: this.active.size, queued: this.store.queue().length, hostId: this.store.hostId, payload: this.payload.identity });
      if (command === 'doctor') return completed({ hostId: this.store.hostId, service: 'running', payloadVerified: true, distribution: this.payload.distribution,
        database: { version: 1, journalMode: 'wal', synchronous: 'full' }, repositories: this.repos.all().map(repo => ({ repositoryId: repo.id, pathExists: existsSync(repo.path), adapter: repo.config.integration.adapter })),
        devices: { enabled: this.settings().remoteDevices?.enabled ?? false, physicalQualification: 'unverified' } });
      if (command === 'service.pause' || command === 'service.resume') {
        this.store.setMeta('paused', command === 'service.pause'); this.kick(); return completed({ paused: command === 'service.pause' });
      }
      if (command === 'service.restart' || command === 'update.apply') {
        requireValue(args['whenIdle'] === true, 'IDLE_WINDOW_REQUIRED', 'Use --when-idle for lifecycle changes.', 2);
        requireValue(this.active.size === 0, 'SERVICE_BUSY', 'Active work must drain before restart or update.', 4);
        requireValue(!this.store.unsettled().some(op => op.state === 'outcome_unknown'), 'RECONCILIATION_REQUIRED', 'Resolve uncertain effects before lifecycle changes.');
        if (command === 'update.apply') throw new Fault('SIGNED_UPDATE_REQUIRED', 'No verified signed update is staged. Use the native updater once release signing is configured.', 3);
        this.store.setMeta('maintenance', true); this.stopping = true; return completed({ state: 'restart_ready', queuedPreserved: this.store.queue().length });
      }
      if (command === 'update.check') return completed({ status: 'not_configured', reason: 'SIGNED_FEED_REQUIRED', automaticInstallation: false });
      if (command === 'hosts.list') return completed({ hosts: [{ hostId: this.store.hostId, label: this.settings().label, role: this.settings().role, readiness: 'available' }] });
      if (command === 'settings.get') return completed({ settings: this.settings(), revision: digest(this.settings()) });
      if (command === 'settings.apply') { assertContract('machine', args['config']); return this.admit(args['requestId'], command, this.store.hostId, { config: args['config'], expectedRevision: string(args['expectedRevision'], 'expectedRevision') }); }
      if (command === 'repos.list') return completed({ repositories: this.repos.all() });
      if (command === 'repos.discover') return completed({ repositories: await discover(string(args['root'], 'root')), limits: { maxDepth: 3, maxDirectories: 250 } });
      if (command === 'repos.add') {
        requireValue(args['profile'] === undefined || ['local-development', 'standard'].includes(String(args['profile'])), 'INVALID_PROFILE', 'Unknown profile.', 2);
        requireValue(args['availability'] === undefined || ['this-mac', 'both-macs'].includes(String(args['availability'])), 'INVALID_AVAILABILITY', 'Unknown availability.', 2);
        return completed({ repository: await this.repos.add(string(args['path'], 'path'), args['profile'] as 'local-development' | 'standard' | undefined, args['availability'] as 'this-mac' | 'both-macs' | undefined) });
      }
      if (command === 'repos.create') {
        const repo = await this.repos.create(string(args['path'], 'path')); return this.admit(args['requestId'], 'initialize', repo.id, { policy: repo.revision });
      }
      if (command === 'runs.list') return completed({ operations: this.store.list().filter(op => !args['repo'] || op.repositoryId === args['repo']) });
      if (command === 'runs.events') return completed({ events: this.store.events(Math.max(0, Number(args['after'] ?? 0)), typeof args['operationId'] === 'string' ? args['operationId'] : undefined) });
      if (['runs.get', 'runs.cancel', 'runs.pin', 'runs.unpin', 'logs', 'repair-context'].includes(command)) {
        const op = this.store.get(string(args['operationId'], 'operationId'));
        if (command === 'logs') return completed({ operationId: op.operationId, attemptId: op.attemptId, text: this.store.logs(op, Number(args['tail'] ?? 200)) });
        if (command === 'repair-context') return completed({ operation: op, log: this.store.logs(op, 100), boundaries: ['Repair only the recorded failure.', 'Preserve unrelated work.', 'Publication needs a new explicit preview when scope changes.'] });
        if (command === 'runs.pin' || command === 'runs.unpin') return this.store.response(this.store.update(op, { pinned: command === 'runs.pin' }));
        if (command === 'runs.cancel' && !terminal.has(op.state)) {
          const controller = this.active.get(op.operationId);
          if (controller) { controller.abort(); return completed({ operationId: op.operationId, cancellation: 'requested' }); }
          return this.store.response(this.store.update(op, { state: 'cancelled', stage: 'cancelled_before_dispatch' }));
        }
        return this.store.response(op);
      }
      const repo = await this.repos.get(typeof args['repo'] === 'string' ? args['repo'] : cwd);
      if (command === 'repos.inspect') return completed({ repository: repo.config, revision: repo.revision, path: repo.path, commonDirectory: repo.commonDir, availability: repo.availability, canonicalHostId: repo.canonicalHostId });
      if (command === 'repos.relocate') return completed({ repository: await this.repos.relocate(repo, string(args['path'], 'path')) });
      if (command === 'repos.remove') {
        requireValue(!this.store.unsettled().some(op => op.repositoryId === repo.id), 'REPOSITORY_BUSY', 'Retain enrollment while work or effects remain unresolved.');
        requireValue(!this.store.record('hook', repo.id), 'INTEGRATION_REMOVAL_REQUIRED', 'Remove the matching Contribution-owned hook through a reviewed integration removal before unenrollment.');
        this.store.db.prepare('DELETE FROM repositories WHERE id=?').run(repo.id); return completed({ removed: repo.id, sourcePreserved: true });
      }
      if (command === 'repos.configure') {
        const requestId = string(args['requestId'], 'requestId'), config = args['config'] as unknown as Repository;
        const requestDigest = digest({ repo: repo.id, config, expectedRevision: args['expectedRevision'] });
        const prior = this.store.record<{ digest: string; result: ObjectValue }>('configurationRequests', requestId);
        if (prior) { requireValue(prior.digest === requestDigest, 'REQUEST_ID_CONFLICT', 'Configuration request ID was reused with different inputs.'); return completed(prior.result); }
        const result = { repository: this.repos.configure(repo, config, string(args['expectedRevision'], 'expectedRevision')) };
        this.store.put('configurationRequests', requestId, { digest: requestDigest, result }); return completed(result);
      }
      if (command === 'repos.initialize') return this.admit(args['requestId'], 'initialize', repo.id, { policy: repo.revision });
      if (command === 'status') {
        const github = args['refresh'] === true ? await this.github.refresh(repo) : this.store.record('github', repo.id) ?? null;
        return completed({ ...await this.repos.status(repo, args['refresh'] === true), github });
      }
      if (command === 'push') {
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
        return this.admit(requestId, 'checks', repo.id, { ...selection, selection, sourceTip: source.tip, fingerprint: await inputFingerprint(sourcePath), policy: repo.revision });
      }
      if (command === 'hook.pre-push') {
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
        const url = new URL('codex://threads/new'); url.searchParams.set('path', repo.path);
        if (args['operationId']) url.searchParams.set('prompt', `Inspect Contribution operation ${string(args['operationId'], 'operationId')} using repair-context. Preserve unrelated work and existing publication authority.`);
        return completed({ url: url.toString(), opensComposerOnly: true, projectRegistration: 'manual_if_needed', localPath: repo.path });
      }
      throw new Fault('OPERATION_UNSUPPORTED', 'This command is not implemented.', 3);
    } catch (error) { return rejected(error); }
  }
  async recoverObservedEffects(): Promise<void> {
    for (const op of this.store.unsettled().filter(item => item.state === 'outcome_unknown')) {
      const processes = op.result['processes'] as { pid: number; start: string | null }[] | undefined;
      if (processes?.some(proc => alive(proc.pid) && (!proc.start || !processIdentity(proc.pid) || processIdentity(proc.pid) === proc.start))) continue;
      const repo = await this.repos.get(op.repositoryId);
      if (op.kind === 'push') {
        const scope = op.input['scope'] as { destination: string; ref: string; tip: string };
        const observed = await git(repo.path, ['ls-remote', '--exit-code', scope.destination, scope.ref], { timeoutMs: 15000 });
        if (observed.code === 0 && observed.stdout.split('\t')[0] === scope.tip)
          this.store.update(op, { state: 'succeeded', stage: 'reconciled', error: null, result: { ...op.result, delivery: 'delivered', observedBy: 'remote_ref_reconciliation' } });
      } else if (op.kind === 'submit' && typeof op.result['landedTip'] === 'string') {
        const current = await identity(repo.path);
        if (current.tip === op.result['landedTip']) {
          this.store.put('landing', digest({ repositoryId: repo.id, tip: op.input['tip'], base: op.input['base'] }), op.result);
          this.store.update(op, { state: 'succeeded', stage: 'reconciled', error: null });
        }
      } else if (op.kind === 'initialize' && op.result['bootstrapTip'] === (await identity(repo.path)).tip) {
        await gitText(repo.path, ['add', '--', 'contribution.json', 'CONTRIBUTION.md']);
        this.repos.save({ ...repo, policySource: 'tracked' }); this.store.update(op, { state: 'succeeded', stage: 'reconciled', error: null });
      }
    }
  }
}
