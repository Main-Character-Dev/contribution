import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Journal } from '../packages/engine/dist/journal.js';
import { Engine } from '../packages/engine/dist/service.js';
import { listen } from '../packages/engine/dist/ipc.js';
import { LegacyPrimaryLease } from '../packages/engine/dist/legacy-lease.js';
import { LegacyLandingFlight } from '../packages/engine/dist/legacy-flight.js';
import { adoptionPolicies, projectPins } from '../packages/adapters/dist/index.js';
import { repository, git } from './integration/service.mjs';
import { digest } from '../packages/engine/dist/core.js';

const quote = word => "'" + word.replaceAll("'", "'\\''") + "'";
async function fixture(adapter = 'maincharacter-v1') {
  const root = mkdtempSync(join(tmpdir(), 'ct-adoption-')), store = new Journal(join(root, 'state'));
  const path = repository(root), policy = adoptionPolicies.find(value => value.id === adapter);
  const engine = new Engine(store, { identity: 'fixture', node: process.execPath, cli: resolve('packages/cli/dist/main.js') }), server = await listen(engine);
  try {
    for (const file of policy.policyFiles) { mkdirSync(join(path, file, '..'), { recursive: true }); writeFileSync(join(path, file), 'fixture policy\n'); }
    writeFileSync(join(path, '.nvmrc'), process.version.slice(1) + '\n'); writeFileSync(join(path, 'package.json'), JSON.stringify({ name: policy.packageName, packageManager: 'pnpm@11.23.0' }));
    const lease = join(path, 'scripts/lib/primary-checkout-lease.mjs');
    writeFileSync(lease, 'export function acquirePrimaryCheckoutLease() { throw Error("fixture requires adopted borrow"); }\nexport function releasePrimaryCheckoutLease() { return false; }\n');
    if (adapter === 'mathy-v1') writeFileSync(join(path, 'scripts/lib/pre-push-reporting.mjs'), 'const logDirectory="fixture", EVIDENCE_PREFIX="fixture", environment=process.env; const path={join(){}}; export const paths={failureArchive: path.join(logDirectory, `${EVIDENCE_PREFIX}-failures`),};\n');
    if (adapter === 'roboty-v1') writeFileSync(join(path, 'scripts/local-pre-push.mjs'), 'const path={join(){}}, logDirectory="fixture"; export function resolvePrePushEvidencePaths(cwd = process.cwd()) {return {\n' + [['statusLog','pre-push-latest.log'],['summaryLog','pre-push-summary-latest.log'],['repairJson','pre-push-repair-latest.json'],['repairPrompt','pre-push-repair-latest.txt'],['repairArchive','pre-push-repairs']].map(([key,name])=>`${key}: path.join(logDirectory, "${name}"),`).join('\n')+'};}\n');
    const guard = adapter === 'mathy-v1' ? '.githooks/pre-push' : '.husky/pre-push'; mkdirSync(join(path, guard, '..'), { recursive: true });
    const count = join(path, '.git/gate-count');
    if (policy.gate === 'enabled') {
      const program = `import{appendFileSync}from'node:fs';import*as l from ${JSON.stringify(lease)};const v=l.acquirePrimaryCheckoutLease({repoRoot:process.cwd()});if(v.status!=='acquired'||!l.releasePrimaryCheckoutLease({leasePath:v.leasePath,token:v.token}))throw Error('lease');appendFileSync(${JSON.stringify(count)},'gate\\n');`;
      writeFileSync(join(path, guard), `#!/bin/sh\nset -eu\n${quote(process.execPath)} --input-type=module -e ${quote(program)}\n`, { mode: 0o644 });
    }
    const hooks = adapter === 'mathy-v1' ? join(path, '.git/mathy/trusted-hooks/fixture') : join(path, '.husky/_'); mkdirSync(hooks, { recursive: true });
    const dispatcher = join(hooks, 'pre-push');
    writeFileSync(dispatcher, adapter === 'mathy-v1' ? '#!/bin/sh\nset -eu\nroot="$(git rev-parse --show-toplevel)"\nexec /bin/sh "$root/.githooks/pre-push" "$@"\n' : '#!/bin/sh\n. "$(dirname "$0")/h"\n', { mode: 0o755 });
    if (adapter !== 'mathy-v1') writeFileSync(join(hooks, 'h'), '#!/bin/sh\nroot="$(git rev-parse --show-toplevel)"\n[ ! -f "$root/.husky/pre-push" ] && exit 0\nexec /bin/sh "$root/.husky/pre-push" "$@"\n');
    git(path, 'config', 'core.hooksPath', adapter === 'mathy-v1' ? hooks : '.husky/_');
    const remote = join(root, 'remote.git'); mkdirSync(remote); git(remote, 'init', '--bare'); git(path, 'remote', 'add', 'origin', remote);
    git(path, 'add', '--all'); git(path, 'commit', '-m', 'Fixture original policy');
    let repo = await engine.repos.add(path); const config = structuredClone(repo.config); config.publication.remote = 'origin'; config.publication.branch = 'dev'; repo = engine.repos.configure(repo, config, repo.revision, randomUUID());
    const pnpm = join(root, 'pnpm'); writeFileSync(pnpm, '#!/bin/sh\nprintf "11.23.0\\n"\n', { mode: 0o755 });
    store.put('projectRuntimeSelection', repo.id, { node: process.execPath, pnpm, nodeVersion: process.version.slice(1), pnpmVersion: '11.23.0', pinsDigest: projectPins(path).inputs });
    const call = (command, args = {}) => engine.dispatch({ schemaVersion: 1, command, args: { repo: repo.id, ...args }, cwd: path });
    const prepare = async () => { const request = { adapter, prepareAdoption: true, requestId: randomUUID() }; const result = await call('repos.migration', request); assert.equal(result.error, null, JSON.stringify(result)); return { request, plan: result.result }; };
    const change = (key, plan, expectedRevision = repo.revision, requestId = randomUUID()) => call('repos.migration', { [key]: plan.proposalId, expectedRevision, requestId });
    return { root, store, engine, path, repo, guard, dispatcher, count, call, prepare, change, cleanup: async () => { engine.stopping = true; while (engine.active.size) await new Promise(r => setTimeout(r, 20)); await new Promise(r => server.close(r)); store.close(); rmSync(root, { recursive: true }); } };
  } catch (error) { engine.stopping = true; await new Promise(r => server.close(r)); store.close(); rmSync(root, { recursive: true }); throw error; }
}

