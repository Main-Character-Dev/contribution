import { mkdirSync, writeFileSync, existsSync, readFileSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { policyInventory } from '@contribution/adapters';
import type { Journal, Operation } from './journal.js';
import type { Enrolled } from './repositories.js';
import type { ObjectValue } from './core.js';
import { digest, object, requireValue, string, Fault, now } from './core.js';
import { clean, identity, gitText } from './git.js';
import { run } from './process.js';
import type { RunOptions } from './process.js';
import { ProjectRuntimes } from './project-runtime.js';
import type { AdoptedHooks } from './adopted-hooks.js';

// Execute reviewed project exports with the project's registered runtime. No
// repository source is copied into Contribution or replaced by generic policy.
const probe = String.raw`
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const input = JSON.parse(readFileSync(0, 'utf8'));
const git = args => execFileSync('/usr/bin/git', args, { cwd: input.primary, encoding: 'utf8', timeout: 10000 }).trim();
const state = await import(pathToFileURL(join(input.primary, 'scripts/lib/worktree-landing-state.mjs')));
const entry = await import(pathToFileURL(join(input.primary, 'scripts/worktree-land')));
const candidate = state.readLandingCandidate(input.primary, input.tip);
let result;
if (input.action === 'source') {
  state.assertManagedLandingSourceWorktree({ worktreePath: input.source, primaryRepoRoot: input.primary, candidateShas: [input.tip, ...(candidate?.supersedes ?? [])] });
  result = { sourceEligible: true, candidate: candidate ?? null };
} else {
  const receipt = state.readLandingValidationReceipt(input.primary, input.tip);
  if (!receipt) result = { confirmed: false, reason: 'NO_LANDING_RECEIPT' };
  else {
    const contains = sha => { try { git(['merge-base', '--is-ancestor', sha, input.branch]); return true; } catch { return false; } };
    const options = { candidateSha: input.tip, receipt, targetContainsSha: contains, resolveTreeSha: sha => git(['rev-parse', sha + '^{tree}']) };
    if (input.adapter === 'mathy-v1') {
      if (receipt.reconciliation_status !== 'passed') throw Error('Primary native reconciliation is incomplete; run the original project repair, not another landing.');
      if (!candidate) throw Error('Mathy candidate requirements are unavailable.');
      options.landedIdentity = state.resolveCanonicalLandingForCandidate(input.primary, git(['rev-parse', input.branch]), candidate);
      options.checksCommand = 'pnpm test:changed'; options.requiredUITestSelectors = candidate.required_ui_test_selectors ?? [];
    }
    const landedTip = entry.resolveLandedCandidateSha(options);
    result = { confirmed: true, landedTip, receipt, candidate: candidate ?? null };
  }
}
process.stdout.write('\nCONTRIBUTION_LANDING_RESULT=' + JSON.stringify(result) + '\n');
`;

interface Selection { adoptionDigest: string; sourcePath: string; sourceTip: string; base: string; selectedAt: string }
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
  private async inspect(repo: Enrolled, sourcePath: string, tip: string, action: 'source' | 'receipt', options: RunOptions = {}): Promise<ObjectValue> {
    const runtime = await this.runtimes.resolve(repo, repo.path);
    const result = await run(runtime.node, ['--input-type=module', '--eval', probe], { ...options, cwd: repo.path, env: this.environment(runtime), timeoutMs: 30000,
      input: JSON.stringify({ primary: repo.path, source: sourcePath, tip, branch: repo.config.integration.branch, adapter: repo.config.integration.adapter, action }) });
    requireValue(result.code === 0, action === 'source' ? 'SOURCE_OWNERSHIP_REQUIRED' : 'LANDING_RECEIPT_UNCONFIRMED',
      action === 'source' ? 'The original project policy did not accept this native task source.' : 'The original project receipt validator did not confirm integration and required reconciliation.', 3);
    const marker = '\nCONTRIBUTION_LANDING_RESULT=', lines = result.stdout.split(marker);
    requireValue(lines.length === 2, 'LANDING_PROBE_INVALID', 'The project adapter returned no unique structured observation.', 3);
    try { return object(JSON.parse(lines[1]!.trim())); } catch { throw new Fault('LANDING_PROBE_INVALID', 'The project adapter returned invalid receipt data.', 3); }
  }
  async capture(repo: Enrolled, requestId: string, sourcePath: string, tip: string, base: string, metadata: ObjectValue): Promise<void> {
    const adoption = await this.hooks.verify(repo), info = await identity(sourcePath);
    requireValue(!info.branch, 'SOURCE_OWNERSHIP_REQUIRED', 'This project requires a detached native task source.', 3);
    requireValue((await gitText(sourcePath, ['status', '--porcelain=v1'])).length === 0, 'ADOPTED_CAPTURE_REQUIRED', 'Preserve unrelated task edits. This original native landing route requires a clean task; an imported committed-snapshot adapter is still required for dirty tasks.', 3);
    requireValue(await gitText(repo.path, ['merge-base', repo.config.integration.branch, tip]) === base, 'SOURCE_RANGE_CHANGED', 'The submitted base differs from the original project worker’s current integration range.', 3);
    if (repo.config.integration.adapter === 'mathy-v1') {
      const count = Number(await gitText(sourcePath, ['rev-list', '--count', `${base}..${tip}`]));
      requireValue(count === 1 || (typeof metadata['integrationMessage'] === 'string' && metadata['integrationMessage'].trim()), 'NEEDS_INPUT', 'Mathy requires an explicit combined message for a multi-commit task.', 2);
    } else requireValue(metadata['integrationMessage'] === undefined, 'PROJECT_MESSAGE_POLICY', 'This project owns its integration message. Submit without a generic message override.', 2);
    await this.inspect(repo, sourcePath, tip, 'source');
    const selected: Selection = { adoptionDigest: digest(adoption), sourcePath, sourceTip: tip, base, selectedAt: now() };
    this.store.put('adoptedLandingSelection', requestId, selected);
  }
  private async selected(op: Operation, repo: Enrolled): Promise<Selection> {
    const selected = this.store.record<Selection>('adoptedLandingSelection', op.requestId);
    requireValue(selected && selected.sourcePath === op.input['sourcePath'] && selected.sourceTip === op.input['tip'] && selected.base === op.input['base'], 'ADOPTED_CAPTURE_REQUIRED', 'The original source-policy selection is missing; preserve the captured history.', 3);
    requireValue(selected.adoptionDigest === digest(await this.hooks.verify(repo)), 'ADOPTED_POLICY_CHANGED', 'The reviewed original adapter changed after source capture.', 3);
    return selected;
  }
  async reconcile(op: Operation, repo: Enrolled, options: RunOptions = {}): Promise<ObjectValue> {
    const selected = await this.selected(op, repo), observed = await this.inspect(repo, selected.sourcePath, selected.sourceTip, 'receipt', options);
    requireValue(observed['confirmed'] === true, 'LANDING_RECEIPT_UNCONFIRMED', 'No original candidate-specific receipt confirms this landing. Inspect the original blocker; do not replay integration.', 3);
    const runtime = await this.runtimes.resolve(repo, repo.path);
    const guard = await run(runtime.node, [join(repo.path, 'scripts/pre-push-worktree-guard.mjs'), '--target-ref', repo.config.integration.branch, '--worktree', selected.sourcePath],
      { ...options, cwd: repo.path, env: this.environment(runtime), timeoutMs: 60000 });
    requireValue(guard.code === 0, 'LANDING_SOURCE_GUARD_FAILED', 'The original source-worktree completion guard requires attention after integration.', 3);
    await clean(repo.path);
    const receipt = object(observed['receipt']), landedTip = string(observed['landedTip'], 'landed tip');
    const capture = this.store.record<{ commits: string[] }>('capture', op.requestId);
    const result = { sourceTip: selected.sourceTip, sourceBase: selected.base, sourceCommits: capture?.commits ?? [], landedTip,
      target: receipt['target_sha'] ?? null, originalReceipt: receipt, validation: receipt['validation_status'], adapter: repo.config.integration.adapter,
      publication: 'not_requested', sourceWorkspace: { path: selected.sourcePath, owner: 'native_task', retained: true } };
    this.store.put('landing', digest({ repositoryId: repo.id, tip: selected.sourceTip, base: selected.base }), result); return result;
  }
  async land(op: Operation, repo: Enrolled, options: RunOptions): Promise<ObjectValue> {
    const selected = await this.selected(op, repo), source = await identity(selected.sourcePath);
    requireValue(source.commonDir === repo.commonDir && source.tip === selected.sourceTip && !source.branch, 'SOURCE_CHANGED', 'The queued native task changed. Its captured commits and current workspace remain retained.', 3);
    requireValue((await gitText(selected.sourcePath, ['status', '--porcelain=v1'])).length === 0, 'ADOPTED_CAPTURE_REQUIRED', 'New task edits are preserved. The original native worker cannot run against a dirty task.', 3);
    await clean(repo.path);
    const prior = await this.inspect(repo, selected.sourcePath, selected.sourceTip, 'receipt', options);
    if (prior['confirmed'] === true) return { ...await this.reconcile(op, repo, options), reused: true };
    requireValue(!op.effectDispatched, 'LANDING_RECONCILIATION_REQUIRED', 'This original landing was already dispatched. Reconcile its retained receipt before any other integration.', 6);
    requireValue(await gitText(repo.path, ['merge-base', repo.config.integration.branch, selected.sourceTip]) === selected.base, 'SOURCE_RANGE_CHANGED', 'The original integration range changed while queued.', 3);
    const sourcePolicy = await this.inspect(repo, selected.sourcePath, selected.sourceTip, 'source', options);
    const runtime = await this.runtimes.resolve(repo, repo.path), args = [join(repo.path, 'scripts/worktree-land'), '--worktree', selected.sourcePath];
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
    this.store.update(this.store.get(op.operationId), { effectDispatched: true, stage: 'original_project_landing', result: { ...this.store.get(op.operationId).result, originalLanding: { adapter: inventory.policy.id, sourceTip: selected.sourceTip, policyDigest: digest(inventory.files) } } });
    const environment = this.environment(runtime), candidate = sourcePolicy['candidate'] as ObjectValue | null;
    if (candidate && typeof candidate['task_id'] === 'string') environment['CODEX_THREAD_ID'] = candidate['task_id'];
    const worker = await run(runtime.node, args, { ...options, cwd: repo.path, env: environment, timeoutMs: 60 * 60 * 1000 });
    this.store.put('adoptedLandingExit', op.operationId, { exitCode: worker.code, cancelled: worker.cancelled, timedOut: worker.timedOut, observedAt: now() });
    // Even a nonzero worker can have promoted before native reconciliation or
    // source verification failed. Only the original receipt+guard prove success.
    try { return { ...await this.reconcile(op, repo, { output: text => this.store.log(op, text) }), workerExit: worker.code }; }
    catch { throw new Fault('LANDING_RECONCILIATION_REQUIRED', 'The original worker stopped without a fully verified receipt and completion guard. Inspect its retained output and original repair path; Contribution will not replay it.', 6, { workerExit: worker.code }); }
  }
}
