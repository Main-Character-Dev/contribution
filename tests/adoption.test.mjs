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
import { digest, Fault } from '../packages/engine/dist/core.js';

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

async function secondClone(f) {
  const path = join(f.root, 'second'), store = new Journal(join(f.root, 'second-state'));
  git(f.root, 'clone', '--no-hardlinks', f.path, path);
  const hooks = f.repo.config.validation.gate === 'enabled' && f.guard.startsWith('.githooks/') ? join(path, '.git/mathy/trusted-hooks/fixture') : join(path, '.husky/_');
  mkdirSync(hooks, { recursive: true }); writeFileSync(join(hooks, 'pre-push'), readFileSync(f.dispatcher), { mode: 0o755 });
  git(path, 'config', 'core.hooksPath', f.guard.startsWith('.githooks/') ? hooks : '.husky/_');
  const engine = new Engine(store, { identity: 'fixture', node: process.execPath, cli: resolve('packages/cli/dist/main.js') }), repo = await engine.repos.add(path);
  const call = args => engine.dispatch({ schemaVersion: 1, command: 'repos.migration', args: { repo: repo.id, ...args }, cwd: path });
  return { path, store, engine, repo, call, cleanup: () => { engine.stopping = true; store.close(); } };
}

test('second clones reconstruct all four original gates from committed history without rewriting source', async () => {
  for (const adapter of adoptionPolicies.map(policy => policy.id)) {
    const f = await fixture(adapter); let second;
    try {
      const { plan } = await f.prepare(); assert.equal((await f.change('applyAdoption', plan)).error, null);
      git(f.path, 'add', '--all'); git(f.path, 'commit', '-m', 'Fixture adoption for clone'); const migrationTip = git(f.path, 'rev-parse', 'HEAD');
      second = await secondClone(f);
      writeFileSync(join(second.path, 'unrelated-after-migration'), 'Later normal source work\n');
      git(second.path, 'add', '--all'); git(second.path, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Later work');
      const before = git(second.path, 'rev-parse', 'HEAD'), request = { prepareExistingAdoption: true, originalTip: plan.sourceTip, migrationTip, requestId: randomUUID() };
      const reviewed = await second.call(request); assert.equal(reviewed.error, null, JSON.stringify(reviewed)); assert.equal(reviewed.result.registrationOnly, true);
      assert.deepEqual((await second.call(request)).result, reviewed.result);
      assert.equal(second.store.record('adoptedHooks', second.repo.id), undefined);
      assert.equal((await second.call({ applyAdoption: reviewed.result.proposalId, expectedRevision: second.repo.revision, requestId: randomUUID() })).error.code, 'REGISTRATION_ONLY');
      const activation = { activateAdoption: reviewed.result.proposalId, expectedRevision: second.repo.revision, requestId: randomUUID() };
      const activated = await second.call(activation); assert.equal(activated.error, null, JSON.stringify(activated));
      assert.deepEqual((await second.call(activation)).result, activated.result);
      const registration = await second.engine.workflows.adopted.verify(second.repo);
      assert.equal(registration.originalHookDigest, f.store.record('adoptionPlan', plan.proposalId).originalHookDigest);
      assert.equal(git(second.path, 'rev-parse', 'HEAD'), before); assert.equal(git(second.path, 'status', '--porcelain'), '');
      assert.equal((await second.call({ rollbackAdoption: reviewed.result.proposalId, expectedRevision: second.repo.revision, requestId: randomUUID() })).error.code, 'REGISTRATION_ONLY');
    } finally { second?.cleanup(); await f.cleanup(); }
  }
});

test('existing adoption review rejects forged migration contents, missing ancestry and changed local policy', async () => {
  for (const variant of ['hook', 'lease', 'extra', 'history', 'policy']) {
    const f = await fixture(); let second;
    try {
      const { plan } = await f.prepare(); assert.equal((await f.change('applyAdoption', plan)).error, null);
      if (variant === 'hook') writeFileSync(join(f.path, f.guard), '#!/bin/sh\nexit 0\n');
      if (variant === 'lease') writeFileSync(join(f.path, 'scripts/lib/primary-checkout-lease.mjs'), 'export const forged = true;\n');
      if (variant === 'extra') writeFileSync(join(f.path, 'extra-migration-file'), 'unreviewed\n');
      git(f.path, 'add', '--all'); git(f.path, 'commit', '-m', 'Fixture candidate'); const migrationTip = git(f.path, 'rev-parse', 'HEAD');
      second = await secondClone(f);
      if (variant === 'policy') { writeFileSync(join(second.path, 'AGENTS.md'), 'different policy\n'); git(second.path, 'add', '--all'); git(second.path, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Policy changed'); }
      const before = git(second.path, 'status', '--porcelain'), tip = git(second.path, 'rev-parse', 'HEAD');
      const result = await second.call({ prepareExistingAdoption: true, originalTip: variant === 'history' ? 'a'.repeat(40) : plan.sourceTip, migrationTip, requestId: randomUUID() });
      assert.ok(result.error, JSON.stringify(result)); assert.equal(second.store.record('adoptedHooks', second.repo.id), undefined);
      assert.equal(git(second.path, 'status', '--porcelain'), before); assert.equal(git(second.path, 'rev-parse', 'HEAD'), tip);
    } finally { second?.cleanup(); await f.cleanup(); }
  }
});

test('existing adoption activation rechecks local dispatcher, snapshot and authority after review', async () => {
  for (const variant of ['dispatcher', 'snapshot', 'authority', 'writer']) {
    const f = await fixture(); let second, lease;
    try {
      const { plan } = await f.prepare(); assert.equal((await f.change('applyAdoption', plan)).error, null);
      git(f.path, 'add', '--all'); git(f.path, 'commit', '-m', 'Fixture adoption'); const migrationTip = git(f.path, 'rev-parse', 'HEAD'); second = await secondClone(f);
      const review = await second.call({ prepareExistingAdoption: true, originalTip: plan.sourceTip, migrationTip, requestId: randomUUID() }); assert.equal(review.error, null, JSON.stringify(review));
      if (variant === 'dispatcher') writeFileSync(join(second.path, '.husky/_/h'), 'changed dispatcher\n');
      if (variant === 'snapshot') { const snapshot = join(review.result.privateReviewDirectory, 'original-pre-push'); chmodSync(snapshot, 0o600); writeFileSync(snapshot, 'forged original\n'); }
      if (variant === 'authority') second.engine.repos.save({ ...second.repo, canonicalHostId: randomUUID() });
      if (variant === 'writer') lease = new LegacyPrimaryLease(second.repo.commonDir, randomUUID());
      const result = await second.call({ activateAdoption: review.result.proposalId, expectedRevision: second.repo.revision, requestId: randomUUID() }); assert.ok(result.error);
      assert.equal(second.store.record('adoptedHooks', second.repo.id), undefined);
    } finally { lease?.release(); second?.cleanup(); await f.cleanup(); }
  }
});


test('partial adoption and rollback replies retain the exact native continuation through a maintenance refusal', async t => {
  for (const action of ['applyAdoption', 'rollbackAdoption']) {
    const f = await fixture(); try {
      const { plan } = await f.prepare();
      if (action === 'rollbackAdoption') assert.equal((await f.change('applyAdoption', plan)).error, null);
      const requestId = randomUUID(), original = f.engine.adoptions.replace.bind(f.engine.adoptions); let stopped = false;
      const mock = t.mock.method(f.engine.adoptions, 'replace', (...args) => { original(...args); if (!stopped) { stopped = true; throw new Fault('FIXTURE_STOPPED', 'Interrupted after one reviewed file write.'); } });
      const failed = await f.change(action, plan, f.repo.revision, requestId); mock.mock.restore();
      assert.equal(failed.error.code, 'FIXTURE_STOPPED'); assert.equal(failed.result.requestRetained, true); assert.equal(failed.result.requestId, requestId);
      assert.equal(failed.result.phase, action === 'applyAdoption' ? 'applying' : 'rolling_back');
      f.store.setMeta('maintenance', true);
      const held = await f.change(action, plan, f.repo.revision, requestId); assert.equal(held.error.code, 'SERVICE_MAINTENANCE'); assert.equal(held.result.requestRetained, true);
      assert.equal((await f.change(action, plan, 'changed-revision', requestId)).result?.requestRetained, undefined);
      f.store.setMeta('maintenance', false); writeFileSync(join(f.path, 'unrelated-draft'), 'preserve');
      const finished = await f.change(action, plan, f.repo.revision, requestId); assert.equal(finished.error, null, JSON.stringify(finished));
      assert.equal(finished.result.phase, action === 'applyAdoption' ? 'applied' : 'rolled_back'); assert.equal(readFileSync(join(f.path, 'unrelated-draft'), 'utf8'), 'preserve');
      assert.deepEqual((await f.change(action, plan, f.repo.revision, requestId)).result, finished.result);
    } finally { t.mock.restoreAll(); await f.cleanup(); }
  }
});