test('all four adoption proposals preserve hook ownership and require committed reviewed files before activation', async () => {
  for (const adapter of adoptionPolicies.map(policy => policy.id)) {
    const f = await fixture(adapter); try {
      const owner = git(f.path, 'config', '--get', 'core.hooksPath'), dispatcher = readFileSync(f.dispatcher);
      const { plan, request } = await f.prepare(); assert.equal(plan.mutation, 'none'); assert.equal(git(f.path, 'status', '--porcelain'), '');
      assert.deepEqual((await f.call('repos.migration', request)).result, plan);
      const applyId = randomUUID(), applied = await f.change('applyAdoption', plan, f.repo.revision, applyId); assert.equal(applied.error, null, JSON.stringify(applied));
      assert.equal((await f.change('activateAdoption', plan)).error.code, 'DIRTY_PRIMARY');
      assert.equal((await f.call('push', { preview: true })).error.code, 'MIGRATION_RECONCILIATION_REQUIRED');
      git(f.path, 'add', '--all'); git(f.path, 'commit', '-m', 'Fixture reviewed adoption');
      const activateId = randomUUID(), activated = await f.change('activateAdoption', plan, f.repo.revision, activateId); assert.equal(activated.error, null, JSON.stringify(activated));
      assert.equal(activated.result.phase, 'active'); assert.equal(git(f.path, 'config', '--get', 'core.hooksPath'), owner); assert.deepEqual(readFileSync(f.dispatcher), dispatcher);
      assert.deepEqual((await f.change('activateAdoption', plan, f.repo.revision, activateId)).result, activated.result);
      assert.deepEqual((await f.change('applyAdoption', plan, f.repo.revision, applyId)).result, applied.result);
      const preview = await f.call('push', { preview: true }); assert.equal(preview.error, null, JSON.stringify(preview));
      const admission = await f.call('push', { requestId: randomUUID(), expectedTip: preview.result.expectedTip, scopeToken: preview.result.scopeToken }); assert.equal(admission.error, null);
      const deadline = Date.now() + 12000; let op;
      do { op = f.store.get(admission.operationId); if (!['queued', 'running'].includes(op.state)) break; await new Promise(r => setTimeout(r, 20)); } while (Date.now() < deadline);
      assert.equal(op.state, 'succeeded', JSON.stringify(op)); assert.equal(op.result.gate.state, adapter === 'glassalpha-v1' ? 'inactive' : 'passed');
      assert.equal(existsSync(f.count), adapter !== 'glassalpha-v1'); if (existsSync(f.count)) assert.equal(readFileSync(f.count, 'utf8'), 'gate\n');
    } finally { await f.cleanup(); }
  }
});

test('concurrent source edits, source advances and corrupted review snapshots cannot be applied', async () => {
  for (const variant of ['edit', 'advance', 'snapshot']) {
    const f = await fixture(); try {
      const { plan } = await f.prepare(), before = readFileSync(join(f.path, f.guard));
      if (variant === 'edit') writeFileSync(join(f.path, 'AGENTS.md'), 'owner edit');
      if (variant === 'advance') { writeFileSync(join(f.path, 'unrelated'), 'owner commit'); git(f.path, 'add', '--all'); git(f.path, 'commit', '-m', 'Concurrent work'); }
      if (variant === 'snapshot') { const file = join(plan.privateReviewDirectory, '0-after'); chmodSync(file, 0o600); writeFileSync(file, 'changed private snapshot'); }
      assert.ok((await f.change('applyAdoption', plan)).error); assert.deepEqual(readFileSync(join(f.path, f.guard)), before);
      assert.equal(f.store.record('adoptedHooks', f.repo.id), undefined);
    } finally { await f.cleanup(); }
  }
});

