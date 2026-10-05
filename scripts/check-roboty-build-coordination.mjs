// Exercise original shared-build coordination against a disposable pool and
// owned Node children. Never touch the live shared pool or invoke Xcode/phones.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { digest } from '../packages/engine/dist/core.js';
import { alive, processIdentity } from '../packages/engine/dist/process.js';

const original = resolve(process.argv[2] ?? '/Users/gabe/Sites/roboty');
const load = file => import(pathToFileURL(join(original, 'scripts/lib', file)));
const [build, pool, supervision] = await Promise.all(['ios-build-lease.mjs', 'ios-simulator-lease.mjs', 'supervised-command.mjs'].map(load));
const root = mkdtempSync(join(tmpdir(), 'ct-roboty-build-coordination-')), lockPath = join(root, 'pool');
let lease;
try {
  const options = { lockPath, runId: 'fixture', worktreePath: root, waitTimeoutMs: 150, pollIntervalMs: 10 };
  lease = await build.acquireIOSBuildLease(options);
  await assert.rejects(build.acquireIOSBuildLease({ ...options, runId: 'contender', waitTimeoutMs: 40 }));
  let child, updated;
  const output = await supervision.runSupervisedCommand(process.execPath, ['-e', 'console.log("fixture completion")'], { mirror: false, timeoutMs: 3000,
    onSpawn: async value => {
      child = value; assert.ok(value.childPid > 0 && value.childPid !== process.pid && value.childStartTime);
      updated = await pool.updateIOSSimulatorLease(lease, { childPid: value.childPid, childProcessGroup: value.childProcessGroup,
        childStartTime: value.childStartTime, phaseStartedAt: value.startedAt, deadlineAt: value.deadlineAt });
    } });
  assert.match(output.output, /fixture completion/); assert.equal(updated.owner.childPid, child.childPid);
  assert.ok(!alive(child.childPid) || processIdentity(child.childPid) !== child.childStartTime);
  await assert.rejects(supervision.runSupervisedCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { mirror: false, timeoutMs: 80, terminationGraceMs: 50,
    onSpawn: async value => { child = value; await pool.updateIOSSimulatorLease(lease, { childPid: value.childPid, childProcessGroup: value.childProcessGroup, childStartTime: value.childStartTime, deadlineAt: value.deadlineAt }); } }), error => error.timedOut === true);
  assert.ok(!alive(child.childPid) || processIdentity(child.childPid) !== child.childStartTime, 'Owned child must stop before releasing its original build slot.');
  await pool.updateIOSSimulatorLease(lease, { childPid: null, childProcessGroup: null, childStartTime: null, deadlineAt: null });
  assert.equal(await build.releaseIOSBuildLease(lease), true); lease = undefined;
  lease = await build.acquireIOSBuildLease({ ...options, runId: 'next' }); assert.equal(await build.releaseIOSBuildLease(lease), true); lease = undefined;
  console.log(JSON.stringify({ recordMode: 'fixture', originalSource: 'read_only', sourceDigests: Object.fromEntries(['ios-build-lease.mjs', 'ios-simulator-lease.mjs', 'supervised-command.mjs', 'process-identity.mjs'].map(file => [file, digest(readFileSync(join(original, 'scripts/lib', file)))])),
    passed: ['original_pool_exclusion', 'actual_child_identity', 'original_owner_updates', 'bounded_child_timeout_cleanup', 'release_then_reacquire'], livePoolTouched: false, buildStarted: false, phoneContacted: false }));
} finally { if (lease) await build.releaseIOSBuildLease(lease); rmSync(root, { recursive: true, force: true }); }
