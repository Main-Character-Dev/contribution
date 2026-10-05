import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { policyInventory } from '../packages/adapters/dist/index.js';
import { digest } from '../packages/engine/dist/core.js';

// Original exports are imported read-only. Every receipt, lease and Git
// mutation belongs to a new disposable repository. Native planning, builds,
// simulator access and workspace interaction are replaced by inert callbacks.
assert.equal(process.argv.length, 3, 'Pass the absolute Mathy source path.');
assert(process.argv[2].startsWith('/'));
const source = realpathSync(process.argv[2]);
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(GIT_|CONTRIBUTION_|CODEX_)/.test(key)));
Object.assign(environment, { GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' });
// Imported project helpers inherit this sanitized process environment too.
for (const key of Object.keys(process.env)) if (/^(GIT_|CONTRIBUTION_|CODEX_)/.test(key)) delete process.env[key];
Object.assign(process.env, environment);
const git = (cwd, ...args) => execFileSync('/usr/bin/git', args, { cwd, encoding: 'utf8', env: environment, stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 }).trim();
const observation = () => ({ head: git(source, 'rev-parse', 'HEAD'), branch: git(source, 'branch', '--show-current'), status: digest(git(source, 'status', '--porcelain=v1')), refs: digest(git(source, 'show-ref')), index: digest(git(source, 'ls-files', '--stage')), policy: digest(policyInventory(source, 'mathy-v1').files) });
const before = observation();
assert(policyInventory(source, 'mathy-v1').readyForParity);
const state = await import(pathToFileURL(join(source, 'scripts/lib/worktree-landing-state.mjs')));
const lease = await import(pathToFileURL(join(source, 'scripts/lib/primary-checkout-lease.mjs')));
const repair = await import(pathToFileURL(join(source, 'scripts/worktree-reconcile')));
const cases = [];
for (const mode of ['success', 'planner_failure', 'primary_busy', 'receipt_changed']) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'ct-native-reconcile-parity-')));
  let held;
  try {
    const primary = join(directory, 'primary'); mkdirSync(primary);
    git(primary, 'init', '--initial-branch=fixture'); git(primary, 'config', 'user.name', 'Contribution Fixture'); git(primary, 'config', 'user.email', 'fixture@example.invalid');
    git(primary, 'config', 'mathy.activeBranch', 'fixture');
    writeFileSync(join(primary, '.gitignore'), '.code-reviews/\n'); writeFileSync(join(primary, 'value'), 'base');
    git(primary, 'add', '--all'); git(primary, 'commit', '-m', 'Base'); const base = git(primary, 'rev-parse', 'HEAD');
    const task = join(directory, '.codex/worktrees/fixture/task'); mkdirSync(join(task, '..'), { recursive: true }); git(primary, 'worktree', 'add', '--detach', task, base);
    writeFileSync(join(task, 'value'), 'completed'); git(task, 'add', 'value'); git(task, 'commit', '-m', 'Completed fixture task');
    const tip = git(task, 'rev-parse', 'HEAD'), tree = git(task, 'rev-parse', 'HEAD^{tree}');
    const message = ['Fixture landing', '', `Worktree: ${task}`, `Candidate: ${tip}`, 'Review-Epoch: 0', 'Post-Reset-Attempt: false', '', 'Original commits:', `- ${tip}`, ''].join('\n');
    const landed = execFileSync('/usr/bin/git', ['commit-tree', tree, '-p', base], { cwd: primary, input: message, encoding: 'utf8', timeout: 10000,
      env: { ...environment, GIT_COMMITTER_NAME: 'Mathy Worktree Landing', GIT_COMMITTER_EMAIL: 'worktree-landing@mathy.local' } }).trim();
    git(primary, 'merge', '--ff-only', landed);
    state.enqueueLandingCandidate({ primaryRoot: primary, sha: tip, worktreePath: task, source: 'synchronous-worktree-land' });
    state.writeLandingValidationReceipt({ primaryRoot: primary, candidateSha: tip, targetSha: base, resolvedTreeSha: tree, checksCommand: 'pnpm test:changed',
      checksArgv: state.landingValidationArgvForTarget('pnpm test:changed', base), validationRequirementsDigest: state.landingValidationRequirementsDigest('pnpm test:changed'),
      sourceWorktree: task, supersedes: [], status: 'landed', validationStatus: 'passed', reconciliationStatus: 'failed', landedSha: landed, provisionalSha: landed });
    const receipt = state.readLandingValidationReceipt(primary, tip), identity = state.resolveValidatedLandingIdentity(primary, 'fixture', receipt, { reconciliationStatus: 'failed' });
    assert.equal(identity.commitSha, landed); assert.equal(identity.candidateSha, tip);
    const refs = git(primary, 'show-ref'); let plans = 0;
    if (mode === 'primary_busy') { held = lease.acquirePrimaryCheckoutLease({ repoRoot: primary, purpose: 'fixture-blocker' }); assert.equal(held.status, 'acquired'); }
    if (mode === 'receipt_changed') {
      const changed = { ...receipt, source_worktree: primary }; writeFileSync(state.validationReceiptPath(primary, tip), JSON.stringify(changed));
    }
    const attempt = () => repair.reconcileLandedCandidate({ cwd: primary, candidateSha: tip,
      planCommand() {
        plans++; assert(existsSync(join(primary, '.git/primary-checkout-mutation.lock')), 'Original lease must precede planning.');
        if (mode === 'planner_failure') throw Error('Fixture planner failure');
        return { schemaVersion: 1, mode: 'none', requiresLease: false, requiresWorkspaceClosed: false, reasons: ['Inert parity fixture'],
          currentJavascriptDigest: '0'.repeat(64), candidateJavascriptDigest: '0'.repeat(64), currentPodDigest: '0'.repeat(64), candidatePodDigest: '0'.repeat(64), tools: { xcode: null, cocoaPods: null } };
      },
      prepareCommand() { throw Error('Native build is forbidden in parity.'); },
      suspendWorkspaceCommand() { throw Error('Workspace interaction is forbidden in parity.'); }
    });
    if (mode === 'success') {
      assert.equal(await attempt(), landed); assert.equal(plans, 1); assert.equal(state.readLandingValidationReceipt(primary, tip).reconciliation_status, 'passed');
      assert.equal(state.readLandingCandidate(primary, tip), null);
      await assert.rejects(attempt); assert.equal(plans, 1, 'Passed native work must not repeat.');
    } else {
      await assert.rejects(attempt); assert.equal(plans, mode === 'planner_failure' ? 1 : 0);
      assert(state.readLandingCandidate(primary, tip)); assert.equal(state.readLandingValidationReceipt(primary, tip).reconciliation_status, 'failed');
    }
    if (held) { assert.equal(lease.releasePrimaryCheckoutLease(held), true); held = undefined; }
    const fresh = lease.acquirePrimaryCheckoutLease({ repoRoot: primary, purpose: 'fixture-release-proof' }); assert.equal(fresh.status, 'acquired'); assert.equal(lease.releasePrimaryCheckoutLease(fresh), true);
    assert.equal(git(primary, 'rev-parse', 'HEAD'), landed); assert.equal(git(primary, 'show-ref'), refs); assert.equal(git(primary, 'status', '--porcelain=v1'), '');
    assert.equal(git(task, 'rev-parse', 'HEAD'), tip); assert.equal(git(task, 'status', '--porcelain=v1'), '');
    cases.push({ mode, result: 'passed', integrationReplayed: false, nativeBuilds: 0, workspaceInteractions: 0 });
  } finally { if (held) lease.releasePrimaryCheckoutLease(held); rmSync(directory, { recursive: true }); }
}
assert.deepEqual(observation(), before, 'The original source changed during parity observation.');
process.stdout.write(JSON.stringify({ recordMode: 'fixture', sourceCommit: before.head, sourcePolicyDigest: before.policy, runtimeUsed: process.version,
  originalProjectModified: false, nativeQualification: false, cases }, null, 2) + '\n');