test('interrupted file application resumes matching snapshots without overwriting other work', async () => {
  const f = await fixture(); try {
    const { plan } = await f.prepare(), retained = f.store.record('adoptionPlan', plan.proposalId);
    f.store.put('adoptionPlan', plan.proposalId, { ...retained, phase: 'applying' });
    const first = retained.changes[0]; writeFileSync(join(f.path, first.path), readFileSync(join(plan.privateReviewDirectory, first.afterFile)));
    writeFileSync(join(f.path, 'unrelated-draft'), 'keep this work');
    const result = await f.change('applyAdoption', plan); assert.equal(result.error, null, JSON.stringify(result)); assert.equal(result.result.phase, 'applied');
    assert.equal(readFileSync(join(f.path, 'unrelated-draft'), 'utf8'), 'keep this work');
    const rolled = await f.change('rollbackAdoption', plan); assert.equal(rolled.error, null, JSON.stringify(rolled));
    assert.equal(readFileSync(join(f.path, 'unrelated-draft'), 'utf8'), 'keep this work'); assert.equal(existsSync(join(f.path, 'contribution.json')), false);
    assert.equal(git(f.path, 'diff'), '');
  } finally { await f.cleanup(); }
});

test('rollback preserves concurrent edits and companion publication refusal without rewriting history', async () => {
  for (const paired of [false, true]) {
    const f = await fixture(); try {
      const { plan } = await f.prepare(); assert.equal((await f.change('applyAdoption', plan)).error, null);
      const hook = readFileSync(join(f.path, f.guard));
      writeFileSync(join(f.path, 'scripts/lib/primary-checkout-lease.mjs'), 'concurrent edit');
      assert.equal((await f.change('rollbackAdoption', plan)).error.code, 'MIGRATION_FILE_CONFLICT'); assert.deepEqual(readFileSync(join(f.path, f.guard)), hook);
      const retained = f.store.record('adoptionPlan', plan.proposalId), change = retained.changes.find(c => c.path === 'scripts/lib/primary-checkout-lease.mjs');
      writeFileSync(join(f.path, change.path), readFileSync(join(plan.privateReviewDirectory, change.afterFile)));
      if (paired) f.engine.repos.save({ ...f.repo, availability: 'both-macs', canonicalHostId: randomUUID() });
      const tip = git(f.path, 'rev-parse', 'HEAD'), result = await f.change('rollbackAdoption', plan);
      assert.equal(result.error, null, JSON.stringify(result)); assert.equal(result.result.authorityGuardRetained, paired); assert.equal(git(f.path, 'rev-parse', 'HEAD'), tip);
      assert.equal(readFileSync(join(f.path, f.guard)).equals(hook), paired); assert.equal(f.store.record('adoptedHooks', f.repo.id), null);
    } finally { await f.cleanup(); }
  }
});

test('existing primary writers and landing flights block source migration', async () => {
  const f = await fixture(); try {
    const { plan } = await f.prepare(); const lease = new LegacyPrimaryLease(f.repo.commonDir, randomUUID());
    try { assert.equal((await f.change('applyAdoption', plan)).error.code, 'REPOSITORY_BUSY'); } finally { lease.release(); }
    const flight = new LegacyLandingFlight(f.repo.commonDir, plan.sourceTip, digest('different-policy')); assert.equal(flight.tryAcquire().status, 'acquired');
    try { assert.equal((await f.change('applyAdoption', plan)).error.code, 'REPOSITORY_BUSY'); assert.equal(git(f.path, 'status', '--porcelain'), ''); } finally { flight.release(); }
  } finally { await f.cleanup(); }
});


test('activation rejects additional committed paths, changed dispatchers and authority changes', async () => {
  for (const variant of ['range', 'dispatcher', 'authority']) {
    const f = await fixture(); try {
      const { plan } = await f.prepare(); assert.equal((await f.change('applyAdoption', plan)).error, null);
      if (variant === 'range') writeFileSync(join(f.path, 'unreviewed-policy'), 'additional work');
      git(f.path, 'add', '--all'); git(f.path, 'commit', '-m', 'Fixture candidate');
      if (variant === 'dispatcher') writeFileSync(f.dispatcher, '#!/bin/sh\nexit 0\n');
      if (variant === 'authority') f.engine.repos.save({ ...f.repo, canonicalHostId: randomUUID() });
      const result = await f.change('activateAdoption', plan); assert.equal(result.error.code, variant === 'range' ? 'MIGRATION_RANGE_CHANGED' : variant === 'dispatcher' ? 'MIGRATION_HOOK_OWNER_CHANGED' : 'MIGRATION_AUTHORITY_CHANGED');
      assert.equal(f.store.record('adoptedHooks', f.repo.id), undefined); assert.equal(f.store.record('adoptionPlan', plan.proposalId).phase, 'applied');
    } finally { await f.cleanup(); }
  }
});
