import { mkdirSync, writeFileSync, existsSync, readFileSync, openSync, fsyncSync, closeSync, lstatSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { policyInventory } from '@contribution/adapters';
import type { Journal, Operation } from './journal.js';
import type { Enrolled } from './repositories.js';
import type { ObjectValue } from './core.js';
import { digest, object, requireValue, string, Fault, now, redact, id } from './core.js';
import { clean, identity, gitText } from './git.js';
import { run, alive, processIdentity } from './process.js';
import type { RunOptions } from './process.js';
import { ProjectRuntimes } from './project-runtime.js';
import type { AdoptedHooks } from './adopted-hooks.js';
import { privateDirectory } from './private-files.js';
import { LegacyLandingFlight } from './legacy-flight.js';
import { OwnedWorktrees } from './owned-worktrees.js';

// Execute reviewed project exports with the project's registered runtime. No
// repository source is copied into Contribution or replaced by generic policy.
const probe = String.raw`
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const input = JSON.parse(readFileSync(0, 'utf8'));
const git = args => execFileSync('/usr/bin/git', args, { cwd: input.primary, encoding: 'utf8', timeout: 10000 }).trim();
const state = await import(pathToFileURL(join(input.primary, 'scripts/lib/worktree-landing-state.mjs')));
const entry = await import(pathToFileURL(join(input.primary, 'scripts/worktree-land')));
const candidate = state.readLandingCandidate(input.primary, input.tip);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])) : value;
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
let result;
if (input.action === 'native-scope') {
  const receipt = state.readLandingValidationReceipt(input.primary, input.tip);
  const requiredCandidate = input.retainedCandidate ?? candidate;
  if (!requiredCandidate) throw Error('The retained candidate requirements are unavailable.');
  const identity = state.resolveValidatedLandingIdentity(input.primary, input.branch, receipt, {
    reconciliationStatus: 'failed', checksCommand: 'pnpm test:changed', requiredUITestSelectors: requiredCandidate.required_ui_test_selectors ?? []
  });
  if (!identity || identity.candidateSha !== input.tip) throw Error('No validated canonical landing has this failed native reconciliation.');
  const selected = new Set([input.tip, ...(identity.supersedes ?? [])]);
  const candidates = state.listLandingCandidates(input.primary).filter(item => selected.has(item.sha)).sort((a,b)=>a.sha.localeCompare(b.sha));
  result = { landedTip: identity.commitSha, receiptDigest: digest(receipt), candidatesDigest: digest(candidates), requiredUITestSelectors: requiredCandidate.required_ui_test_selectors ?? [] };
} else if (input.action === 'source') {
  state.assertManagedLandingSourceWorktree({ worktreePath: input.source, primaryRepoRoot: input.primary, candidateShas: [input.tip, ...(candidate?.supersedes ?? [])] });
  result = { sourceEligible: true, candidate: candidate ?? null };
} else if (input.action === 'queue-preview' || input.action === 'queue') {
  const inherited = state.listLandingCandidates(input.primary).filter(item => item.worktree_path === input.originalSource && state.landingCandidateRequiresExactTreeValidation(item));
  const scope = { candidate: candidate ?? null, inherited };
  const worker = await import(pathToFileURL(join(input.primary, 'scripts/worktree-landing-worker')));
  const requirementsDigest = input.adapter === 'mathy-v1' ? state.landingValidationRequirementsDigest('pnpm test:changed', candidate?.required_ui_test_selectors ?? []) : worker.integrationContractDigest();
  if (input.action === 'queue-preview') result = { scope, scopeDigest: digest(scope), requirementsDigest };
  else {
    if (digest(scope) !== input.scopeDigest) throw Error('The original queue changed before captured-source registration.');
    if (candidate && candidate.worktree_path !== input.originalSource && candidate.worktree_path !== input.source) throw Error('This candidate belongs to another source workspace.');
    const supersedes = [...new Set([...(candidate?.supersedes ?? []), ...inherited.flatMap(item => [item.sha, ...(item.supersedes ?? [])])])].filter(sha=>sha!==input.tip);
    const queued = state.enqueueLandingCandidate({primaryRoot:input.primary,sha:input.tip,worktreePath:input.source,source:input.captured?'contribution-captured-source':'synchronous-worktree-land',
      taskId:candidate?.task_id ?? '',supersedes,objectiveId:candidate?.objective_id ?? '',reviewsDir:candidate?.reviews_dir ?? '',
      requiredUITestSelectors:candidate?.required_ui_test_selectors ?? [],reviewEpoch:candidate?.review_epoch ?? 0,postResetAttempt:candidate?.post_reset_attempt ?? false});
    if (queued.sha!==input.tip || queued.worktree_path!==input.source || (candidate?.task_id && queued.task_id!==candidate.task_id) || !supersedes.every(sha=>(queued.supersedes??[]).includes(sha))) throw Error('Captured-source registration lost original candidate identity.');
    if(input.adapter==='mathy-v1' && (candidate?.objective_id && queued.objective_id!==candidate.objective_id || (queued.review_epoch??0)<(candidate?.review_epoch??0) || !(candidate?.required_ui_test_selectors??[]).every(value=>(queued.required_ui_test_selectors??[]).includes(value)))) throw Error('Mathy candidate requirements changed during registration.');
    result={queued,previous:scope};
  }
} else {
  const receipt = state.readLandingValidationReceipt(input.primary, input.tip);
  if (!receipt) result = { confirmed: false, reason: 'NO_LANDING_RECEIPT' };
  else {
    const contains = sha => { try { git(['merge-base', '--is-ancestor', sha, input.branch]); return true; } catch { return false; } };
    const options = { candidateSha: input.tip, receipt, targetContainsSha: contains, resolveTreeSha: sha => git(['rev-parse', sha + '^{tree}']) };
    if (input.adapter === 'mathy-v1') {
      if (receipt.reconciliation_status !== 'passed') throw Error('Primary native reconciliation is incomplete; run the original project repair, not another landing.');
      const requiredCandidate = input.retainedCandidate ?? candidate;
      if (!requiredCandidate) throw Error('Mathy candidate requirements are unavailable.');
      options.landedIdentity = state.resolveCanonicalLandingForCandidate(input.primary, git(['rev-parse', input.branch]), requiredCandidate);
      options.checksCommand = 'pnpm test:changed'; options.requiredUITestSelectors = requiredCandidate.required_ui_test_selectors ?? [];
    }
    const landedTip = entry.resolveLandedCandidateSha(options);
    result = { confirmed: true, landedTip, receipt, candidate: candidate ?? null };
  }
}
process.stdout.write('\nCONTRIBUTION_LANDING_RESULT=' + JSON.stringify(result) + '\n');
`;

// Recheck the reviewed identity inside the original worker's acquired primary
// lease, before its native planning or workspace effects. The project still
// owns planning, simulator leases, workspace restoration and receipt cleanup.
const nativeRepair = String.raw`
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const input = JSON.parse(readFileSync(0, 'utf8')), scope = input.scope;
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])) : value;
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const git = args => execFileSync('/usr/bin/git', args, { cwd: input.primary, encoding: 'utf8', timeout: 10000 }).trim();
const policy = () => { for(const [file, hash] of Object.entries(input.policyFiles)) {
  if (createHash('sha256').update(readFileSync(join(input.primary,file))).digest('hex') !== hash) throw Error('Reviewed native policy changed.');
} };
policy();
const state = await import(pathToFileURL(join(input.primary, 'scripts/lib/worktree-landing-state.mjs')));
const verify = () => {
  policy();
  if (git(['branch','--show-current']) !== scope.branch || git(['rev-parse','HEAD']) !== scope.primaryTip || git(['status','--porcelain=v1'])) throw Error('Reviewed primary changed.');
  const receipt = state.readLandingValidationReceipt(input.primary, scope.candidateTip);
  const identity = state.resolveValidatedLandingIdentity(input.primary, scope.branch, receipt, { reconciliationStatus:'failed', checksCommand:'pnpm test:changed', requiredUITestSelectors:scope.requiredUITestSelectors });
  if (!identity || identity.candidateSha !== scope.candidateTip || identity.commitSha !== scope.landedTip || digest(receipt) !== scope.receiptDigest) throw Error('Reviewed landed receipt changed.');
  const selected = new Set([scope.candidateTip, ...(identity.supersedes ?? [])]);
  const candidates = state.listLandingCandidates(input.primary).filter(item=>selected.has(item.sha)).sort((a,b)=>a.sha.localeCompare(b.sha));
  if (digest(candidates) !== scope.candidatesDigest) throw Error('Reviewed candidate generation changed.');
};
verify();
const native = await import(pathToFileURL(join(input.primary, 'scripts/ios-development.mjs')));
const repair = await import(pathToFileURL(join(input.primary, 'scripts/worktree-reconcile')));
await repair.reconcileLandedCandidate({ cwd: input.primary, candidateSha: scope.candidateTip, planCommand: (...args) => {
  verify(); const plan = native.planNativeReconciliation(...args); verify(); return plan;
} });
`;

interface Selection { adoptionDigest: string; sourcePath: string; canonicalSourcePath: string; sourceTip: string; base: string; selectedAt: string; originalCandidate: ObjectValue | null }
interface Snapshot { directory: string; tip: string; base: string; originalSource: string; phase: 'creating' | 'ready' }
export class AdoptedLanding {
  readonly runtimes: ProjectRuntimes;
  constructor(readonly store: Journal, readonly hooks: AdoptedHooks) { this.runtimes = new ProjectRuntimes(store); }
  private environment(runtime: Awaited<ReturnType<ProjectRuntimes['resolve']>>): NodeJS.ProcessEnv {
    const env = this.runtimes.environment(runtime);
    // An original worker acquires its own lease; it never borrows a push gate's
    // authority or inherits another chat's task attribution.
    for (const key of Object.keys(process.env)) if (key.startsWith('CONTRIBUTION_') || key.startsWith('CODEX_')) env[key] = undefined;
    return env;
  }
  private async inspect(repo: Enrolled, sourcePath: string, tip: string, action: 'source' | 'receipt' | 'queue-preview' | 'queue' | 'native-scope', options: RunOptions = {}, extra: ObjectValue = {}): Promise<ObjectValue> {
    const runtime = await this.runtimes.resolve(repo, repo.path);
    const result = await run(runtime.node, ['--input-type=module', '--eval', probe], { ...options, cwd: repo.path, env: this.environment(runtime), timeoutMs: 30000,
      input: JSON.stringify({ primary: repo.path, source: sourcePath, tip, branch: repo.config.integration.branch, adapter: repo.config.integration.adapter, action, ...extra }) });
    if (result.code !== 0) throw new Fault(result.cancelled ? 'CANCELLED' : action === 'source' ? 'SOURCE_OWNERSHIP_REQUIRED' : action.startsWith('queue') ? 'LANDING_QUEUE_UNCONFIRMED' : 'LANDING_RECEIPT_UNCONFIRMED',
      action === 'source' ? 'The original project policy did not accept this native task source.' : action.startsWith('queue') ? 'The original project queue could not confirm the unchanged candidate and requirements.' : 'The original project receipt validator did not confirm integration and required reconciliation.',
      result.cancelled ? 130 : 3, { adapterAction: action, diagnostic: redact(result.stderr).slice(-2048), timedOut: result.timedOut });
    const marker = '\nCONTRIBUTION_LANDING_RESULT=', lines = result.stdout.split(marker);
    requireValue(lines.length === 2, 'LANDING_PROBE_INVALID', 'The project adapter returned no unique structured observation.', 3);
    try { return object(JSON.parse(lines[1]!.trim())); } catch { throw new Fault('LANDING_PROBE_INVALID', 'The project adapter returned invalid receipt data.', 3); }
  }
  async capture(repo: Enrolled, requestId: string, sourcePath: string, tip: string, base: string, metadata: ObjectValue): Promise<void> {
    const adoption = await this.hooks.verify(repo), info = await identity(sourcePath);
    requireValue(!info.branch, 'SOURCE_OWNERSHIP_REQUIRED', 'This project requires a detached native task source.', 3);
    requireValue(await gitText(repo.path, ['merge-base', repo.config.integration.branch, tip]) === base, 'SOURCE_RANGE_CHANGED', 'The submitted base differs from the original project worker’s current integration range.', 3);
    if (repo.config.integration.adapter === 'mathy-v1') {
      const count = Number(await gitText(sourcePath, ['rev-list', '--count', `${base}..${tip}`]));
      requireValue(count === 1 || (typeof metadata['integrationMessage'] === 'string' && metadata['integrationMessage'].trim()), 'NEEDS_INPUT', 'Mathy requires an explicit combined message for a multi-commit task.', 2);
    } else requireValue(metadata['integrationMessage'] === undefined, 'PROJECT_MESSAGE_POLICY', 'This project owns its integration message. Submit without a generic message override.', 2);
    const sourcePolicy = await this.inspect(repo, sourcePath, tip, 'source');
    const selected: Selection = { adoptionDigest: digest(adoption), sourcePath, canonicalSourcePath: info.path, sourceTip: tip, base, selectedAt: now(), originalCandidate: sourcePolicy['candidate'] as ObjectValue | null };
    this.store.put('adoptedLandingSelection', requestId, selected);
  }
  private async snapshot(op: Operation, repo: Enrolled, selected: Selection, options: RunOptions): Promise<Snapshot> {
    const root = join(this.store.directory, 'adopted-landings'); privateDirectory(root);
    const parent = realpathSync(root), directory = join(parent, op.attemptId, 'source'); privateDirectory(join(parent, op.attemptId));
    let retained = this.store.record<Snapshot>('adoptedLandingSnapshot', op.operationId);
    if (!retained) {
      requireValue(!existsSync(directory), 'CAPTURE_RECOVERY_REQUIRED', 'An unrecorded source directory must be inspected before capture.', 3);
      retained = { directory, tip: selected.sourceTip, base: selected.base, originalSource: selected.sourcePath, phase: 'creating' };
      this.store.put('adoptedLandingSnapshot', op.operationId, retained);
    }
    requireValue(retained.directory === directory && retained.tip === selected.sourceTip && retained.base === selected.base && retained.originalSource === selected.sourcePath,
      'CAPTURE_RECOVERY_REQUIRED', 'The retained source snapshot belongs to another immutable selection.', 3);
    const capture = this.store.record<{ retention: string; tip: string; base: string }>('capture', op.requestId);
    requireValue(capture && capture.tip === selected.sourceTip && capture.base === selected.base && await gitText(repo.path, ['rev-parse', capture.retention]) === selected.sourceTip,
      'CAPTURE_RECOVERY_REQUIRED', 'The admitted source retention ref is missing or changed. Preserve the bundle for recovery.', 3);
    if (!existsSync(directory)) await new OwnedWorktrees(this.store).create(op, repo, 'adopted', selected.sourceTip, { ...options, timeoutMs: 60000 });
    const info = lstatSync(directory); requireValue(info.isDirectory() && !info.isSymbolicLink() && info.uid === process.getuid?.() && realpathSync(directory) === directory, 'CAPTURE_RECOVERY_REQUIRED', 'The owned snapshot directory was replaced.', 3);
    const identityNow = await identity(directory);
    requireValue(identityNow.commonDir === repo.commonDir && identityNow.tip === selected.sourceTip && !identityNow.branch, 'CAPTURE_RECOVERY_REQUIRED', 'The owned snapshot no longer identifies the retained commit.', 3);
    await clean(directory); retained = { ...retained, phase: 'ready' }; this.store.put('adoptedLandingSnapshot', op.operationId, retained); return retained;
  }
  private async selected(op: Operation, repo: Enrolled): Promise<Selection> {
    return this.retainedSelection(repo, op.requestId, string(op.input['sourcePath'], 'sourcePath'), string(op.input['tip'], 'tip'), string(op.input['base'], 'base'));
  }
  async retainedSelection(repo: Enrolled, requestId: string, sourcePath: string, tip: string, base: string): Promise<Selection> {
    const selected = this.store.record<Selection>('adoptedLandingSelection', requestId);
    requireValue(selected && selected.sourcePath === sourcePath && selected.sourceTip === tip && selected.base === base, 'ADOPTED_CAPTURE_REQUIRED', 'The original source-policy selection is missing; preserve the captured history.', 3);
    requireValue(selected.adoptionDigest === digest(await this.hooks.verify(repo)), 'ADOPTED_POLICY_CHANGED', 'The reviewed original adapter changed after source capture.', 3);
    return selected;
  }
  private assertInactive(op: Operation): void {
    const processes = op.result['processes'] as { pid: number; start: string | null }[] | undefined;
    requireValue(!processes?.some(proc => alive(proc.pid) && (!proc.start || !processIdentity(proc.pid) || processIdentity(proc.pid) === proc.start)),
      'WORKER_STILL_ACTIVE', 'The retained worker must stop before native reconciliation can be reviewed or resumed.', 3);
  }
  assertNativeAdmission(op: Operation, repairOperationId?: string): void {
    requireValue(!this.store.list(100000).some(other => other.operationId !== repairOperationId && other.kind === 'native_reconciliation' && other.input['sourceOperationId'] === op.operationId &&
      other.state !== 'succeeded' && (!['failed', 'cancelled'].includes(other.state) || other.effectDispatched)),
      'NATIVE_RECONCILIATION_PENDING', 'Observe the retained native repair before admitting another attempt.', 3);
  }
  private async nativeScope(op: Operation, repo: Enrolled, repairOperationId?: string, options: RunOptions = {}): Promise<ObjectValue> {
    requireValue(repo.config.integration.adapter === 'mathy-v1' && op.kind === 'submit' && op.effectDispatched && op.state === 'outcome_unknown' && !op.result['remoteOperationId'],
      'NATIVE_RECONCILIATION_UNAVAILABLE', 'Select a local Mathy landing with a verified failed native follow-up.', 3);
    this.assertInactive(op);
    this.assertNativeAdmission(op, repairOperationId);
    const selected = await this.selected(op, repo), info = await identity(repo.path); await clean(repo.path);
    requireValue(info.branch === repo.config.integration.branch && info.tip, 'CANONICAL_BRANCH_CHANGED', 'Restore the configured primary branch before native reconciliation.', 3);
    const retainedCandidate = this.store.record<ObjectValue>('adoptedLandingCandidate', op.operationId) ?? selected.originalCandidate;
    const observed = await this.inspect(repo, selected.sourcePath, selected.sourceTip, 'native-scope', options, { retainedCandidate });
    return { sourceOperationId: op.operationId, repositoryId: repo.id, policy: repo.revision, adoptionDigest: selected.adoptionDigest,
      candidateTip: selected.sourceTip, primaryTip: info.tip, branch: info.branch, ...observed };
  }
  async previewNative(op: Operation, repo: Enrolled): Promise<ObjectValue> {
    const scope = await this.nativeScope(op, repo), scopeToken = id(); this.store.put('nativeReconciliationPreview', scopeToken, scope);
    return { scopeToken, scope, action: 'Resume the original project’s dependency and native reconciliation for this landed candidate.',
      workspaceEffects: 'The project may rebuild generated native dependencies and temporarily close and restore its Xcode workspace.', publication: 'not_requested' };
  }
  async selectNative(op: Operation, repo: Enrolled, scopeToken: string, requestId: string): Promise<ObjectValue> {
    const scope = this.store.record<ObjectValue>('nativeReconciliationPreview', scopeToken);
    requireValue(scope?.['sourceOperationId'] === op.operationId && scope['repositoryId'] === repo.id, 'STALE_NATIVE_SELECTION', 'Review this exact native follow-up before resuming it.', 3);
    const input = { sourceOperationId: op.operationId, scope };
    if (this.store.existing(requestId, 'native_reconciliation', repo.id, input)) return input;
    requireValue(digest(await this.nativeScope(op, repo)) === digest(scope), 'STALE_NATIVE_SELECTION', 'The landed receipt, candidate, primary or policy changed. Review the native follow-up again.', 3);
    return input;
  }
  async resumeNative(op: Operation, repo: Enrolled, options: RunOptions): Promise<ObjectValue> {
    requireValue(!op.effectDispatched, 'NATIVE_RECONCILIATION_PENDING', 'Observe this retained native attempt; it cannot be replayed.', 6);
    const source = this.store.get(string(op.input['sourceOperationId'], 'source operation')), scope = object(op.input['scope']);
    requireValue(digest(await this.nativeScope(source, repo, op.operationId, options)) === digest(scope), 'STALE_NATIVE_SELECTION', 'The reviewed native follow-up changed while queued.', 3);
    const runtime = await this.runtimes.resolve(repo, repo.path), policyFiles = policyInventory(repo.path, repo.config.integration.adapter).files;
    this.store.update(this.store.get(op.operationId), { effectDispatched: true, stage: 'original_native_reconciliation' });
    const worker = await run(runtime.node, ['--input-type=module', '--eval', nativeRepair], { ...options, cwd: repo.path, env: this.environment(runtime), timeoutMs: 60 * 60 * 1000,
      input: JSON.stringify({ primary: repo.path, scope, policyFiles }) });
    this.store.put('nativeReconciliationExit', op.operationId, { exitCode: worker.code, cancelled: worker.cancelled, timedOut: worker.timedOut, observedAt: now() });
    try { return { ...await this.observeNative(op, repo), workerExit: worker.code }; }
    catch { throw new Fault('NATIVE_RECONCILIATION_REQUIRED', 'The native follow-up stopped without a fully verified original receipt and source guard. Inspect its retained attempt; integration was not replayed.', 6, { workerExit: worker.code }); }
  }
  async observeNative(op: Operation, repo: Enrolled): Promise<ObjectValue> {
    this.assertInactive(this.store.get(op.operationId));
    const source = this.store.get(string(op.input['sourceOperationId'], 'source operation')); this.assertInactive(source);
    const result = await this.reconcile(source, repo, { output: text => this.store.log(op, text) });
    requireValue(result['landedTip'] === object(op.input['scope'])['landedTip'], 'LANDED_IDENTITY_CHANGED', 'The repaired receipt no longer identifies the reviewed landed commit.', 6);
    this.store.update(this.store.get(source.operationId), { state: 'succeeded', stage: 'native_reconciled', error: null,
      result: { ...this.store.get(source.operationId).result, ...result, nativeReconciliationOperationId: op.operationId, completedAt: now() } });
    return { ...result, sourceOperationId: source.operationId, reconciliation: 'passed', integrationReplayed: false };
  }
  async reconcile(op: Operation, repo: Enrolled, options: RunOptions = {}): Promise<ObjectValue> {
    const selected = await this.selected(op, repo), snapshot = this.store.record<Snapshot>('adoptedLandingSnapshot', op.operationId), sourcePath = snapshot?.directory ?? selected.sourcePath;
    const retainedCandidate = this.store.record<ObjectValue>('adoptedLandingCandidate', op.operationId) ?? selected.originalCandidate;
    let observed: ObjectValue;
    try { observed = await this.inspect(repo, sourcePath, selected.sourceTip, 'receipt', options, { retainedCandidate: retainedCandidate ?? null }); }
    catch (error) {
      if (repo.config.integration.adapter === 'mathy-v1') {
        let failed: ObjectValue | undefined;
        try { failed = await this.inspect(repo, sourcePath, selected.sourceTip, 'native-scope', options, { retainedCandidate: retainedCandidate ?? null }); } catch { /* Missing or invalid evidence stays uncertain. */ }
        if (failed) throw new Fault('LANDED_RECONCILIATION_FAILED', 'The task is landed and its validation is confirmed. The original native follow-up failed; review Resume native setup for that recorded commit.', 6,
          { sourceTip: selected.sourceTip, landedTip: failed['landedTip'], integration: 'landed_reconciliation_failed', nativeReconciliation: { state: 'failed', landedTip: failed['landedTip'], receiptDigest: failed['receiptDigest'] }, publication: 'not_requested' });
      }
      throw error;
    }
    requireValue(observed['confirmed'] === true, 'LANDING_RECEIPT_UNCONFIRMED', 'No original candidate-specific receipt confirms this landing. Inspect the original blocker; do not replay integration.', 3);
    const runtime = await this.runtimes.resolve(repo, repo.path);
    const guard = await run(runtime.node, [join(repo.path, 'scripts/pre-push-worktree-guard.mjs'), '--target-ref', repo.config.integration.branch, '--worktree', sourcePath],
      { ...options, cwd: repo.path, env: this.environment(runtime), timeoutMs: 60000 });
    requireValue(guard.code === 0, 'LANDING_SOURCE_GUARD_FAILED', 'The original source-worktree completion guard requires attention after integration.', 3);
    await clean(repo.path);
    const receipt = object(observed['receipt']), landedTip = string(observed['landedTip'], 'landed tip');
    const capture = this.store.record<{ commits: string[] }>('capture', op.requestId);
    const result = { sourceTip: selected.sourceTip, sourceBase: selected.base, sourceCommits: capture?.commits ?? [], landedTip,
      target: receipt['target_sha'] ?? null, originalReceipt: receipt, validation: receipt['validation_status'], adapter: repo.config.integration.adapter,
      integration: 'landed', exitCode: 0, ...(repo.config.integration.adapter === 'mathy-v1' ? { nativeReconciliation: { state: 'passed', landedTip } } : {}),
      publication: 'not_requested', sourceWorkspace: { path: selected.sourcePath, owner: 'native_task', retained: true },
      capturedSource: snapshot ? { path: snapshot.directory, owner: 'contribution', tip: snapshot.tip, retained: true } : null };
    this.store.put('landing', digest({ repositoryId: repo.id, tip: selected.sourceTip, base: selected.base }), result); return result;
  }
  async land(op: Operation, repo: Enrolled, options: RunOptions): Promise<ObjectValue> {
    const selected = await this.selected(op, repo);
    let native = false;
    try { const source = await identity(selected.sourcePath); native = source.commonDir === repo.commonDir && source.tip === selected.sourceTip && !source.branch && (await gitText(selected.sourcePath, ['status', '--porcelain=v1'])).length === 0; } catch { /* A retained committed source can outlive its native workspace. */ }
    await clean(repo.path);
    const prior = await this.inspect(repo, selected.sourcePath, selected.sourceTip, 'receipt', options, { retainedCandidate: this.store.record('adoptedLandingCandidate', op.operationId) ?? selected.originalCandidate ?? null });
    if (prior['confirmed'] === true) return { ...await this.reconcile(op, repo, options), reused: true };
    requireValue(!op.effectDispatched, 'LANDING_RECONCILIATION_REQUIRED', 'This original landing was already dispatched. Reconcile its retained receipt before any other integration.', 6);
    requireValue(await gitText(repo.path, ['merge-base', repo.config.integration.branch, selected.sourceTip]) === selected.base, 'SOURCE_RANGE_CHANGED', 'The original integration range changed while queued.', 3);
    let snapshot: Snapshot | undefined;
    if (native) await this.inspect(repo, selected.sourcePath, selected.sourceTip, 'source', options);
    else snapshot = await this.snapshot(op, repo, selected, options);
    const executionSource = snapshot?.directory ?? selected.canonicalSourcePath;
    let sourcePolicy = await this.inspect(repo, executionSource, selected.sourceTip, 'queue-preview', options, { originalSource: selected.canonicalSourcePath });
    const runtime = await this.runtimes.resolve(repo, repo.path), args = snapshot ? [join(repo.path, 'scripts/worktree-landing-worker'), '--candidate', selected.sourceTip] : [join(repo.path, 'scripts/worktree-land'), '--worktree', selected.sourcePath];
    const metadata = object(op.input['metadata']);
    if (repo.config.integration.adapter === 'mathy-v1' && typeof metadata['integrationMessage'] === 'string') {
      const directory = join(this.store.directory, 'adopted-landings', op.attemptId); mkdirSync(directory, { recursive: true, mode: 0o700 });
      const path = join(directory, 'message.txt'), text = metadata['integrationMessage'] + '\n';
      if (!existsSync(path)) writeFileSync(path, text, { flag: 'wx', mode: 0o600 });
      requireValue(readFileSync(path, 'utf8') === text, 'LANDING_MESSAGE_CHANGED', 'The retained project integration message changed.', 3);
      const fd = openSync(path, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); }
      args.push('--message-file', path);
    }
    const inventory = policyInventory(repo.path, repo.config.integration.adapter);
    {
      const flight = new LegacyLandingFlight(repo.commonDir, selected.sourceTip, string(sourcePolicy['requirementsDigest'], 'original requirements digest'));
      try {
        const claim = flight.tryAcquire(); requireValue(claim.status === 'acquired', 'LANDING_COORDINATION_BUSY', 'An original worker or retained queue owns this candidate. Its candidate metadata is preserved; reconcile or retry after it drains.', 3);
        // The legacy queue can be consumed by another cooperating worker as
        // soon as this flight releases, even if our own child never starts.
        this.store.update(this.store.get(op.operationId), { effectDispatched: true, stage: 'registering_captured_source' });
        this.store.put('adoptedSnapshotQueue', op.operationId, { phase: 'registering', source: snapshot ?? null, originalScope: sourcePolicy['scope'] });
        const queued = await this.inspect(repo, executionSource, selected.sourceTip, 'queue', options, { originalSource: selected.canonicalSourcePath, scopeDigest: sourcePolicy['scopeDigest'], captured: Boolean(snapshot) });
        this.store.put('adoptedSnapshotQueue', op.operationId, { phase: 'registered', source: snapshot ?? null, ...queued });
        this.store.put('adoptedLandingCandidate', op.operationId, queued['queued']);
        sourcePolicy = { candidate: queued['queued'] };
      } finally { flight.release(); }
      if (snapshot) this.store.log(op, '[captured source] The original task remains untouched. This separately registered Git snapshot is owned by Contribution, including when original worker text calls a source workspace Codex-owned.\n');
    }
    await this.selected(op, repo);
    this.store.update(this.store.get(op.operationId), { effectDispatched: true, stage: 'original_project_landing', result: { ...this.store.get(op.operationId).result, originalLanding: { adapter: inventory.policy.id, sourceTip: selected.sourceTip, policyDigest: digest(inventory.files) } } });
    const environment = this.environment(runtime), candidate = sourcePolicy['candidate'] as ObjectValue | null;
    if (candidate && typeof candidate['task_id'] === 'string') environment['CODEX_THREAD_ID'] = candidate['task_id'];
    const worker = await run(runtime.node, args, { ...options, cwd: repo.path, env: environment, timeoutMs: 60 * 60 * 1000 });
    this.store.put('adoptedLandingExit', op.operationId, { exitCode: worker.code, cancelled: worker.cancelled, timedOut: worker.timedOut, observedAt: now() });
    // Even a nonzero worker can have promoted before native reconciliation or
    // source verification failed. Only the original receipt+guard prove success.
    try { return { ...await this.reconcile(op, repo, { output: text => this.store.log(op, text) }), workerExit: worker.code }; }
    catch (error) {
      if (error instanceof Fault && error.code === 'LANDED_RECONCILIATION_FAILED') throw new Fault(error.code, error.message, error.exit, { ...error.details, workerExit: worker.code });
      throw new Fault('LANDING_RECONCILIATION_REQUIRED', 'The original worker stopped without a fully verified receipt and completion guard. Inspect its retained output and original repair path; Contribution will not replay it.', 6, { workerExit: worker.code });
    }
  }
}
