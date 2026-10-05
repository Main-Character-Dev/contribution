import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Journal } from '../packages/engine/dist/journal.js';
import { Engine } from '../packages/engine/dist/service.js';
import { listen } from '../packages/engine/dist/ipc.js';
import { digest } from '../packages/engine/dist/core.js';
import { run, processIdentity, isGitPushCommand } from '../packages/engine/dist/process.js';
import { LegacyPrimaryLease } from '../packages/engine/dist/legacy-lease.js';
import { adoptionPolicies, policyInventory, leaseBridgePatch, projectPins } from '../packages/adapters/dist/index.js';
import { repository, git, commit } from './integration/service.mjs';

const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
async function fixture({ inactive = false, exit = 0, rejected = false, changePolicy = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ct-adopted-push-')), store = new Journal(join(root, 'state'));
  const cli = resolve('packages/cli/dist/main.js'), engine = new Engine(store, { identity: 'fixture', node: process.execPath, cli }), server = await listen(engine);
  try {
  const path = repository(root), remote = join(root, 'remote.git'); mkdirSync(remote); git(remote, 'init', '--bare'); git(path, 'remote', 'add', 'origin', remote);
  if (rejected) writeFileSync(join(remote, 'hooks/pre-receive'), '#!/bin/sh\nexit 1\n', { mode: 0o700 });
  const adapter = inactive ? 'glassalpha-v1' : 'maincharacter-v1', policy = adoptionPolicies.find(value => value.id === adapter);
  for (const file of policy.policyFiles) { mkdirSync(join(path, file, '..'), { recursive: true }); writeFileSync(join(path, file), 'fixture policy definition'); }
  writeFileSync(join(path, '.node-version'), process.version.slice(1) + '\n'); writeFileSync(join(path, 'package.json'), JSON.stringify({ name: policy.packageName, packageManager: 'pnpm@11.23.0' }));
  writeFileSync(join(path, 'scripts/lib/primary-checkout-lease.mjs'), leaseBridgePatch('export function acquirePrimaryCheckoutLease() { throw new Error("fixture needs managed borrow"); }\nexport function releasePrimaryCheckoutLease() { return false; }\n'));
  const hooks = join(path, '.fixture-hooks'); mkdirSync(hooks); git(path, 'config', 'core.hooksPath', hooks);
  const dispatcher = join(hooks, 'pre-push'); writeFileSync(dispatcher, '#!/bin/sh\nexec "$CONTRIBUTION_BRIDGE_NODE" "$CONTRIBUTION_BRIDGE_CLI" hook adopted --repo "$CONTRIBUTION_BRIDGE_REPO" --state-dir "$CONTRIBUTION_BRIDGE_STATE" --remote "$1" --url "$2" --json\n', { mode: 0o700 });
  let repo = await engine.repos.add(path);
  const config = structuredClone(repo.config); config.integration.adapter = adapter; config.validation.adapter = adapter; config.validation.gate = policy.gate; config.publication.remote = 'origin'; config.publication.branch = 'dev';
  // Install the fixture's completed policy state directly. Normal configuration
  // correctly refuses to bypass the still-separate adoption transaction.
  repo = { ...repo, config, revision: digest(config), policySource: 'tracked' }; writeFileSync(join(path, 'contribution.json'), JSON.stringify(config)); engine.repos.save(repo);
  git(path, 'add', '--all'); git(path, 'commit', '-m', 'Fixture adopted policy');
  const pnpm = join(root, 'pnpm'); writeFileSync(pnpm, '#!/bin/sh\nprintf "11.23.0\\n"\n', { mode: 0o700 });
  if (!inactive) store.put('projectRuntimeSelection', repo.id, { node: process.execPath, pnpm, nodeVersion: process.version.slice(1), pnpmVersion: '11.23.0', pinsDigest: projectPins(path).inputs });
  const count = join(repo.commonDir, 'gate-count'), input = join(repo.commonDir, 'original-stdin'), changed = join(path, 'AGENTS.md');
  const program = `import {appendFileSync,writeFileSync} from 'node:fs';import * as lease from ${JSON.stringify(join(path, 'scripts/lib/primary-checkout-lease.mjs'))};
const acquired=lease.acquirePrimaryCheckoutLease({repoRoot:process.cwd(),purpose:'fixture'});if(acquired.status!=='acquired')throw Error('borrow failed');
console.log('gate fixture stdout');console.error('gate fixture stderr');appendFileSync(${JSON.stringify(count)},'gate\\n');appendFileSync(process.env.CODEX_PRE_PUSH_STATUS_LOG,'private gate evidence\\n');
${changePolicy ? `writeFileSync(${JSON.stringify(changed)},'changed while gate ran');` : ''}
if(!lease.releasePrimaryCheckoutLease({leasePath:acquired.leasePath,token:acquired.token}))throw Error('release failed');`;
  const script = `#!/bin/sh\nset -eu\ncat > ${quote(input)}\n${quote(process.execPath)} --input-type=module -e ${quote(program)}\nexit ${exit}\n`;
  const adoptionId = randomUUID(), directory = join(store.directory, 'adoptions', adoptionId); mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (!inactive) writeFileSync(join(directory, 'original-pre-push'), script, { mode: 0o400 });
  // Deliberate fixture registration: production activation is a separate reconciled transaction.
  store.put('adoptedHooks', repo.id, { schemaVersion: 1, phase: 'active', adoptionId, repositoryId: repo.id, adapter, policyRevision: repo.revision, hooksPath: hooks,
    dispatcherPath: dispatcher, dispatcherDigest: digest(readFileSync(dispatcher)), policyFilesDigest: digest(policyInventory(path, adapter).files), originalHookDigest: inactive ? null : digest(Buffer.from(script)) });
  const call = (command, args) => engine.dispatch({ schemaVersion: 1, command, args, cwd: path });
  const wait = async operationId => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) { const result = await call('runs.get', { operationId }); if (!['queued', 'running'].includes(result.operationState)) return result; await new Promise(resolve => setTimeout(resolve, 20)); }
    throw Error('adopted fixture deadline');
  };
  const push = async () => { const preview = await call('push', { repo: repo.id, preview: true }); assert.equal(preview.error, null, JSON.stringify(preview));
    const args = { repo: repo.id, expectedTip: preview.result.expectedTip, scopeToken: preview.result.scopeToken, requestId: randomUUID() };
    const admitted = await call('push', args); assert.equal(admitted.error, null, JSON.stringify(admitted)); return { args, result: await wait(admitted.operationId) }; };
  const external = () => run('/usr/bin/git', ['push', 'origin', 'dev'], { cwd: path, timeoutMs: 20000, env: { CONTRIBUTION_BRIDGE_NODE: process.execPath, CONTRIBUTION_BRIDGE_CLI: cli, CONTRIBUTION_BRIDGE_REPO: repo.id, CONTRIBUTION_BRIDGE_STATE: store.directory, CONTRIBUTION_OPERATION_ID: '', CONTRIBUTION_HOOK_TOKEN: '' } });
  return { root, store, engine, repo, remote, path, count, input, call, push, external, cleanup: async () => {
    engine.stopping = true; while (engine.active.size || engine.peers.busy || engine.github.busy) await new Promise(resolve => setTimeout(resolve, 20));
    await new Promise(resolve => server.close(resolve)); store.close(); rmSync(root, { recursive: true });
  } };
  } catch (error) { engine.stopping = true; await new Promise(resolve => server.close(resolve)); store.close(); rmSync(root, { recursive: true }); throw error; }
}

