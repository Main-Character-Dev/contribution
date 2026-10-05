import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Journal } from '../../packages/engine/dist/journal.js';
import { Engine } from '../../packages/engine/dist/service.js';
import { listen } from '../../packages/engine/dist/ipc.js';
import { processIdentity } from '../../packages/engine/dist/process.js';
import { LegacyPrimaryLease } from '../../packages/engine/dist/legacy-lease.js';
import { leaseBridgePatch } from '../../packages/adapters/dist/index.js';
import { repository, git, commit } from './service.mjs';

assert(process.argv.length > 2, 'Pass explicitly inspected standalone primary-lease modules. No project gate is executed.');
const cli = resolve('packages/cli/dist/main.js');
for (const sourcePath of process.argv.slice(2)) {
  const source = readFileSync(sourcePath, 'utf8'), root = mkdtempSync(join(tmpdir(), 'ct-bridge-parity-'));
  const store = new Journal(join(root, 'state')), engine = new Engine(store, { identity: 'fixture', node: process.execPath, cli });
  const server = await listen(engine); let outer;
  try {
    const repoPath = repository(root); commit(repoPath);
    const remote = join(root, 'remote.git'); mkdirSync(remote); git(remote, 'init', '--bare'); git(repoPath, 'remote', 'add', 'fixture', remote);
    const repo = await engine.repos.add(repoPath), bridgeFile = join(root, 'primary-lease.mjs'); writeFileSync(bridgeFile, leaseBridgePatch(source), { mode: 0o600 });
    if (source.includes('from "./process-identity.mjs"')) writeFileSync(join(root, 'process-identity.mjs'), readFileSync(join(dirname(sourcePath), 'process-identity.mjs')), { mode: 0o600 });
    const bridge = await import(bridgeFile);
    const legacy = bridge.acquirePrimaryCheckoutLease({ repoRoot: repoPath, purpose: 'fixture-original-default' }); assert.equal(legacy.status, 'acquired');
    assert.throws(() => new LegacyPrimaryLease(repo.commonDir, randomUUID()), error => error.code === 'REPOSITORY_BUSY');
    assert.equal(bridge.releasePrimaryCheckoutLease(legacy), true);
    const op = store.admit(randomUUID(), 'push', repo.id, {}, 'fixture', 'running'); outer = new LegacyPrimaryLease(repo.commonDir, op.attemptId);
    assert.equal(bridge.acquirePrimaryCheckoutLease({ repoRoot: repoPath, purpose: 'fixture-unmanaged' }).status, 'busy');
    const ready = join(root, 'ready'), resultPath = join(root, 'borrow-result.json'), token = randomUUID();
    const gate = join(root, 'fixture-gate.mjs');
    writeFileSync(gate, `import {existsSync,writeFileSync} from 'node:fs';import * as bridge from ${JSON.stringify(bridgeFile)};
const deadline=Date.now()+5000;while(!existsSync(${JSON.stringify(ready)})){if(Date.now()>deadline)throw Error('ready timeout');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);}
const lease=bridge.acquirePrimaryCheckoutLease({repoRoot:process.cwd(),purpose:'fixture-managed-hook'});
const receipt=JSON.parse(JSON.stringify({leasePath:lease.leasePath,token:lease.token}));
if(!bridge.releasePrimaryCheckoutLease(receipt))throw Error('borrow release failed');
writeFileSync(${JSON.stringify(resultPath)},JSON.stringify(lease),{mode:0o600});`, { mode: 0o600 });
    const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
    writeFileSync(join(repo.commonDir, 'hooks/pre-push'), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(gate)}\n`, { mode: 0o700 });
    const child = spawn('/usr/bin/git', ['-C', repoPath, 'push', 'fixture', 'dev:dev'], { env: { ...process.env,
      CONTRIBUTION_BRIDGE_NODE: process.execPath, CONTRIBUTION_BRIDGE_CLI: cli, CONTRIBUTION_BRIDGE_STATE: store.directory, CONTRIBUTION_BRIDGE_REPO: repo.id,
      CONTRIBUTION_OPERATION_ID: op.operationId, CONTRIBUTION_HOOK_TOKEN: token }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
    await once(child, 'spawn');
    store.put('legacyHookInvocation', op.operationId, { repositoryId: repo.id, operationId: op.operationId, attemptId: op.attemptId, policyRevision: repo.revision,
      phase: 'gate_running', hookToken: token, lease: outer.owner, process: { pid: child.pid, start: processIdentity(child.pid) } });
    writeFileSync(ready, '', { mode: 0o600 });
    const [code] = await once(child, 'close'); assert.equal(code, 0, output);
    const receipt = JSON.parse(readFileSync(resultPath, 'utf8')); assert.match(receipt.token, /^contribution-borrow:/);
    assert.equal(LegacyPrimaryLease.inspect(repo.commonDir).token, outer.owner.token);
    assert.equal(git(remote, 'rev-parse', 'refs/heads/dev'), git(repoPath, 'rev-parse', 'HEAD'));
    store.put('legacyHookInvocation', op.operationId, { ...store.record('legacyHookInvocation', op.operationId), phase: 'gate_finished' });
    outer.release(); outer = undefined;
    const resumed = bridge.acquirePrimaryCheckoutLease({ repoRoot: repoPath, purpose: 'fixture-legacy-resume' }); assert.equal(resumed.status, 'acquired'); assert.equal(bridge.releasePrimaryCheckoutLease(resumed), true);
    console.log(JSON.stringify({ sourceSha256: createHash('sha256').update(source).digest('hex'), originalFallback: 'passed', mutualExclusion: 'passed', actualGitAncestryAndIPC: 'passed', tokenFileRelease: 'passed', projectGateExecution: 'not_run', liveProjectMutation: 'none' }));
  } finally {
    outer?.release(); engine.stopping = true; await new Promise(resolve => server.close(resolve)); store.close(); rmSync(root, { recursive: true });
  }
}
