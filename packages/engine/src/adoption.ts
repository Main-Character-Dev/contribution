import { constants, openSync, closeSync, fstatSync, readSync, lstatSync, existsSync, realpathSync, writeFileSync, renameSync, unlinkSync, fsyncSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { assertContract } from '@contribution/contracts';
import { identifyAdoption, policyInventory, reportingPatch, leaseBridgePatch } from '@contribution/adapters';
import type { Repository } from '@contribution/contracts';
import type { Journal } from './journal.js';
import type { Enrolled, Repositories } from './repositories.js';
import type { ObjectValue } from './core.js';
import { digest, id, now, requireValue } from './core.js';
import { git, gitText, identity, clean } from './git.js';
import { privateDirectory } from './private-files.js';
import { LegacyPrimaryLease } from './legacy-lease.js';
import { LegacyLandingFlight } from './legacy-flight.js';
import type { AdoptedHookRegistration } from './adopted-hooks.js';

interface Change { path: string; before: string | null; after: string; mode: number; beforeMode: number | null; beforeFile: string | null; afterFile: string }
interface Plan {
  id: string; requestId: string; repositoryId: string; adapter: string; before: Enrolled; config: Repository;
  sourceTip: string; sourceBranch: string; authorityDigest: string; inventory: Record<string, string | null>; createdAt: string;
  phase: 'prepared' | 'applying' | 'applied' | 'active' | 'rolling_back' | 'rolled_back';
  hooksPath: string; dispatcher: string; dispatcherDigest: string; dependencies: { path: string; digest: string }[];
  guard: string; originalHookDigest: string | null; changes: Change[];
}
const quote = (value: string): string => "'" + value.replaceAll("'", "'\\''") + "'";
const reporting: Record<string, string | null> = { 'mathy-v1': 'scripts/lib/pre-push-reporting.mjs', 'maincharacter-v1': null, 'roboty-v1': 'scripts/local-pre-push.mjs', 'glassalpha-v1': null };

/** Explicit source migration with private before/after snapshots. Applying a
 * proposal never commits or activates it; activation verifies the committed
 * tree and the existing dispatcher after cooperating writers have drained. */
export class Adoptions {
  private readonly busy = new Set<string>();
  isBusy(repositoryId: string): boolean { return this.busy.has(repositoryId); }
  constructor(readonly store: Journal, readonly repos: Repositories) {}
  private read(path: string): Buffer {
    const stat = lstatSync(path);
    requireValue(stat.isFile() && !stat.isSymbolicLink() && stat.uid === process.getuid?.() && stat.nlink === 1 && stat.size <= 4 * 1024 * 1024,
      'MIGRATION_SOURCE_UNSAFE', 'A migration source must remain a bounded, owned regular file.', 3);
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = fstatSync(fd); requireValue(before.dev === stat.dev && before.ino === stat.ino && before.size === stat.size, 'MIGRATION_SOURCE_CHANGED', 'A migration input changed while opening.');
      const result = Buffer.alloc(before.size + 1); let length = 0;
      while (length < result.length) { const size = readSync(fd, result, length, result.length - length, null); if (!size) break; length += size; }
      const after = fstatSync(fd); requireValue(length === before.size && after.size === before.size && after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs, 'MIGRATION_SOURCE_CHANGED', 'A migration input changed while reading.');
      return result.subarray(0, length);
    } finally { closeSync(fd); }
  }
  private sync(path: string): void { const fd = openSync(path, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } }
  private directory(planId: string): string { return join(this.store.directory, 'adoptions', planId); }
  private source(repo: Enrolled, path: string): string {
    requireValue(!path.startsWith('/') && !path.split('/').some(part => !part || part === '..' || part === '.'), 'MIGRATION_PATH_INVALID', 'Migration paths must stay inside the selected repository.');
    const target = join(repo.path, path), parent = realpathSync(dirname(target));
    requireValue(parent === repo.path || parent.startsWith(repo.path + '/'), 'MIGRATION_PATH_INVALID', 'Migration parents must stay in the selected repository.'); return target;
  }
  private snapshot(plan: Plan, change: Change, side: 'before' | 'after'): Buffer | null {
    const name = side === 'before' ? change.beforeFile : change.afterFile, expected = change[side];
    if (name === null) { requireValue(expected === null, 'MIGRATION_SNAPSHOT_CHANGED', 'A retained snapshot identity is inconsistent.'); return null; }
    const bytes = this.read(join(this.directory(plan.id), name)); requireValue(digest(bytes) === expected, 'MIGRATION_SNAPSHOT_CHANGED', 'The private reviewed source snapshot changed.'); return bytes;
  }
  private view(plan: Plan): ObjectValue {
    return { proposalId: plan.id, repositoryId: plan.repositoryId, adapter: plan.adapter, phase: plan.phase, sourceTip: plan.sourceTip, sourceBranch: plan.sourceBranch,
      expectedRevision: plan.before.revision, configurationRevision: digest(plan.config), gate: plan.config.validation.gate, hookOwner: plan.hooksPath,
      files: plan.changes.map(change => ({ path: change.path, before: change.before, after: change.after })), privateReviewDirectory: this.directory(plan.id),
      sourceCommitted: plan.phase === 'active', landingAdapter: 'not_activated_by_hook_adoption', mutation: plan.phase === 'prepared' ? 'none' : 'reviewed_files_only' };
  }
  inspect(repo: Enrolled, planId: string): ObjectValue { return this.view(this.plan(repo, planId)); }
  private plan(repo: Enrolled, planId: string): Plan {
    const plan = this.store.record<Plan>('adoptionPlan', planId); requireValue(plan?.repositoryId === repo.id, 'MIGRATION_PLAN_REQUIRED', 'Select a retained proposal belonging to this repository.', 3); return plan;
  }
  async prepare(repo: Enrolled, adapter: string, requestId: string): Promise<ObjectValue> {
    const prior = this.store.record<{ repositoryId: string; adapter: string; planId: string; completed: boolean }>('adoptionProposal', requestId);
    if (prior) {
      requireValue(prior.repositoryId === repo.id && prior.adapter === adapter, 'REQUEST_ID_CONFLICT', 'This proposal request already identifies another project or adapter.');
      requireValue(prior.completed, 'MIGRATION_PROPOSAL_PENDING', 'An interrupted proposal remains retained. Use a new identity to prepare a fresh review.', 3); return this.inspect(repo, prior.planId);
    }
    requireValue(identifyAdoption(repo.path)?.id === adapter && repo.config.integration.adapter === 'migration-required' && repo.config.validation.adapter === 'migration-required',
      'ADAPTER_SELECTION_MISMATCH', 'Only the inspected pending policy owner may be adopted by this initial migration.', 3);
    requireValue(!this.store.records<Plan>('adoptionPlan').some(value => value.repositoryId === repo.id && !['prepared', 'rolled_back'].includes(value.phase)), 'MIGRATION_PENDING', 'Reconcile or roll back the earlier adoption before preparing another.');
    const planId = id(); this.store.put('adoptionProposal', requestId, { repositoryId: repo.id, adapter, planId, completed: false });
    await this.repos.current(repo); await clean(repo.path); const source = await identity(repo.path), inventory = policyInventory(repo.path, adapter);
    requireValue(source.tip && source.branch && inventory.readyForParity && inventory.policy.gate === repo.config.validation.gate, 'MIGRATION_POLICY_CHANGED', 'Inspect a complete committed policy with its original gate activation.', 3);
    const hooksPath = await gitText(repo.path, ['config', '--get', 'core.hooksPath']);
    const dispatcher = await gitText(repo.path, ['rev-parse', '--path-format=absolute', '--git-path', 'hooks/pre-push']);
    const dispatcherBytes = this.read(dispatcher); requireValue((lstatSync(dispatcher).mode & 0o100) !== 0, 'MIGRATION_HOOK_UNAVAILABLE', 'The existing dispatcher must remain executable.');
    const guard = adapter === 'mathy-v1' ? '.githooks/pre-push' : '.husky/pre-push';
    const dependencies = adapter === 'mathy-v1' ? [] : [{ path: join(dirname(dispatcher), 'h'), digest: digest(this.read(join(dirname(dispatcher), 'h'))) }];
    requireValue(adapter === 'mathy-v1' ? realpathSync(dispatcher).startsWith(join(repo.commonDir, 'mathy/trusted-hooks') + '/') : realpathSync(dispatcher) === realpathSync(join(repo.path, '.husky/_/pre-push')),
      'MIGRATION_HOOK_OWNER_UNKNOWN', 'The existing hook is not the inspected trusted dispatcher or Husky owner.', 3);
    const config = structuredClone(repo.config); config.integration.adapter = adapter; config.validation.adapter = adapter; assertContract('repository', config);
    privateDirectory(join(this.store.directory, 'adoptions')); const directory = this.directory(planId); privateDirectory(directory);
    const plan: Plan = { id: planId, requestId, repositoryId: repo.id, adapter, before: repo, config, sourceTip: source.tip, sourceBranch: source.branch,
      authorityDigest: digest(this.store.record('authority', repo.id) ?? null), inventory: inventory.files, createdAt: now(), phase: 'prepared', hooksPath, dispatcher, dispatcherDigest: digest(dispatcherBytes), dependencies, guard, originalHookDigest: null, changes: [] };
    const originals = new Map<string, Buffer | null>();
    const add = (path: string, after: string, mode?: number): void => {
      const target = this.source(repo, path), before = existsSync(target) ? this.read(target) : null, next = Buffer.from(after), index = plan.changes.length;
      const beforeFile = before ? `${index}-before` : null, afterFile = `${index}-after`; originals.set(path, before);
      if (before) writeFileSync(join(directory, beforeFile!), before, { flag: 'wx', mode: 0o400 });
      writeFileSync(join(directory, afterFile), next, { flag: 'wx', mode: 0o400 });
      plan.changes.push({ path, before: before ? digest(before) : null, after: digest(next), mode: mode ?? (before ? lstatSync(target).mode & 0o777 : 0o644), beforeMode: before ? lstatSync(target).mode & 0o777 : null, beforeFile, afterFile });
    };
    const originalHook = existsSync(this.source(repo, guard)) ? this.read(this.source(repo, guard)) : null;
    requireValue(inventory.policy.gate === 'inactive' ? originalHook === null : originalHook !== null && originalHook.length <= 128 * 1024,
      'MIGRATION_GATE_CHANGED', 'An enabled original gate must be retained; an unexpected inactive hook requires explicit policy review.', 3);
    if (originalHook) { plan.originalHookDigest = digest(originalHook); writeFileSync(join(directory, 'original-pre-push'), originalHook, { flag: 'wx', mode: 0o400 }); }
    add(guard, `#!/bin/sh\n# Contribution adopted publication guard v1; original gate retained by the installed service.\nset -eu\nif [ -n "\${CONTRIBUTION_HOOK_TOKEN:-}" ]; then\n  exec "$CONTRIBUTION_BRIDGE_NODE" "$CONTRIBUTION_BRIDGE_CLI" hook adopted --repo ${quote(repo.id)} --state-dir "$CONTRIBUTION_BRIDGE_STATE" --remote "$1" --url "$2"\nfi\nexec "$HOME/.local/bin/contribution" hook adopted --repo ${quote(repo.id)} --remote "$1" --url "$2"\n`, 0o755);
    const leasePath = 'scripts/lib/primary-checkout-lease.mjs'; add(leasePath, leaseBridgePatch(this.read(this.source(repo, leasePath)).toString('utf8')));
    const reportingPath = reporting[adapter]; if (reportingPath) add(reportingPath, reportingPatch(adapter, this.read(this.source(repo, reportingPath)).toString('utf8')).source);
    add('contribution.json', JSON.stringify(config, null, 2) + '\n');
    for (const change of plan.changes) {
      const current = existsSync(this.source(repo, change.path)) ? this.read(this.source(repo, change.path)) : null;
      requireValue(current === null ? originals.get(change.path) === null : digest(current) === change.before, 'MIGRATION_SOURCE_CHANGED', 'Source changed while the proposal was prepared.');
      if (change.beforeFile) this.sync(join(directory, change.beforeFile)); this.sync(join(directory, change.afterFile));
    }
    if (originalHook) this.sync(join(directory, 'original-pre-push')); this.sync(directory); this.sync(dirname(directory));
    requireValue((await identity(repo.path)).tip === source.tip && digest(policyInventory(repo.path, adapter).files) === digest(plan.inventory), 'MIGRATION_SOURCE_CHANGED', 'Policy or HEAD changed while preparing the proposal.');
    this.store.transaction(() => { this.store.put('adoptionPlan', planId, plan); this.store.put('adoptionProposal', requestId, { repositoryId: repo.id, adapter, planId, completed: true }); });
    return this.view(plan);
  }
  private async ownerUnchanged(plan: Plan, repo: Enrolled): Promise<void> {
    requireValue(await gitText(repo.path, ['config', '--get', 'core.hooksPath']) === plan.hooksPath &&
      realpathSync(await gitText(repo.path, ['rev-parse', '--path-format=absolute', '--git-path', 'hooks/pre-push'])) === realpathSync(plan.dispatcher) &&
      digest(this.read(plan.dispatcher)) === plan.dispatcherDigest && plan.dependencies.every(file => digest(this.read(file.path)) === file.digest),
    'MIGRATION_HOOK_OWNER_CHANGED', 'Preserve the changed dispatcher for review; adoption never replaces its owner.');
  }
  private replace(plan: Plan, repo: Enrolled, change: Change, side: 'before' | 'after'): void {
    const target = this.source(repo, change.path), bytes = this.snapshot(plan, change, side), current = existsSync(target) ? digest(this.read(target)) : null;
    requireValue(current === change.before || current === change.after, 'MIGRATION_FILE_CONFLICT', `Concurrent changes in ${change.path} are preserved.`);
    const mode = side === 'before' ? change.beforeMode : change.mode;
    if (current === change[side]) { if (bytes !== null && mode !== null && (lstatSync(target).mode & 0o777) !== mode) { chmodSync(target, mode); this.sync(target); } return; }
    if (bytes === null) { unlinkSync(target); this.sync(dirname(target)); return; }
    const temporary = join(dirname(target), `.contribution-adoption-${plan.id}-${side}.tmp`);
    if (existsSync(temporary)) requireValue(digest(this.read(temporary)) === digest(bytes), 'MIGRATION_FILE_CONFLICT', 'A conflicting migration temporary file is preserved.');
    else writeFileSync(temporary, bytes, { flag: 'wx', mode: mode! });
    this.sync(temporary);
    requireValue((existsSync(target) ? digest(this.read(target)) : null) === current, 'MIGRATION_FILE_CONFLICT', `Source changed before replacing ${change.path}.`);
    renameSync(temporary, target); this.sync(dirname(target));
  }
  async change(repo: Enrolled, planId: string, action: 'apply' | 'activate' | 'rollback', expectedRevision: string, requestId: string): Promise<ObjectValue> {
    const input = digest({ repositoryId: repo.id, planId, action, expectedRevision }), previous = this.store.record<{ input: string; result?: ObjectValue }>('adoptionCommand', requestId);
    if (previous) { requireValue(previous.input === input, 'REQUEST_ID_CONFLICT', 'This migration request has different immutable inputs.'); if (previous.result) return previous.result; }
    let plan = this.plan(repo, planId);
    requireValue(!this.busy.has(repo.id) && !this.store.unsettled().some(op => op.repositoryId === repo.id), 'REPOSITORY_BUSY', 'Drain or reconcile retained repository jobs before migration.');
    requireValue(repo.revision === expectedRevision, 'REVISION_CONFLICT', 'The repository configuration changed since review.');
    requireValue(!this.store.records<Plan>('adoptionPlan').some(value => value.repositoryId === repo.id && value.id !== plan.id && !['prepared', 'rolled_back'].includes(value.phase)), 'MIGRATION_PENDING', 'Another adoption owns the current migration.');
    this.busy.add(repo.id); let lease: LegacyPrimaryLease | undefined, flight: LegacyLandingFlight | undefined;
    try {
      lease = new LegacyPrimaryLease(repo.commonDir, requestId); flight = new LegacyLandingFlight(repo.commonDir, plan.sourceTip, digest({ migration: plan.id, action }));
      requireValue(flight.tryAcquire().status === 'acquired', 'REPOSITORY_BUSY', 'Existing landing flights must drain before migration.');
      await this.ownerUnchanged(plan, repo);
      const source = await identity(repo.path); requireValue(source.commonDir === plan.before.commonDir && repo.commonDir === plan.before.commonDir && repo.path === plan.before.path, 'REPOSITORY_IDENTITY_CHANGED', 'The reviewed clone or primary path changed. Prepare a new proposal after relocation.'); requireValue(source.branch === plan.sourceBranch, 'ACTIVE_BRANCH_CHANGED', 'Migration never switches the primary branch.');
      this.store.put('adoptionCommand', requestId, { input });
      if (action !== 'rollback') requireValue(repo.canonicalHostId === plan.before.canonicalHostId && repo.availability === plan.before.availability && digest(this.store.record('authority', repo.id) ?? null) === plan.authorityDigest, 'MIGRATION_AUTHORITY_CHANGED', 'Repository ownership changed since this migration was reviewed. Prepare a fresh review after authority reconciliation.');
      let commit: () => void = () => {};
      if (action === 'apply') {
        requireValue(['prepared', 'applying', 'applied'].includes(plan.phase) && source.tip === plan.sourceTip && repo.revision === plan.before.revision, 'MIGRATION_SOURCE_CHANGED', 'Apply requires the exact reviewed source and configuration.');
        if (plan.phase === 'prepared') { await clean(repo.path); requireValue(digest(policyInventory(repo.path, plan.adapter).files) === digest(plan.inventory), 'MIGRATION_SOURCE_CHANGED', 'Reviewed policy fingerprints changed.'); }
        requireValue((await identity(repo.path)).tip === plan.sourceTip, 'MIGRATION_SOURCE_CHANGED', 'Primary advanced during apply preflight.');
        this.validateFiles(plan, repo);
        plan = { ...plan, phase: 'applying' }; this.store.put('adoptionPlan', plan.id, plan);
        for (const change of plan.changes) this.replace(plan, repo, change, 'after');
        plan = { ...plan, phase: 'applied' };
      } else if (action === 'activate') {
        requireValue(plan.phase === 'applied' && repo.revision === plan.before.revision, 'MIGRATION_NOT_APPLIED', 'Apply and commit the reviewed source changes before activation.');
        await clean(repo.path); this.validateFiles(plan, repo, true);
        requireValue(source.tip !== plan.sourceTip && (await git(repo.path, ['merge-base', '--is-ancestor', plan.sourceTip, source.tip!])).code === 0, 'MIGRATION_COMMIT_REQUIRED', 'Commit the reviewed changes without rewriting their source history.');
        const changed = (await gitText(repo.path, ['diff', '--name-only', plan.sourceTip, source.tip!, '--'])).split('\n').filter(Boolean).sort();
        requireValue(digest(changed) === digest(plan.changes.filter(change => change.before !== change.after).map(change => change.path).sort()), 'MIGRATION_RANGE_CHANGED', 'The activation range must contain exactly the reviewed migration paths.');
        const inventory = policyInventory(repo.path, plan.adapter); requireValue(inventory.readyForParity, 'MIGRATION_POLICY_CHANGED', 'The adopted policy inventory is incomplete.');
        for (const [path, hash] of Object.entries(plan.inventory)) if (!plan.changes.some(change => change.path === path)) requireValue(inventory.files[path] === hash, 'MIGRATION_POLICY_CHANGED', 'An unmodified policy source changed during adoption.');
        if (plan.originalHookDigest) requireValue(digest(this.read(join(this.directory(plan.id), 'original-pre-push'))) === plan.originalHookDigest, 'MIGRATION_SNAPSHOT_CHANGED', 'The original gate snapshot changed.');
        const updated = { ...repo, config: plan.config, revision: digest(plan.config), policySource: 'tracked' as const };
        const registration: AdoptedHookRegistration = { schemaVersion: 1, phase: 'active', adoptionId: plan.id, repositoryId: repo.id, adapter: plan.adapter, policyRevision: updated.revision,
          hooksPath: plan.hooksPath, dispatcherPath: plan.dispatcher, dispatcherDigest: plan.dispatcherDigest, dispatcherDependencies: plan.dependencies,
          guardPath: this.source(repo, plan.guard), guardDigest: plan.changes.find(change => change.path === plan.guard)!.after,
          policyFilesDigest: digest(inventory.files), originalHookDigest: plan.originalHookDigest };
        plan = { ...plan, phase: 'active' };
        requireValue((await identity(repo.path)).tip === source.tip, 'MIGRATION_SOURCE_CHANGED', 'Primary advanced during activation.');
        commit = () => { this.repos.save(updated); this.store.put('adoptedHooks', repo.id, registration); };
      } else {
        requireValue(['applying', 'applied', 'active', 'rolling_back', 'rolled_back'].includes(plan.phase), 'MIGRATION_NOT_APPLIED', 'Only applied migration changes can be rolled back.');
        const authorityGuard = repo.availability === 'both-macs' || Boolean(this.store.record('authority', repo.id));
        this.validateFiles(plan, repo);
        requireValue(!(await gitText(repo.path, ['diff', '--cached', '--name-only', '--', ...plan.changes.map(change => change.path)])), 'MIGRATION_INDEX_CHANGED', 'Preserve staged migration-file edits before rollback.');
        plan = { ...plan, phase: 'rolling_back' }; this.store.put('adoptionPlan', plan.id, plan);
        this.store.put('adoptedHooks', repo.id, null);
        for (const change of plan.changes) if (!authorityGuard || change.path !== plan.guard) this.replace(plan, repo, change, 'before');
        plan = { ...plan, phase: 'rolled_back' };
        commit = () => this.repos.save({ ...repo, config: plan.before.config, revision: plan.before.revision, policySource: plan.before.policySource });
      }
      const result = { ...this.view(plan), sourceCommitted: action === 'activate', indexChanged: false, historyChanged: false, requiresCommit: action !== 'activate',
        authorityGuardRetained: action === 'rollback' && (repo.availability === 'both-macs' || Boolean(this.store.record('authority', repo.id))) };
      this.store.transaction(() => { commit(); this.store.put('adoptionPlan', plan.id, plan); this.store.put('adoptionCommand', requestId, { input, result }); }); return result;
    } finally { flight?.release(); lease?.release(); this.busy.delete(repo.id); }
  }
  private validateFiles(plan: Plan, repo: Enrolled, afterOnly = false): void {
    for (const change of plan.changes) {
      this.snapshot(plan, change, 'before'); this.snapshot(plan, change, 'after');
      const path = this.source(repo, change.path), current = existsSync(path) ? digest(this.read(path)) : null;
      requireValue(current === change.after || (!afterOnly && current === change.before), 'MIGRATION_FILE_CONFLICT', `Concurrent changes in ${change.path} are preserved.`);
      if (afterOnly) requireValue((lstatSync(path).mode & 0o111) === (change.mode & 0o111), 'MIGRATION_MODE_CHANGED', `Reviewed executable permissions changed in ${change.path}.`);
    }
  }
}