test('adopted managed publication executes the original gate once inside Git and retains distinct evidence', async () => {
  const f = await fixture(); try {
    const { args, result } = await f.push(); assert.equal(result.operationState, 'succeeded', JSON.stringify(result));
    assert.equal(result.result.gate.state, 'passed'); assert.equal(result.result.delivery, 'delivered');
    assert.equal(readFileSync(f.count, 'utf8'), 'gate\n'); assert.match(readFileSync(f.input, 'utf8'), /^refs\/heads\/dev [a-f0-9]{40} refs\/heads\/dev 0{40}\n$/);
    assert.equal(git(f.remote, 'rev-parse', 'refs/heads/dev'), git(f.path, 'rev-parse', 'HEAD')); assert.equal(LegacyPrimaryLease.inspect(f.repo.commonDir), null);
    assert.equal((await f.call('push', args)).operationId, result.operationId); assert.equal(readFileSync(f.count, 'utf8'), 'gate\n');
    const snapshot = result.result.gate.evidence.snapshot; assert.equal(readFileSync(join(snapshot, 'status.log'), 'utf8'), 'private gate evidence\n');
    const noOp = await f.push(); assert.equal(noOp.result.result.delivery, 'up_to_date'); assert.equal(noOp.result.result.gate.state, 'not_run');
    assert.equal(readFileSync(f.count, 'utf8'), 'gate\n');
  } finally { await f.cleanup(); }
});

