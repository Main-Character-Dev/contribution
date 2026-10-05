import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Journal } from '../packages/engine/dist/journal.js';
import { LegacyAuthorityFence } from '../packages/engine/dist/legacy-authority-fence.js';
import { digest } from '../packages/engine/dist/core.js';
import { policyInventory } from '../packages/adapters/dist/index.js';

// Imports original exports or invokes only the original lease-token CLI. All
// repository arguments and cwd values refer to disposable synthetic history.
// No original gate, release entry point, native reconciliation or network runs.
const targets = process.argv.slice(2).map(value => {
  const index = value.indexOf('='); assert(index > 0, 'Use ADAPTER_ID=/absolute/project.');
  const adapter = value.slice(0, index), root = realpathSync(resolve(value.slice(index + 1)));
  assert(['mathy-v1', 'maincharacter-v1', 'roboty-v1'].includes(adapter)); return { adapter, root };
});
assert(targets.length > 0 && targets.length <= 3 && new Set(targets.map(value => value.adapter)).size === targets.length);
assert.equal(process.platform, 'darwin');
const environment = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' };
for (const key of Object.keys(environment)) if (/^(?:CONTRIBUTION_|CODEX_|GIT_(?:DIR|COMMON_DIR|WORK_TREE|INDEX_FILE|CONFIG|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES))/.test(key)) { delete environment[key]; delete process.env[key]; }
const git = (cwd, ...argv) => execFileSync('/usr/bin/git', ['-C', cwd, ...argv], { env: environment, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const observe = root => ({ head: git(root, 'rev-parse', 'HEAD'), branch: git(root, 'branch', '--show-current'), status: digest(git(root, 'status', '--porcelain=v1')), refs: digest(git(root, 'for-each-ref')), index: digest(git(root, 'ls-files', '--stage')) });
const results = [];
for (const { adapter, root } of targets) {
  const original = { ...observe(root), policy: digest(policyInventory(root, adapter).files) };
  const temporary = realpathSync(mkdtempSync(join(tmpdir(), 'ct-writer-entry-'))), primary = join(temporary, 'primary'); mkdirSync(primary);
  const store = new Journal(join(temporary, 'state')); let fence, repo, transitionId;
  try {
    git(primary, 'init', '--initial-branch=fixture'); git(primary, 'config', 'user.name', 'Fixture'); git(primary, 'config', 'user.email', 'fixture@example.invalid');
    writeFileSync(join(primary, 'base'), 'synthetic retained history'); git(primary, 'add', 'base'); git(primary, 'commit', '-m', 'Fixture base');
    repo = { id: randomUUID(), commonDir: realpathSync(join(primary, '.git')), canonicalHostId: store.hostId }; transitionId = randomUUID();
    // The creator exits before the original entry point runs. This distinguishes
    // persistent filesystem refusal from an ordinary live process lease.
    const child = `import {Journal} from ${JSON.stringify(pathToFileURL(resolve('packages/engine/dist/journal.js')).href)}; import {LegacyAuthorityFence} from ${JSON.stringify(pathToFileURL(resolve('packages/engine/dist/legacy-authority-fence.js')).href)}; const store=new Journal(${JSON.stringify(store.directory)});new LegacyAuthorityFence(store).freeze(${JSON.stringify(repo)},${JSON.stringify(transitionId)});store.close();`;
    execFileSync(process.execPath, ['--input-type=module', '--eval', child], { env: environment, stdio: 'pipe', timeout: 10000 });
    fence = new LegacyAuthorityFence(store); const retained = fence.verify(repo), owner = readFileSync(join(repo.commonDir, 'primary-checkout-mutation.lock', 'owner.json'));
    assert.notEqual(retained.owner.pid, process.pid); const before = observe(primary), cases = [];
    if (adapter === 'mathy-v1') {
      const branch = await import(pathToFileURL(join(root, 'scripts/start-active-branch.mjs')));
      assert.throws(() => branch.startActiveBranch('codex/fixture-next', { cwd: primary }), /EPERM|busy|operation not permitted/i);
      cases.push('branch_start_refused_before_branch_or_checkout_change');
      const status = await import(pathToFileURL(join(root, 'scripts/workflow-status.mjs'))); let remoteCalled = false;
      const response = await status.evaluateWorkflowPushReadiness({ repoRoot: primary, activeBranch: 'fixture', tipSha: before.head, resolveComparisonBase: () => { remoteCalled = true; throw Error('Unapproved fixture network callback'); } });
      assert.equal(remoteCalled, false); assert.equal(response.ready, false); assert(response.reasons.includes('comparison_base_unavailable'));
      cases.push('comparison_refresh_refused_before_remote_callback');
    } else {
      const token = join(temporary, 'token.json');
      const response = spawnSync(process.execPath, [join(root, 'scripts/primary-checkout-lease.mjs'), 'acquire', '--purpose', 'contribution-fixture', '--token-file', token],
        { cwd: primary, env: environment, encoding: 'utf8', timeout: 10000, maxBuffer: 65536 });
      assert.equal(response.error, undefined); assert.notEqual(response.status, 0); assert.match(response.stderr, /EPERM|busy|operation not permitted/i); assert.equal(existsSync(token), false);
      cases.push('original_lease_cli_refused_without_issuing_token');
    }
    assert.deepEqual(observe(primary), before); assert.deepEqual(readFileSync(join(repo.commonDir, 'primary-checkout-mutation.lock', 'owner.json')), owner); fence.verify(repo);
    assert.deepEqual({ ...observe(root), policy: digest(policyInventory(root, adapter).files) }, original, 'Original source changed during this read-only observation.');
    results.push({ adapter, sourceCommit: original.head, sourcePolicyDigest: original.policy, creatorExited: true, primaryHistoryIndexAndWorktreePreserved: true, cases, result: 'passed' });
  } finally {
    if (fence && repo) { store.put('authority', repo.id, { phase: 'active', transitionId, ownerHostId: store.hostId }); fence.releaseForOwner(repo, transitionId); }
    store.close(); rmSync(temporary, { recursive: true });
  }
}
process.stdout.write(JSON.stringify({ recordMode: 'fixture', originalProjectsModified: false, physicalEvidence: false, scope: 'Selected original entry points only; not complete writer or owner-transfer qualification', results }, null, 2) + '\n');
