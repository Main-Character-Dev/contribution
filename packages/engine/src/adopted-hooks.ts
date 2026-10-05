import { existsSync, lstatSync, openSync, closeSync, readSync, fstatSync, constants, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { policyInventory } from '@contribution/adapters';
import { digest, requireValue, string, object, id, Fault } from './core.js';
import type { ObjectValue } from './core.js';
import type { Journal, Operation } from './journal.js';
import type { Enrolled } from './repositories.js';
import type { Payload } from './payload.js';
import { LegacyPrimaryLease } from './legacy-lease.js';
import type { LegacyOwner } from './legacy-lease.js';
import { LegacyReporting } from './legacy-reporting.js';
import { ProjectRuntimes } from './project-runtime.js';
import { descendantOf } from './process.js';
import { git, gitText } from './git.js';
import type { LegacyHookInvocation } from './legacy-hook-borrow.js';

export interface PublicationScope { repositoryId: string; branch: string; tip: string; remote: string; destination: string; ref: string; policy: string }
/** Created only by the reconciled adoption transaction. A policy setting alone
 * cannot enable a pre-existing project writer or replace its hook owner. */
export interface AdoptedHookRegistration {
  schemaVersion: 1; phase: 'active'; adoptionId: string; repositoryId: string; adapter: string; policyRevision: string;
  hooksPath: string; dispatcherPath: string; dispatcherDigest: string; policyFilesDigest: string;
  originalHookDigest: string | null;
}
interface PushInvocation {
  operationId: string; attemptId: string; scope: PublicationScope; remoteBefore: string | null; hookToken: string; lease: LegacyOwner;
  policyRevision: string; adoption: AdoptedHookRegistration; external: boolean; noRefChanges?: boolean;
  process?: { pid: number; start: string | null }; begun: boolean; caller?: { pid: number; start: string };
  finished?: { input: string; result: ObjectValue };
}
export class AdoptedHooks {
  readonly reporting: LegacyReporting;
  constructor(readonly store: Journal, readonly payload: Payload, readonly currentScope: (repo: Enrolled) => Promise<PublicationScope>) { this.reporting = new LegacyReporting(store); }
  async verify(repo: Enrolled): Promise<AdoptedHookRegistration> {
    const record = this.store.record<AdoptedHookRegistration>('adoptedHooks', repo.id);
    requireValue(record?.schemaVersion === 1 && record.phase === 'active' && record.repositoryId === repo.id && record.adapter === repo.config.validation.adapter &&
      record.adapter === repo.config.integration.adapter && record.policyRevision === repo.revision && /^[a-f0-9-]{36}$/.test(record.adoptionId),
      'ADAPTER_MIGRATION_REQUIRED', 'This project needs a completed, reconciled hook and writer adoption before managed publication.', 3);
    const inventory = policyInventory(repo.path, record.adapter);
    requireValue(inventory.readyForParity && inventory.policy.gate === repo.config.validation.gate && digest(inventory.files) === record.policyFilesDigest,
      'ADOPTED_POLICY_CHANGED', 'The adopted policy sources changed. Review their new fingerprints before publication.', 3);
    const hooks = await gitText(repo.path, ['config', '--get', 'core.hooksPath']);
    const dispatcher = await gitText(repo.path, ['rev-parse', '--path-format=absolute', '--git-path', 'hooks/pre-push']);
    requireValue(hooks === record.hooksPath && realpathSync(dispatcher) === realpathSync(record.dispatcherPath) && digest(Buffer.from(this.bounded(dispatcher, 128 * 1024))) === record.dispatcherDigest && (lstatSync(dispatcher).mode & 0o100) !== 0,
      'EXISTING_HOOK_OWNER_CHANGED', 'The installed hook dispatcher differs from its reviewed adoption. Preserve it for reconciliation.', 3);
    if (record.originalHookDigest) requireValue(digest(Buffer.from(this.bounded(this.original(record), 128 * 1024))) === record.originalHookDigest, 'ADOPTED_HOOK_SNAPSHOT_CHANGED', 'The retained original gate changed or is unavailable.', 3);
    else requireValue(repo.config.validation.gate === 'inactive', 'ADOPTED_GATE_MISSING', 'An enabled gate requires its retained original program.', 3);
    return record;
  }
  async prepare(op: Operation, repo: Enrolled, scope: PublicationScope, remoteBefore: string | null, lease: LegacyPrimaryLease, external = false): Promise<ObjectValue> {
    const adoption = await this.verify(repo);
    requireValue(!this.store.record('adoptedPush', op.operationId), 'HOOK_INVOCATION_REPLAY', 'A retained adopted push cannot replay Git transport. Reconcile the original delivery.', 6);
    const hookToken = id(), invocation: PushInvocation = { operationId: op.operationId, attemptId: op.attemptId, scope, remoteBefore, hookToken, lease: lease.owner, begun: false, policyRevision: repo.revision, adoption, external };
    this.reporting.allocate(op, repo); this.store.put('adoptedPush', op.operationId, invocation);
    return { CONTRIBUTION_HOOK_TOKEN: hookToken, CONTRIBUTION_OPERATION_ID: op.operationId,
      CONTRIBUTION_BRIDGE_NODE: this.payload.node, CONTRIBUTION_BRIDGE_CLI: this.payload.cli, CONTRIBUTION_BRIDGE_STATE: this.store.directory, CONTRIBUTION_BRIDGE_REPO: repo.id };
  }
  started(op: Operation, pid: number, start: string | null): void {
    const invocation = this.store.record<PushInvocation>('adoptedPush', op.operationId)!;
    this.store.put('adoptedPush', op.operationId, { ...invocation, process: { pid, start } });
  }
  private validated(repo: Enrolled, args: ObjectValue): { invocation: PushInvocation; op: Operation; caller: { pid: number; start: string } } {
    const operationId = string(args['operationId'], 'managed operation'), op = this.store.get(operationId), invocation = this.store.record<PushInvocation>('adoptedPush', operationId);
    requireValue(invocation && invocation.operationId === op.operationId && invocation.attemptId === op.attemptId && invocation.scope.repositoryId === repo.id &&
      op.repositoryId === repo.id && op.kind === (invocation.external ? 'external_gate' : 'push') && op.state === 'running' && invocation.hookToken === args['hookToken'] && invocation.policyRevision === repo.revision &&
      invocation.lease.pid === process.pid && invocation.lease.purpose === `contribution:${op.attemptId}`,
      'HOOK_LEASE_INVALID', 'No running adopted push owns this hook request.', 3);
    const caller = object(args['caller']);
    requireValue(typeof caller['pid'] === 'number' && typeof caller['start'] === 'string' && invocation.process?.start &&
      descendantOf(caller['pid'], caller['start'], { pid: invocation.process.pid, start: invocation.process.start }), 'HOOK_PROCESS_MISMATCH', 'The gate client must belong to this exact live Git invocation.');
    LegacyPrimaryLease.borrow(repo.commonDir, invocation.lease, { pid: caller['pid'], start: caller['start'] }, { pid: invocation.process.pid, start: invocation.process.start });
    return { invocation, op, caller: { pid: caller['pid'], start: caller['start'] } };
  }
  async begin(repo: Enrolled, args: ObjectValue): Promise<ObjectValue> {
    const { invocation, op, caller } = this.validated(repo, args);
    requireValue(!invocation.begun, 'HOOK_INVOCATION_REPLAY', 'This adopted gate was already claimed. It cannot execute twice.', 3);
    const registration = await this.verify(repo), scope = await this.currentScope(repo);
    requireValue(digest(registration) === digest(invocation.adoption), 'ADOPTED_POLICY_CHANGED', 'The adoption record changed after publication admission.');
    requireValue(digest(scope) === digest(invocation.scope) && args['remote'] === scope.remote && args['url'] === scope.destination, 'STALE_PUSH_SELECTION', 'The adopted hook scope differs from the retained publication.');
    const noRefChanges = invocation.external && args['stdin'] === '';
    const lines = noRefChanges ? [] : string(args['stdin'], 'hook input').trim().split('\n'), fields = lines[0]?.split(/\s+/) ?? [];
    requireValue(noRefChanges || (lines.length === 1 && fields.length === 4 && fields[0] === `refs/heads/${scope.branch}` && fields[1] === scope.tip && fields[2] === scope.ref && fields[3] === (invocation.remoteBefore ?? '0'.repeat(scope.tip.length))),
      'REF_TRANSACTION_UNSUPPORTED', 'The adopted gate requires the exact enrolled ref transaction.');
    const runtimes = new ProjectRuntimes(this.store), runtime = registration.originalHookDigest && !noRefChanges ? await runtimes.resolve(repo, repo.path) : null;
    const reporting = this.reporting.allocate(op, repo);
    const current = this.validated(repo, args); requireValue(!current.invocation.begun, 'HOOK_INVOCATION_REPLAY', 'Another client claimed this adopted gate.');
    const bridge: LegacyHookInvocation = { repositoryId: repo.id, operationId: op.operationId, attemptId: op.attemptId, policyRevision: repo.revision,
      phase: 'gate_running', hookToken: invocation.hookToken, lease: invocation.lease, process: { pid: invocation.process!.pid, start: invocation.process!.start! } };
    const script = registration.originalHookDigest && !noRefChanges ? this.bounded(this.original(registration), 128 * 1024) : '';
    requireValue(noRefChanges || !registration.originalHookDigest || digest(Buffer.from(script)) === registration.originalHookDigest, 'ADOPTED_HOOK_SNAPSHOT_CHANGED', 'The original gate changed during preparation.');
    this.store.transaction(() => { this.store.put('adoptedPush', op.operationId, { ...current.invocation, begun: true, caller, noRefChanges }); this.store.put('legacyHookInvocation', op.operationId, bridge); });
    return { schemaVersion: 1, external: invocation.external, operationId: op.operationId, hookToken: invocation.hookToken, mode: noRefChanges ? 'no_ref_changes' : registration.originalHookDigest ? 'original_gate' : 'inactive', script,
      scriptName: join(repo.path, registration.adapter === 'mathy-v1' ? '.githooks/pre-push' : '.husky/pre-push'), cwd: repo.path,
      argv: [scope.remote, scope.destination], stdin: args['stdin'], environment: { ...(runtime ? runtimes.environment(runtime) : {}), ...reporting.environment,
        CONTRIBUTION_OPERATION_ID: op.operationId, CONTRIBUTION_HOOK_TOKEN: invocation.hookToken, CONTRIBUTION_BRIDGE_NODE: this.payload.node,
        CONTRIBUTION_BRIDGE_CLI: this.payload.cli, CONTRIBUTION_BRIDGE_STATE: this.store.directory, CONTRIBUTION_BRIDGE_REPO: repo.id } };
  }
  retainedCompletion(repo: Enrolled, args: ObjectValue): ObjectValue | undefined {
    if (typeof args['operationId'] !== 'string') return undefined;
    const invocation = this.store.record<PushInvocation>('adoptedPush', args['operationId']);
    if (!invocation?.finished || this.store.get(invocation.operationId).state === 'running') return undefined;
    requireValue(invocation.scope.repositoryId === repo.id && invocation.hookToken === args['hookToken'] &&
      invocation.finished.input === digest({ caller: args['caller'], code: args['gateExit'], output: args['gateOutput'] ?? '', truncated: args['outputTruncated'] ?? false }),
      'HOOK_RESULT_CHANGED', 'This completion does not match the retained hook result.');
    return invocation.finished.result;
  }
  async finish(repo: Enrolled, args: ObjectValue): Promise<ObjectValue> {
    const { invocation, op, caller } = this.validated(repo, args);
    requireValue(invocation.begun && digest(invocation.caller) === digest(caller), 'HOOK_PROCESS_MISMATCH', 'Only the client that claimed this gate can record its completion.');
    const code = args['gateExit']; requireValue(Number.isInteger(code) && Number(code) >= 0 && Number(code) <= 255, 'INVALID_GATE_EXIT', 'The original gate must return a bounded process exit status.', 2);
    const output = args['gateOutput'] ?? '', truncated = args['outputTruncated'] ?? false;
    requireValue(typeof output === 'string' && Buffer.byteLength(output) <= 128 * 1024 + 3 && typeof truncated === 'boolean' && (invocation.external || (!output && !truncated)), 'INVALID_GATE_OUTPUT', 'Gate output exceeds its private bounded external snapshot.', 2);
    const input = digest({ caller, code, output, truncated });
    if (invocation.finished) { requireValue(invocation.finished.input === input, 'HOOK_RESULT_CHANGED', 'A retained gate result is immutable.'); return invocation.finished.result; }
    let gate: ObjectValue, evidence: ObjectValue | undefined;
    try {
      if (invocation.external && !this.store.record('externalOutput', op.operationId)) {
        this.store.log(op, output + (truncated ? '\n[External gate output exceeded 128 KiB; remaining output omitted]\n' : ''));
        this.store.put('externalOutput', op.operationId, { input, truncated, capturedAt: new Date().toISOString(), collection: 'completed_client_snapshot' });
      }
      if (invocation.external) requireValue(this.store.record<{ input: string }>('externalOutput', op.operationId)?.input === input, 'HOOK_RESULT_CHANGED', 'The retained output belongs to a different completion.');
      evidence = this.reporting.seal(op);
      const registration = await this.verify(repo);
      requireValue(digest(registration) === digest(invocation.adoption), 'ADOPTED_POLICY_CHANGED', 'The adoption record changed while the gate ran.');
      if (code !== 0) throw new Fault('GATE_FAILED', 'The original adopted project gate refused publication.', 5, { exitCode: code });
      requireValue(digest(await this.currentScope(repo)) === digest(invocation.scope), 'STALE_PUSH_SELECTION', 'Source or destination changed while the original gate ran.');
      const remote = await git(repo.path, ['ls-remote', '--exit-code', invocation.scope.destination, invocation.scope.ref], { timeoutMs: 15000 });
      requireValue((remote.code === 2 && invocation.remoteBefore === null) || (remote.code === 0 && remote.stdout.split('\t')[0] === invocation.remoteBefore), 'REMOTE_CHANGED', 'The publication destination changed during the original gate.');
      this.validated(repo, args);
      gate = { state: invocation.noRefChanges ? 'not_run' : registration.originalHookDigest ? 'passed' : 'inactive', sourceTip: invocation.scope.tip, exitCode: code, originalPolicy: registration.adapter, adoption: invocation.adoption, evidence };
    } catch (error) {
      gate = { state: 'failed', sourceTip: invocation.scope.tip, exitCode: Number(code) === 0 ? 5 : Number(code), code: error instanceof Fault ? error.code : 'ADOPTED_GATE_FAILED', adoption: invocation.adoption, ...(evidence ? { evidence } : {}) };
    }
    const current = this.store.record<PushInvocation>('adoptedPush', op.operationId)!;
    if (current.finished) { requireValue(current.finished.input === input, 'HOOK_RESULT_CHANGED', 'Another completion already retained a different outcome.'); return current.finished.result; }
    this.store.transaction(() => {
      this.store.put('gate', op.operationId, gate); this.store.put('adoptedPush', op.operationId, { ...current, finished: { input, result: gate } });
      const bridge = this.store.record<LegacyHookInvocation>('legacyHookInvocation', op.operationId)!; this.store.put('legacyHookInvocation', op.operationId, { ...bridge, phase: 'gate_finished' });
    });
    return gate;
  }
  private original(registration: AdoptedHookRegistration): string { return join(this.store.directory, 'adoptions', registration.adoptionId, 'original-pre-push'); }
  private bounded(path: string, limit: number): string {
    requireValue(existsSync(path), 'ADOPTED_SOURCE_MISSING', 'An adopted source or dispatcher is unavailable.', 3);
    const info = lstatSync(path); requireValue(info.isFile() && !info.isSymbolicLink() && info.uid === process.getuid?.() && info.size <= limit, 'ADOPTED_SOURCE_CHANGED', 'An adopted source is no longer a bounded owned regular file.', 3);
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = fstatSync(fd); requireValue(before.isFile() && before.uid === process.getuid?.() && before.size <= limit && before.ino === info.ino && before.dev === info.dev, 'ADOPTED_SOURCE_CHANGED', 'The source changed while opening.');
      const buffer = Buffer.alloc(before.size + 1); let length = 0;
      while (length < buffer.length) { const count = readSync(fd, buffer, length, buffer.length - length, null); if (!count) break; length += count; }
      const after = fstatSync(fd); requireValue(length === before.size && after.size === before.size && after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs, 'ADOPTED_SOURCE_CHANGED', 'The source changed while reading.');
      return buffer.subarray(0, length).toString('utf8');
    } finally { closeSync(fd); }
  }
}