test('original gate refusal and successful gate followed by transport rejection stay distinct', async () => {
  for (const input of [{ exit: 17 }, { rejected: true }]) {
    const f = await fixture(input); try {
      const { result } = await f.push(); assert.equal(result.operationState, 'failed', JSON.stringify(result));
      assert.equal(result.result.gate.state, input.exit ? 'failed' : 'passed'); assert.equal(result.result.gate.exitCode, input.exit ?? 0);
      assert.equal(result.error.code, input.exit ? 'GATE_FAILED' : 'PUSH_FAILED'); assert.equal(result.result.delivery, 'not_delivered');
      assert.equal(readFileSync(f.count, 'utf8'), 'gate\n'); assert.equal(result.result.gate.evidence.files.length, 1);
    } finally { await f.cleanup(); }
  }
});

test('inactive adopted policy remains inactive without requiring or running a project runtime', async () => {
  const f = await fixture({ inactive: true }); try {
    const { result } = await f.push(); assert.equal(result.operationState, 'succeeded', JSON.stringify(result));
    assert.equal(result.result.gate.state, 'inactive'); assert.equal(result.result.delivery, 'delivered'); assert.equal(existsSync(f.count), false);
  } finally { await f.cleanup(); }
});

test('a policy change during an original gate blocks delivery and preserves changed project work', async () => {
  const f = await fixture({ changePolicy: true }); try {
    const { result } = await f.push(); assert.equal(result.operationState, 'failed', JSON.stringify(result));
    assert.equal(result.result.gate.code, 'ADOPTED_POLICY_CHANGED'); assert.equal(result.result.delivery, 'not_delivered');
    assert.equal(readFileSync(join(f.path, 'AGENTS.md'), 'utf8'), 'changed while gate ran');
  } finally { await f.cleanup(); }
});

test('ordinary compatible legacy contention prevents the adopted runner starting a gate', async () => {
  const f = await fixture(), lease = new LegacyPrimaryLease(f.repo.commonDir, randomUUID());
  try {
    const { result } = await f.push(); assert.notEqual(result.operationState, 'succeeded'); assert.equal(result.error.code, 'REPOSITORY_BUSY'); assert.equal(existsSync(f.count), false);
    assert.equal(LegacyPrimaryLease.inspect(f.repo.commonDir).token, lease.owner.token);
  } finally { lease.release(); await f.cleanup(); }
});

test('a changed adoption invalidates a publication preview even when the branch and tip are unchanged', async () => {
  const f = await fixture(); try {
    const preview = await f.call('push', { repo: f.repo.id, preview: true }); assert.equal(preview.error, null);
    const registration = f.store.record('adoptedHooks', f.repo.id); f.store.put('adoptedHooks', f.repo.id, { ...registration, adoptionId: randomUUID() });
    const result = await f.call('push', { repo: f.repo.id, expectedTip: preview.result.expectedTip, scopeToken: preview.result.scopeToken, requestId: randomUUID() });
    assert.equal(result.error.code, 'STALE_PUSH_SELECTION'); assert.equal(existsSync(f.count), false);
  } finally { await f.cleanup(); }
});


test('canonical external adopted pushes preserve gate-only outcomes, no-op and original refusal', async () => {
  for (const options of [{}, { exit: 17 }, { rejected: true }, { inactive: true }]) {
    const f = await fixture(options); try {
      const result = await f.external(); assert.equal(result.code === 0, !(options.exit || options.rejected), JSON.stringify(result));
      const op = f.store.list().find(op => op.kind === 'external_gate'); assert.ok(op);
      assert.equal(op.state, options.exit ? 'failed' : 'succeeded'); assert.equal(op.result.delivery, 'unobserved');
      assert.equal(op.result.gate.state, options.exit ? 'failed' : options.inactive ? 'inactive' : 'passed');
      assert.equal(LegacyPrimaryLease.inspect(f.repo.commonDir), null);
      if (!options.inactive) { assert.equal(readFileSync(f.count, 'utf8'), 'gate\n'); assert.match(f.store.logs(op), /gate fixture stdout/); assert.match(f.store.logs(op), /gate fixture stderr/); }
      if (!options.exit && !options.rejected) {
        assert.equal((await f.external()).code, 0);
        assert.equal(f.store.list().filter(op => op.kind === 'external_gate')[0].result.gate.state, 'not_run');
        if (!options.inactive) assert.equal(readFileSync(f.count, 'utf8'), 'gate\n');
      }
    } finally { await f.cleanup(); }
  }
});

