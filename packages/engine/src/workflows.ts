import { mkdirSync, readFileSync, writeFileSync, existsSync, openSync, closeSync, fsyncSync } from 'node:fs';
import { join } from 'node:path';
import { Journal } from './journal.js';
import type { Operation } from './journal.js';
import { Repositories } from './repositories.js';
import type { Enrolled } from './repositories.js';
import { digest, Fault, id, now, requireValue, string, object } from './core.js';
import type { ObjectValue } from './core.js';
import { clean, git, gitText, identity, oid, ordinaryHistory, contained, inputFingerprint } from './git.js';
import { Lease, executable, processIdentity, run } from './process.js';
import type { RunOptions } from './process.js';
import type { Payload } from './payload.js';

interface PushScope { repositoryId: string; branch: string; tip: string; remote: string; destination: string; ref: string; policy: string }
const quote = (word: string): string => "'" + word.replaceAll("'", "'\\''") + "'";
export class Workflows {
  constructor(readonly store: Journal, readonly repos: Repositories, readonly payload: Payload) {}
  async scope(repo: Enrolled): Promise<PushScope> {
    await this.repos.current(repo);
    requireValue(repo.canonicalHostId === this.store.hostId, 'CANONICAL_OWNER_REQUIRED', 'Publish through the enrolled canonical owner.');
    const info = await identity(repo.path); requireValue(info.tip, 'UNBORN_REPOSITORY', 'Initialize this repository before publishing.', 3);
    const { remote, branch } = repo.config.publication;
    requireValue(remote && branch && !remote.startsWith('-') && !branch.startsWith('-'), 'DESTINATION_UNCONFIGURED', 'Configure an explicit publication remote and branch.', 3);
    requireValue((await git(repo.path, ['check-ref-format', `refs/heads/${branch}`])).code === 0, 'INVALID_DESTINATION', 'Publication branch is invalid.', 2);
    const urls = (await gitText(repo.path, ['remote', 'get-url', '--push', '--all', remote])).split('\n');
    requireValue(urls.length === 1 && urls[0] && !urls[0].startsWith('-') && !urls[0].includes('::') && !/^https?:\/\/[^/]+:[^/]+@/.test(urls[0]),
      'UNSUPPORTED_DESTINATION', 'Use one credential-free Git destination with a supported credential helper.', 2);
    return { repositoryId: repo.id, branch: repo.config.integration.branch, tip: info.tip, remote, destination: urls[0], ref: `refs/heads/${branch}`, policy: repo.revision };
  }
  async preview(repo: Enrolled): Promise<ObjectValue> {
    const scope = await this.scope(repo), scopeToken = id();
    this.store.put('preview', scopeToken, scope);
    return { scopeToken, expectedTip: scope.tip, scope, status: await this.repos.status(repo, true), gate: repo.config.validation.gate };
  }
  async pushInput(repo: Enrolled, expectedTip: string, token: string, requestId: string): Promise<ObjectValue> {
    const scope = this.store.record<PushScope>('preview', token);
    requireValue(scope && scope.repositoryId === repo.id && scope.tip === expectedTip, 'STALE_PUSH_SELECTION', 'Preview and expected tip do not identify this publication.');
    if (this.store.existing(requestId, 'push', repo.id, { scope })) return { scope };
    const current = await this.scope(repo);
    requireValue(digest(scope) === digest(current), 'STALE_PUSH_SELECTION', 'The branch, tip, destination or policy changed. Obtain a new preview.');
    return { scope };
  }
  async capture(repo: Enrolled, requestId: string, sourcePath: string, tip: string, base: string, metadata: ObjectValue): Promise<Operation> {
    const input = { sourcePath, tip, base, metadata, policy: repo.revision };
    const prior = this.store.existing(requestId, 'submit', repo.id, input); if (prior) return prior;
    requireValue(repo.config.integration.adapter === 'generic-v1', 'ADAPTER_MIGRATION_REQUIRED', 'This project requires its adopted source-ownership adapter before submission.', 3);
    const info = await identity(sourcePath); oid(tip, info.objectFormat); oid(base, info.objectFormat);
    requireValue(info.commonDir === repo.commonDir && info.tip === tip && info.path !== repo.path, 'SOURCE_OWNERSHIP_REQUIRED', 'Select the exact committed tip of a separate registered Git worktree in this enrolled clone.');
    await ordinaryHistory(sourcePath, tip);
    requireValue((await git(sourcePath, ['merge-base', '--is-ancestor', base, tip])).code === 0 && tip !== base, 'INVALID_SOURCE_RANGE', 'The declared base must precede the source tip.');
    requireValue((await gitText(sourcePath, ['rev-list', '--merges', `${base}..${tip}`])) === '', 'SOURCE_TOPOLOGY_UNSUPPORTED', 'This adapter requires a linear completed task range.');
    const commits = (await gitText(sourcePath, ['rev-list', '--reverse', `${base}..${tip}`])).split('\n');
    const authors = new Set((await gitText(sourcePath, ['log', '--format=%an <%ae>', `${base}..${tip}`])).split('\n'));
    requireValue(authors.size === 1, 'AUTHOR_POLICY_CONFLICT', 'The generic adapter requires one original source author.');
    requireValue(commits.length === 1 || (typeof metadata['integrationMessage'] === 'string' && metadata['integrationMessage'].trim()), 'NEEDS_INPUT', 'A multi-commit task requires an explicit combined integration message.', 2);
    const retention = `refs/contribution/outbox/${digest({ requestId })}`;
    await gitText(sourcePath, ['update-ref', retention, tip]);
    const directory = join(this.store.directory, 'transfers'); mkdirSync(directory, { recursive: true, mode: 0o700 });
    const bundle = join(directory, `${digest({ requestId })}.bundle`);
    if (!existsSync(bundle)) await gitText(sourcePath, ['bundle', 'create', bundle, retention]);
    await gitText(sourcePath, ['bundle', 'verify', bundle]);
    const file = openSync(bundle, 'r'); fsyncSync(file); closeSync(file);
    this.store.put('capture', requestId, { retention, bundle, commits, tip, base, bundleDigest: digest(readFileSync(bundle)), acceptedAt: now() });
    return this.store.admit(requestId, 'submit', repo.id, input, this.payload.identity, repo.canonicalHostId === this.store.hostId ? 'queued' : 'queued_local');
  }
  async initialize(op: Operation, repo: Enrolled): Promise<ObjectValue> {
    const info = await identity(repo.path); requireValue(!info.tip, 'HISTORY_ALREADY_EXISTS', 'Initialization never replaces existing history.');
    const generated: Record<string, string> = { 'contribution.json': JSON.stringify(repo.config, null, 2) + '\n',
      'CONTRIBUTION.md': '# Contribution workflow\n\nCommit task-owned work in a native task worktree. Submit completed commits through Contribution. Publication always requires an explicit Push request.\n' };
    for (const file of Object.keys(generated)) requireValue(!existsSync(join(repo.path, file)), 'GENERATED_FILE_CONFLICT', `Initialization will not overwrite ${file}.`);
    for (const key of ['user.name', 'user.email']) requireValue((await git(repo.path, ['config', '--get', key])).code === 0, 'GIT_IDENTITY_REQUIRED', 'Configure your Git author identity before initialization.', 3);
    const index = join(this.store.directory, `${op.attemptId}.index`), env = { GIT_INDEX_FILE: index };
    for (const [name, content] of Object.entries(generated)) writeFileSync(join(repo.path, name), content, { flag: 'wx' });
    await gitText(repo.path, ['read-tree', '--empty'], { env });
    await gitText(repo.path, ['add', '--', ...Object.keys(generated)], { env });
    const tree = await gitText(repo.path, ['write-tree'], { env });
    const tip = await gitText(repo.path, ['commit-tree', tree], { input: 'Initialize Contribution workflow\n' });
    this.store.update(this.store.get(op.operationId), { stage: 'promoting_bootstrap', effectDispatched: true, result: { bootstrapTip: tip } });
    await gitText(repo.path, ['update-ref', `refs/heads/${repo.config.integration.branch}`, tip, '0'.repeat(tip.length)]);
    // Stage only generated entries in the real index, preserving every other entry.
    await gitText(repo.path, ['add', '--', ...Object.keys(generated)]);
    this.repos.save({ ...repo, policySource: 'tracked' });
    return { bootstrapTip: tip, publication: 'not_requested' };
  }
  async landing(op: Operation, repo: Enrolled): Promise<ObjectValue> {
    await this.repos.current(repo); await clean(repo.path);
    requireValue(op.input['policy'] === repo.revision, 'POLICY_CHANGED', 'Source policy changed after capture.');
    const tip = string(op.input['tip'], 'tip'), base = string(op.input['base'], 'base'), metadata = object(op.input['metadata']);
    const sourceKey = digest({ repositoryId: repo.id, tip, base });
    const prior = this.store.record<ObjectValue>('landing', sourceKey); if (prior) return { ...prior, reused: true };
    const target = (await identity(repo.path)).tip; requireValue(target, 'SEED_RECEIPT_REQUIRED', 'Establish canonical bootstrap history before landing.', 3);
    requireValue((await git(repo.path, ['merge-base', '--is-ancestor', base, target])).code === 0, 'DIVERGENT_HISTORY', 'The task base is not part of canonical history. Reconcile both histories.');
    const candidate = join(this.store.directory, 'candidates', op.attemptId); mkdirSync(join(candidate, '..'), { recursive: true, mode: 0o700 });
    await gitText(repo.path, ['worktree', 'add', '--detach', candidate, target]);
    this.store.update(this.store.get(op.operationId), { stage: 'preparing_candidate', result: { candidate, target, sourceTip: tip } });
    const commits = (await gitText(repo.path, ['rev-list', '--reverse', `${base}..${tip}`])).split('\n');
    const applied = await git(candidate, ['cherry-pick', '--no-commit', ...commits], { timeoutMs: 60000, output: text => this.store.log(op, text) });
    requireValue(applied.code === 0, 'INTEGRATION_CONFLICT', 'The isolated candidate has conflicts and is retained for deliberate resolution.');
    const tree = await gitText(candidate, ['write-tree']);
    const [authorName, authorEmail, authorDate] = (await gitText(repo.path, ['show', '-s', '--format=%an%x00%ae%x00%aI', tip])).split('\0');
    const message = typeof metadata['integrationMessage'] === 'string' ? metadata['integrationMessage'] : await gitText(repo.path, ['show', '-s', '--format=%B', tip]);
    const landedTip = await gitText(candidate, ['commit-tree', tree, '-p', target], { input: message + '\n', env: { GIT_AUTHOR_NAME: authorName, GIT_AUTHOR_EMAIL: authorEmail, GIT_AUTHOR_DATE: authorDate } });
    await gitText(repo.path, ['update-ref', `refs/contribution/candidates/${op.attemptId}`, landedTip]);
    const receipt = { sourceTip: tip, sourceBase: base, sourceCommits: commits, provisionalTip: landedTip, landedTip, target, candidate, validation: 'not_run', publication: 'not_requested' };
    this.store.update(this.store.get(op.operationId), { stage: 'promoting', effectDispatched: true, result: receipt });
    await this.repos.current(repo); await clean(repo.path);
    requireValue((await identity(repo.path)).tip === target, 'CANONICAL_TIP_CHANGED', 'The primary advanced during candidate preparation; retain this candidate for reconciliation.');
    await gitText(repo.path, ['merge', '--ff-only', '--no-overwrite-ignore', landedTip]);
    requireValue((await identity(repo.path)).tip === landedTip, 'PROMOTION_UNCERTAIN', 'Primary promotion requires reconciliation.', 6);
    this.store.put('landing', sourceKey, receipt); return receipt;
  }
  options(op: Operation, signal: AbortSignal): RunOptions {
    return { signal, output: text => this.store.log(op, text), started: (pid, start) => {
      const latest = this.store.get(op.operationId);
      this.store.update(latest, { result: { ...latest.result, processes: [...(latest.result['processes'] as ObjectValue[] ?? []), { pid, start }] } }, 'process.started');
    } };
  }
  async checks(op: Operation, repo: Enrolled, sourcePath: string, signal: AbortSignal, gate = false): Promise<ObjectValue> {
    const info = await identity(sourcePath); requireValue(info.commonDir === repo.commonDir, 'SOURCE_OWNERSHIP_REQUIRED', 'Check source must belong to this enrolled clone.');
    if (gate && repo.config.validation.gate === 'inactive') return { state: 'inactive', checks: [], sourceTip: info.tip };
    requireValue(repo.config.validation.adapter === 'generic-v1', 'ADAPTER_MIGRATION_REQUIRED', 'Existing project checks require their preserved adapter.', 3);
    await clean(sourcePath); const before = await inputFingerprint(sourcePath);
    const selected = repo.config.validation.checks.filter(check => check.profiles.includes(repo.config.validation.profile) && (!op.input['checkId'] || check.id === op.input['checkId']));
    requireValue(!op.input['checkId'] || selected.length === 1, 'CHECK_NOT_SELECTED', 'The requested check is not configured for this profile.', 2);
    requireValue(repo.config.validation.builtins.length === 0, 'BUILTIN_UNSUPPORTED', 'An unrecognized built-in must be implemented before this gate can run.', 3);
    requireValue(selected.length > 0, 'CHECKS_UNCONFIGURED', 'No checks are configured for this source/profile.', 3);
    const results: ObjectValue[] = [];
    for (const check of selected) {
      const name = check.argv[0]!;
      let command = executable(name);
      // Never inherit the bundled runtime as the project runtime.
      if (['node', 'pnpm', 'npm', 'npx'].includes(name)) {
        const runtime = this.store.record<{ executable: string; version: string }>('projectRuntime', `${repo.id}:${name}`);
        requireValue(runtime, 'PROJECT_RUNTIME_REQUIRED', 'Register the project-pinned runtime through its adapter before running JavaScript checks.', 3);
        command = runtime.executable;
        requireValue((await run(command, ['--version'])).stdout.trim().replace(/^v/, '') === runtime.version, 'PROJECT_RUNTIME_CHANGED', 'The selected project runtime no longer matches its verified pin.', 3);
      }
      this.store.log(op, `\n[${check.id}] started\n`);
      const result = await run(command, check.argv.slice(1), { ...this.options(op, signal), cwd: contained(sourcePath, check.cwd), timeoutMs: Math.min(check.timeoutSeconds, 86400) * 1000 });
      const state = result.cancelled ? 'cancelled' : result.timedOut ? 'timed_out' : result.code === 0 ? 'passed' : 'failed';
      results.push({ id: check.id, state, exitCode: result.code });
      const latest = this.store.get(op.operationId); this.store.update(latest, { result: { ...latest.result, checks: results } }, 'check.completed');
      if (state !== 'passed') throw new Fault(state === 'cancelled' ? 'CANCELLED' : 'CHECK_FAILED', `Check ${check.id} ${state}.`, state === 'cancelled' ? 130 : 5, { checks: results });
    }
    requireValue(await inputFingerprint(sourcePath) === before, 'CHECK_INPUT_CHANGED', 'Inputs changed during checks; results are not reusable proof.');
    return { state: 'passed', checks: results, sourceTip: info.tip, inputDigest: before, reuse: 'never' };
  }
  async ensureHook(repo: Enrolled): Promise<void> {
    requireValue(repo.config.integration.adapter === 'generic-v1', 'ADAPTER_MIGRATION_REQUIRED', 'Existing hook ownership must be adopted before managed publication.', 3);
    const config = await git(repo.path, ['config', '--get', 'core.hooksPath']);
    requireValue(config.code === 1, 'EXISTING_HOOK_OWNER', 'Preserve the configured hook dispatcher; adopt its adapter before publication.', 3);
    const path = await gitText(repo.path, ['rev-parse', '--path-format=absolute', '--git-path', 'hooks/pre-push']);
    const content = `#!/bin/sh\n# Contribution managed pre-push v1\nexec ${quote(this.payload.node)} ${quote(this.payload.cli)} hook pre-push --repo ${quote(repo.id)} --state-dir ${quote(this.store.directory)} --remote "$1" --url "$2"\n`;
    if (existsSync(path)) requireValue(readFileSync(path, 'utf8') === content, 'EXISTING_HOOK_OWNER', 'Existing pre-push content differs; do not replace its policy.', 3);
    else { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, content, { mode: 0o755, flag: 'wx' }); }
    this.store.put('hook', repo.id, { path, digest: digest(content) });
  }
  async push(op: Operation, repo: Enrolled, signal: AbortSignal, lease: Lease): Promise<ObjectValue> {
    const scope = op.input['scope'] as unknown as PushScope;
    requireValue(digest(await this.scope(repo)) === digest(scope), 'STALE_PUSH_SELECTION', 'Publication scope changed while queued. A new preview is required.');
    await clean(repo.path); await this.ensureHook(repo);
    const status = await this.repos.status(repo, true); const publication = status['publication'] as ObjectValue;
    requireValue(publication['relation'] !== 'unknown', 'REMOTE_OBSERVATION_FAILED', 'Cannot establish the destination before publication.', 3);
    if (publication['relation'] === 'equal') return { delivery: 'up_to_date', gate: { state: 'not_run' }, remoteTip: scope.tip };
    requireValue(!['behind', 'diverged'].includes(String(publication['relation'])), 'REMOTE_DIVERGED', 'Reconcile destination history before publication.');
    const hookToken = id();
    this.store.put('hookInvocation', op.operationId, { hookToken, lease: lease.owner, scope, remoteBefore: publication['remoteTip'], invoked: false });
    this.store.update(this.store.get(op.operationId), { stage: 'git_push', effectDispatched: true });
    const result = await git(repo.path, ['push', '--porcelain', scope.remote, `refs/heads/${scope.branch}:${scope.ref}`], {
      ...this.options(op, signal), timeoutMs: 60 * 60 * 1000,
      env: { CONTRIBUTION_OPERATION_ID: op.operationId, CONTRIBUTION_HOOK_TOKEN: hookToken } });
    const gate = this.store.record<ObjectValue>('gate', op.operationId) ?? { state: 'not_run' };
    const observed = await git(repo.path, ['ls-remote', '--exit-code', scope.destination, scope.ref], { timeoutMs: 15000 });
    const remoteTip = observed.code === 0 ? observed.stdout.split('\t')[0]?.trim() : null;
    if (result.code === 0 && remoteTip === scope.tip) return { delivery: 'delivered', gate, remoteTip, observedBy: 'outer_git_and_remote_ref', gitExit: result.code };
    if (remoteTip === scope.tip) return { delivery: 'delivered', gate, remoteTip, observedBy: 'remote_ref_reconciliation', gitExit: result.code };
    const details = { gate, remoteTip, gitExit: result.code, delivery: 'unknown' };
    if (gate['state'] === 'failed' || gate['state'] === 'cancelled') throw new Fault('GATE_FAILED', 'The publication gate prevented delivery.', 5, { ...details, delivery: 'not_delivered' });
    if (gate['state'] === 'not_run' || /^!\t/m.test(result.stdout)) throw new Fault('PUSH_FAILED', 'Git refused publication before delivery; retained gate and transport outcomes are separate.', result.cancelled ? 130 : 5, { ...details, delivery: 'not_delivered' });
    throw new Fault('OUTCOME_UNCERTAIN', 'The remote may have accepted the push. Reconcile its ref before another publication.', 6, details);
  }
  async externalHook(repo: Enrolled, args: ObjectValue, op: Operation, signal: AbortSignal): Promise<ObjectValue> {
    const scope = await this.scope(repo);
    requireValue(args['remote'] === scope.remote && args['url'] === scope.destination, 'DESTINATION_CHANGED', 'External publication does not match the enrolled destination.');
    const lines = string(args['stdin'], 'hook input').trim().split('\n');
    requireValue(lines.length === 1, 'REF_TRANSACTION_UNSUPPORTED', 'This adapter supports one enrolled branch.');
    const fields = lines[0]!.split(/\s+/);
    requireValue(fields.length === 4 && fields[0] === `refs/heads/${scope.branch}` && fields[1] === scope.tip && fields[2] === scope.ref, 'REF_TRANSACTION_UNSUPPORTED', 'The external ref transaction does not match enrolled policy.');
    const gate = await this.checks(op, repo, repo.path, signal, true);
    requireValue(digest(scope) === digest(await this.scope(repo)), 'STALE_PUSH_SELECTION', 'The source or destination changed during external validation.');
    return { gate, delivery: 'unobserved', observation: 'pre_push_hook_only', sourceTip: scope.tip };
  }
  async hook(repo: Enrolled, args: ObjectValue, signal: AbortSignal): Promise<ObjectValue> {
    requireValue(repo.canonicalHostId === this.store.hostId, 'CANONICAL_OWNER_REQUIRED', 'Use Contribution Push on the canonical owner.');
    const operationId = string(args['operationId'], 'operationId');
    const op = this.store.get(operationId);
    const invocation = this.store.record<{ hookToken: string; lease: Lease['owner']; scope: PushScope; remoteBefore: string | null; invoked: boolean }>('hookInvocation', operationId);
    const owner = Lease.inspect(repo.commonDir);
    requireValue(invocation && owner && owner.token === invocation.lease.token && owner.attemptId === op.attemptId && owner.pid === process.pid && processIdentity(owner.pid) === owner.start &&
      args['hookToken'] === invocation.hookToken && !invocation.invoked && op.state === 'running' && op.kind === 'push' && args['remote'] === invocation.scope.remote && args['url'] === invocation.scope.destination,
    'HOOK_LEASE_INVALID', 'This hook has no verified managed invocation lease.');
    const lines = string(args['stdin'], 'hook input').trim().split('\n'); requireValue(lines.length === 1, 'REF_TRANSACTION_UNSUPPORTED', 'Only one enrolled branch may be published.');
    const fields = lines[0]!.split(/\s+/);
    requireValue(fields.length === 4 && fields[0] === `refs/heads/${invocation.scope.branch}` && fields[1] === invocation.scope.tip && fields[2] === invocation.scope.ref && fields[3] === (invocation.remoteBefore ?? '0'.repeat(invocation.scope.tip.length)), 'STALE_PUSH_SELECTION', 'The hook ref transaction differs from the previewed destination state.');
    invocation.invoked = true; this.store.put('hookInvocation', operationId, invocation);
    try {
      const gate = await this.checks(op, repo, repo.path, signal, true);
      requireValue(digest(await this.scope(repo)) === digest(invocation.scope), 'STALE_PUSH_SELECTION', 'Publication inputs changed during the gate.');
      const currentRemote = await git(repo.path, ['ls-remote', '--exit-code', invocation.scope.destination, invocation.scope.ref], { timeoutMs: 15000 });
      requireValue((currentRemote.code === 2 && !invocation.remoteBefore) || (currentRemote.code === 0 && currentRemote.stdout.split('\t')[0] === invocation.remoteBefore), 'REMOTE_CHANGED', 'The destination advanced during the gate.');
      this.store.put('gate', operationId, gate); return gate;
    } catch (error) {
      this.store.put('gate', operationId, { state: signal.aborted ? 'cancelled' : 'failed', code: error instanceof Fault ? error.code : 'CHECK_FAILED' }); throw error;
    }
  }
}
