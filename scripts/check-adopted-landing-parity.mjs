import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { adoptionPolicies, policyInventory, projectPins } from '../packages/adapters/dist/index.js';
import { digest } from '../packages/engine/dist/core.js';

// Explicitly supplied project modules are read, never patched or invoked as
// command entry points. All queue/Git mutations target this disposable fixture.
const targets = process.argv.slice(2).map(value => {
  const index = value.indexOf('='); assert(index > 0, 'Use ADAPTER_ID=/absolute/project for each project.');
  const adapter = value.slice(0, index), root = realpathSync(resolve(value.slice(index + 1)));
  assert(adoptionPolicies.some(policy => policy.id === adapter), 'Unknown adapter.'); return { adapter, root };
});
assert(targets.length > 0 && targets.length <= 4 && new Set(targets.map(value => value.adapter)).size === targets.length);
const git = (cwd, ...args) => execFileSync('/usr/bin/git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' } }).trim();
const results = [];
for (const { adapter, root } of targets) {
  assert(policyInventory(root, adapter).readyForParity, 'The original project has missing adopted policy inputs.');
  const before = { head: git(root, 'rev-parse', 'HEAD'), status: digest(git(root, 'status', '--porcelain=v1')), policy: digest(policyInventory(root, adapter).files) };
  const state = await import(pathToFileURL(join(root, 'scripts/lib/worktree-landing-state.mjs')));
  const entry = await import(pathToFileURL(join(root, 'scripts/worktree-land')));
  const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'ct-original-landing-')));
  try {
    const primary = join(fixture, 'primary'); mkdirSync(primary); git(primary, 'init', '--initial-branch=fixture'); git(primary, 'config', 'user.name', 'Fixture'); git(primary, 'config', 'user.email', 'fixture@example.invalid');
    writeFileSync(join(primary, 'base'), 'base'); git(primary, 'add', 'base'); git(primary, 'commit', '-m', 'Fixture base'); const base = git(primary, 'rev-parse', 'HEAD');
    const source = join(fixture, '.codex/worktrees/original/task'); mkdirSync(join(source, '..'), { recursive: true }); git(primary, 'worktree', 'add', '--detach', source, base);
    writeFileSync(join(source, 'completed'), 'completed'); git(source, 'add', 'completed'); git(source, 'commit', '-m', 'Fixture task'); const tip = git(source, 'rev-parse', 'HEAD'), tree = git(source, 'rev-parse', 'HEAD^{tree}');
    state.assertManagedLandingSourceWorktree({ worktreePath: source, primaryRepoRoot: primary, candidateShas: [tip] });
    const captured = join(fixture, 'contribution-owned-source'); git(primary, 'worktree', 'add', '--detach', captured, tip);
    assert.throws(() => state.assertManagedLandingSourceWorktree({ worktreePath: captured, primaryRepoRoot: primary, candidateShas: [tip] }), 'Utility snapshots must not pass as native task paths.');
    const selectors = adapter === 'mathy-v1' ? ['MathyUITests/MathyUITests/testFixture'] : [];
    const original = state.enqueueLandingCandidate({ primaryRoot: primary, sha: tip, worktreePath: source, source: 'synchronous-worktree-land', taskId: 'fixture-task', supersedes: [base], objectiveId: 'fixture-objective', reviewEpoch: 2, requiredUITestSelectors: selectors });
    const queued = state.enqueueLandingCandidate({ primaryRoot: primary, sha: tip, worktreePath: captured, source: 'contribution-captured-source', taskId: original.task_id,
      supersedes: original.supersedes, objectiveId: original.objective_id, reviewEpoch: original.review_epoch, postResetAttempt: original.post_reset_attempt, requiredUITestSelectors: original.required_ui_test_selectors });
    assert.equal(queued.worktree_path, captured); assert.equal(queued.task_id, 'fixture-task'); assert.deepEqual(queued.supersedes, [base]);
    if (adapter === 'mathy-v1') { assert.deepEqual(queued.required_ui_test_selectors, selectors); assert.equal(queued.objective_id, 'fixture-objective'); assert.equal(queued.review_epoch, 2); }
    const receipt = { version: 2, status: 'landed', candidate_sha: tip, target_sha: base, landed_sha: tip, provisional_sha: tip, resolved_tree_sha: tree, source_worktree: captured, supersedes: [base],
      checks_command: adapter === 'mathy-v1' ? 'pnpm test:changed' : 'integration-only', validation_status: adapter === 'mathy-v1' ? 'passed' : 'not_run', checks_argv: [] };
    const options = { candidateSha: tip, receipt, resolveTreeSha: sha => git(primary, 'rev-parse', `${sha}^{tree}`), targetContainsSha: sha => sha === tip };
    if (adapter === 'mathy-v1') {
      receipt.objective_id = queued.objective_id; receipt.review_epoch = queued.review_epoch; receipt.post_reset_attempt = false;
      receipt.checks_argv = state.landingValidationArgvForTarget('pnpm test:changed', base, selectors); receipt.validation_requirements_digest = state.landingValidationRequirementsDigest('pnpm test:changed', selectors);
      options.requiredUITestSelectors = selectors; options.checksCommand = 'pnpm test:changed';
      options.landedIdentity = { metadataVersion: 2, commitSha: tip, parentSha: base, treeSha: tree, candidateSha: tip, sourceWorktree: captured, supersedes: [base], requiredUITestSelectors: selectors, objectiveId: queued.objective_id, reviewEpoch: queued.review_epoch, postResetAttempt: false };
    }
    assert.equal(entry.resolveLandedCandidateSha(options), tip);
    assert.throws(() => entry.resolveLandedCandidateSha({ ...options, receipt: { ...receipt, validation_status: 'failed' } }));
    assert.throws(() => entry.resolveLandedCandidateSha({ ...options, targetContainsSha: () => false }));
    const retained = structuredClone(queued); state.removeLandingCandidate(primary, tip); assert.equal(state.readLandingCandidate(primary, tip), null);
    assert.equal(retained.sha, tip); assert.equal(entry.resolveLandedCandidateSha(options), tip);
    const after = { head: git(root, 'rev-parse', 'HEAD'), status: digest(git(root, 'status', '--porcelain=v1')), policy: digest(policyInventory(root, adapter).files) }; assert.deepEqual(after, before, 'Source project changed during the read-only parity observation.');
    results.push({ adapter, sourceCommit: before.head, sourcePolicyDigest: before.policy, declaredPins: projectPins(root), runtimeUsed: process.version,
      result: 'passed', scope: 'Original eligibility, candidate enqueue metadata, receipt rejection and terminal queue removal APIs with disposable synthetic history; not a full worker or project gate run' });
  } finally { rmSync(fixture, { recursive: true }); }
}
process.stdout.write(JSON.stringify({ recordMode: 'fixture', physicalEvidence: false, originalProjectsModified: false, results }, null, 2) + '\n');
