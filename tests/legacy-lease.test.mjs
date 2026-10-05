import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { LegacyPrimaryLease } from '../packages/engine/dist/legacy-lease.js';

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
