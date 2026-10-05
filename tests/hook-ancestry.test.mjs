import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { Journal } from '../packages/engine/dist/journal.js';
import { Lease, processIdentity } from '../packages/engine/dist/process.js';
import { Workflows } from '../packages/engine/dist/workflows.js';

test('a token-bearing caller outside the recorded Git ancestry cannot consume the managed hook', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ct-hook-ancestry-')), store = new Journal(join(root, 'state'));
  const op = store.admit(randomUUID(), 'push', randomUUID(), {}, 'fixture', 'running'), lease = new Lease(root, op.attemptId);
  const child = spawn(process.execPath, ['-e', 'process.stdout.write("ready\\n");setInterval(()=>{},1000)']);
  try {
    await once(child.stdout, 'data');
    const invocation = { hookToken: randomUUID(), lease: lease.owner, scope: { remote: 'origin', destination: 'fixture' }, remoteBefore: null, invoked: false, process: { pid: child.pid, start: processIdentity(child.pid) } };
    store.put('hookInvocation', op.operationId, invocation);
    const workflows = new Workflows(store, {}, {}), repo = { canonicalHostId: store.hostId, commonDir: root };
    await assert.rejects(workflows.hook(repo, { operationId: op.operationId, hookToken: invocation.hookToken, remote: 'origin', url: 'fixture', caller: { pid: process.pid, start: processIdentity(process.pid) } }, new AbortController().signal), error => error.code === 'HOOK_PROCESS_MISMATCH');
    assert.equal(store.record('hookInvocation', op.operationId).invoked, false);
    assert.equal(Lease.inspect(root).token, lease.owner.token);
  } finally { child.kill(); await once(child, 'exit'); lease.release(); store.close(); rmSync(root, { recursive: true }); }
});
