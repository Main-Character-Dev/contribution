import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { Journal } from '../packages/engine/dist/journal.js';
import { LegacyPrimaryLease } from '../packages/engine/dist/legacy-lease.js';
import { LegacyHookBorrow } from '../packages/engine/dist/legacy-hook-borrow.js';
import { processIdentity } from '../packages/engine/dist/process.js';
import { leaseBridgePatch } from '../packages/adapters/dist/index.js';

test('a managed hook borrows a distinct receipt and cannot release the outer writer', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ct-borrow-broker-')), store = new Journal(join(root, 'state'));
  const repo = { id: randomUUID(), revision: 'current-policy', commonDir: join(root, 'common') }; mkdirSync(repo.commonDir);
  const op = store.admit(randomUUID(), 'push', repo.id, {}, 'fixture', 'running'), lease = new LegacyPrimaryLease(repo.commonDir, op.attemptId);
  const child = spawn(process.execPath, ['-e', 'process.stdout.write("ready\\n");setInterval(()=>{},1000)']);
  try {
    await once(child.stdout, 'data');
    const invocation = { repositoryId: repo.id, operationId: op.operationId, attemptId: op.attemptId, policyRevision: repo.revision, phase: 'gate_running', hookToken: randomUUID(), lease: lease.owner,
      process: { pid: process.pid, start: processIdentity(process.pid) } };
    const args = { operationId: op.operationId, hookToken: invocation.hookToken, caller: { pid: child.pid, start: processIdentity(child.pid) } }, bridge = new LegacyHookBorrow(store);
    assert.throws(() => bridge.borrow(repo, args), error => error.code === 'HOOK_LEASE_INVALID');
    store.put('legacyHookInvocation', op.operationId, invocation);
    assert.throws(() => bridge.borrow(repo, { ...args, hookToken: 'forged' }), error => error.code === 'HOOK_LEASE_INVALID');
    assert.throws(() => bridge.borrow(repo, { ...args, caller: { ...args.caller, start: 'reused PID' } }), error => error.code === 'HOOK_PROCESS_MISMATCH');
    assert.throws(() => bridge.borrow({ ...repo, revision: 'changed-policy' }, args), error => error.code === 'HOOK_LEASE_INVALID');
    const borrowed = bridge.borrow(repo, args);
    assert.match(borrowed.token, /^contribution-borrow:/); assert.notEqual(borrowed.token, lease.owner.token);
    assert.equal(borrowed.owner.token, borrowed.token); assert.deepEqual(bridge.borrow(repo, args), borrowed);
    assert.throws(() => bridge.release(repo, { ...args, borrowToken: lease.owner.token }), error => error.code === 'HOOK_LEASE_INVALID');
    const release = bridge.release(repo, { ...args, borrowToken: borrowed.token });
    assert.equal(release.released, true); assert.equal(release.outerLeaseReleased, false);
    assert.equal(LegacyPrimaryLease.inspect(repo.commonDir).token, lease.owner.token);
    assert.deepEqual(bridge.release(repo, { ...args, borrowToken: borrowed.token }), release);
    assert.throws(() => bridge.borrow(repo, args), error => error.code === 'HOOK_LEASE_INVALID');
    store.put('legacyHookInvocation', op.operationId, { ...invocation, phase: 'gate_finished' });
    assert.throws(() => bridge.release(repo, { ...args, borrowToken: borrowed.token }), error => error.code === 'HOOK_LEASE_INVALID');
  } finally { child.kill(); await once(child, 'exit'); lease.release(); store.close(); rmSync(root, { recursive: true }); }
});

test('the source bridge preserves legacy acquire/release and token-file serialization without exposing outer release', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ct-bridge-shape-'));
  try {
    const original = `export function acquirePrimaryCheckoutLease(options) { return {status:'acquired',leasePath:'fixture',token:'legacy-token', options}; }
export function releasePrimaryCheckoutLease({leasePath,token}) { return releaseProcessLease({leasePath,token}); }
export function releaseProcessLease({leasePath,token}) { return leasePath === 'fixture' && token === 'legacy-token'; }
`;
    const patched = leaseBridgePatch(original); assert.throws(() => leaseBridgePatch(patched), /already bridged/);
    const module = join(root, 'bridge.mjs'); writeFileSync(module, patched);
    const candidate = await import(module), options = { ownerPid: 17, purpose: 'unchanged' };
    assert.deepEqual(candidate.acquirePrimaryCheckoutLease(options), { status: 'acquired', leasePath: 'fixture', token: 'legacy-token', options });
    assert.equal(candidate.releasePrimaryCheckoutLease({ leasePath: 'fixture', token: 'legacy-token' }), true);
    assert.equal(candidate.releaseProcessLease({ leasePath: 'fixture', token: 'wrong-token' }), false);
    const cli = join(root, 'fixture-cli.mjs'), callLog = join(root, 'calls');
    writeFileSync(cli, `import {appendFileSync} from 'node:fs';appendFileSync(${JSON.stringify(callLog)},JSON.stringify(process.argv.slice(2))+'\\n');
const release = process.argv.includes('release-borrow');console.log(JSON.stringify({schemaVersion:1,error:null,result:release?{released:true,outerLeaseReleased:false}:{status:'acquired',leasePath:'fixture',token:'contribution-borrow:fixture',owner:{token:'contribution-borrow:fixture'},contributionBorrowed:true}}));`);
    const script = `import * as bridge from ${JSON.stringify(module)};
const lease=bridge.acquirePrimaryCheckoutLease({purpose:'gate'});
// Main Character persists only these two fields across its acquisition/release processes.
const stored=JSON.parse(JSON.stringify({leasePath:lease.leasePath,token:lease.token}));
if(!bridge.releasePrimaryCheckoutLease(stored)||!bridge.releaseProcessLease(stored)) process.exit(5);`;
    const env = { ...process.env, CONTRIBUTION_BRIDGE_NODE: process.execPath, CONTRIBUTION_BRIDGE_CLI: cli, CONTRIBUTION_BRIDGE_STATE: root, CONTRIBUTION_BRIDGE_REPO: 'fixture-repository', CONTRIBUTION_OPERATION_ID: 'fixture-operation', CONTRIBUTION_HOOK_TOKEN: 'fixture-token' };
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env, encoding: 'utf8' }); assert.equal(run.status, 0, run.stderr);
    const calls = readFileSync(callLog, 'utf8').trim().split('\n').map(JSON.parse); assert.equal(calls.length, 3); assert(calls[0].includes('borrow')); assert(calls[1].includes('--borrow-token'));
    const refused = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...env, CONTRIBUTION_BRIDGE_CLI: '/missing' }, encoding: 'utf8' }); assert.notEqual(refused.status, 0);
  } finally { rmSync(root, { recursive: true }); }
});