test('external adopted admission rejects non-Git ancestry, paused service, contention and companion authority', async () => {
  const f = await fixture(); try {
    const response = await f.call('hook.adopted.begin', { repo: f.repo.id, caller: { pid: process.pid, start: processIdentity(process.pid) }, stdin: '', remote: 'origin', url: f.remote });
    assert.equal(response.error.code, 'HOOK_PROCESS_MISMATCH');
    f.store.setMeta('paused', true); const paused = await f.external(); assert.notEqual(paused.code, 0); assert.match(paused.stdout + paused.stderr, /REPOSITORY_BUSY/);
    f.store.setMeta('paused', false);
    const lease = new LegacyPrimaryLease(f.repo.commonDir, randomUUID());
    try { assert.notEqual((await f.external()).code, 0); assert.equal(LegacyPrimaryLease.inspect(f.repo.commonDir).token, lease.owner.token); }
    finally { lease.release(); }
    f.engine.repos.save({ ...f.repo, canonicalHostId: randomUUID() });
    assert.notEqual((await f.external()).code, 0); assert.equal(existsSync(f.count), false);
  } finally { await f.cleanup(); }
});

test('external Git command parser refuses ambiguous prefixes and non-push commands', () => {
  for (const input of ['/usr/bin/git push origin dev', 'git -C /tmp/repo -c a=b push origin dev', '/usr/bin/git --no-optional-locks push']) assert.equal(isGitPushCommand(input), true, input);
  for (const input of ['sh -c git push origin dev', 'git fetch origin push', 'git -C /tmp/with spaces push', 'git -c "a=b c=d" push', 'git -c push', 'git --exec-path=/tmp push', 'git status push']) assert.equal(isGitPushCommand(input), false, input);
});


test('lost external gate client retains uncertainty and its writer lease without replay', async () => {
  const f = await fixture(); try {
    const client = join(f.root, 'abandoned-client.mjs');
    writeFileSync(client, `import {request} from ${JSON.stringify(resolve('packages/engine/dist/ipc.js'))};import {processIdentity} from ${JSON.stringify(resolve('packages/engine/dist/process.js'))};
let input='';for await(const chunk of process.stdin)input+=chunk;
const reply=await request(${JSON.stringify(f.store.directory)},{schemaVersion:1,command:'hook.adopted.begin',cwd:process.cwd(),args:{repo:${JSON.stringify(f.repo.id)},remote:process.argv[2],url:process.argv[3],stdin:input,caller:{pid:process.pid,start:processIdentity(process.pid)}}});if(reply.error)throw Error(JSON.stringify(reply));process.exit(45);`);
    const adoption = f.store.record('adoptedHooks', f.repo.id);
    writeFileSync(adoption.dispatcherPath, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(client)} "$1" "$2"\n`, { mode: 0o700 });
    f.store.put('adoptedHooks', f.repo.id, { ...adoption, dispatcherDigest: digest(readFileSync(adoption.dispatcherPath)) });
    assert.notEqual((await f.external()).code, 0);
    const deadline = Date.now() + 4000; while (f.engine.active.size && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(f.engine.active.size, 0); const op = f.store.list().find(op => op.kind === 'external_gate');
    assert.equal(op.state, 'outcome_unknown'); assert.equal(op.error.code, 'EXTERNAL_GATE_INTERRUPTED'); assert.equal(op.result.delivery, 'unobserved');
    assert.ok(LegacyPrimaryLease.inspect(f.repo.commonDir)); assert.equal(existsSync(f.count), false);
    assert.notEqual((await f.external()).code, 0); assert.equal(f.store.list().filter(op => op.kind === 'external_gate').length, 1);
    const maintenance = await f.call('maintenance.begin', { requestId: randomUUID() });
    const status = await f.call('maintenance.status', {}); assert.ok(status.result.blockers.uncertainOperations.includes(op.operationId));
    assert.equal((await f.call('maintenance.stop', { windowId: maintenance.result.window.id })).error.code, 'MAINTENANCE_NOT_READY');
  } finally { await f.cleanup(); }
});
