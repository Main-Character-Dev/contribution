import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { LegacyPrimaryLease } from '../packages/engine/dist/legacy-lease.js';
import { processIdentity } from '../packages/engine/dist/process.js';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('the shared lease publishes legacy owner fields and respects both writer and recovery boundaries', () => {
  const root = mkdtempSync(join(tmpdir(), 'ct-legacy-lease-'));
  try {
    const lease = new LegacyPrimaryLease(root, randomUUID()), owner = JSON.parse(readFileSync(join(lease.directory, 'owner.json'), 'utf8'));
    assert.equal(owner.pid, process.pid); assert(owner.start_time); assert.equal(owner.version, 1);
    assert.throws(() => new LegacyPrimaryLease(root, randomUUID()), error => error.code === 'REPOSITORY_BUSY');
    lease.release(); assert.equal(existsSync(lease.directory), false);
    mkdirSync(lease.directory); writeFileSync(join(lease.directory, 'owner.json'), JSON.stringify({ ...owner, token: 'other-writer' }));
    lease.release(); assert.equal(existsSync(lease.directory), true);
    assert.throws(() => new LegacyPrimaryLease(root, randomUUID()), error => error.code === 'REPOSITORY_BUSY');
    rmSync(lease.directory, { recursive: true }); mkdirSync(lease.directory + '.recovery');
    writeFileSync(join(lease.directory + '.recovery', 'owner.json'), JSON.stringify(owner));
    assert.throws(() => new LegacyPrimaryLease(root, randomUUID()), error => error.code === 'REPOSITORY_BUSY');
    assert.equal(existsSync(join(lease.directory + '.recovery', 'owner.json')), true);
  } finally { rmSync(root, { recursive: true }); }
});

test('hook borrowing verifies the recorded invocation ancestry and never releases the outer lease', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ct-legacy-borrow-')), lease = new LegacyPrimaryLease(root, randomUUID());
  const child = spawn(process.execPath, ['-e', 'process.stdout.write("ready\\n");setInterval(()=>{},1000)']);
  try {
    await once(child.stdout, 'data'); const caller = { pid: child.pid, start: processIdentity(child.pid) }, parent = { pid: process.pid, start: processIdentity(process.pid) };
    const borrowed = LegacyPrimaryLease.borrow(root, lease.owner, caller, parent);
    assert.equal(borrowed.contributionBorrowed, true); assert.equal(borrowed.token, lease.owner.token);
    assert.throws(() => LegacyPrimaryLease.borrow(root, lease.owner, parent, caller), error => error.code === 'HOOK_PROCESS_MISMATCH');
    assert.throws(() => LegacyPrimaryLease.borrow(root, lease.owner, { ...caller, start: 'old process' }, parent), error => error.code === 'HOOK_PROCESS_MISMATCH');
    assert.throws(() => LegacyPrimaryLease.borrow(root, { ...lease.owner, token: 'forged' }, caller, parent), error => error.code === 'HOOK_LEASE_INVALID');
    assert.equal(LegacyPrimaryLease.inspect(root).token, lease.owner.token);
  } finally { child.kill(); await once(child, 'exit'); lease.release(); rmSync(root, { recursive: true }); }
});
