import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { LegacyPrimaryLease } from '../../packages/engine/dist/legacy-lease.js';
import { repository, git } from './service.mjs';

assert(process.argv.length > 2, 'Pass explicitly inspected standalone primary-lease modules');
for (const modulePath of process.argv.slice(2)) {
  const legacy = await import(pathToFileURL(modulePath).href);
  const root = mkdtempSync(join(tmpdir(), 'ct-legacy-parity-'));
  try {
    const repo = repository(root), common = git(repo, 'rev-parse', '--path-format=absolute', '--git-common-dir');
    const modern = new LegacyPrimaryLease(common, randomUUID());
    const busy = legacy.acquirePrimaryCheckoutLease({ repoRoot: repo, purpose: 'fixture-parity' }); assert.equal(busy.status, 'busy');
    modern.release();
    const old = legacy.acquirePrimaryCheckoutLease({ repoRoot: repo, purpose: 'fixture-parity' }); assert.equal(old.status, 'acquired');
    assert.throws(() => new LegacyPrimaryLease(common, randomUUID()), error => error.code === 'REPOSITORY_BUSY');
    assert.equal(legacy.releasePrimaryCheckoutLease(old), true);
    new LegacyPrimaryLease(common, randomUUID()).release();
    console.log('Inspected legacy lease and Contribution mutually exclude writers in a disposable common Git directory.');
  } finally { rmSync(root, { recursive: true }); }
}
