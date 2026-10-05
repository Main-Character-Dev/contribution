import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { LegacyLandingFlight } from '../../packages/engine/dist/legacy-flight.js';
import { repository, git } from './service.mjs';

assert(process.argv.length > 2, 'Pass explicitly inspected original landing-flight modules');
for (const modulePath of process.argv.slice(2)) {
  const legacy = await import(pathToFileURL(modulePath).href), root = mkdtempSync(join(tmpdir(), 'ct-flight-parity-'));
  try {
    const repo = repository(root), common = git(repo, 'rev-parse', '--path-format=absolute', '--git-common-dir');
    const modern = new LegacyLandingFlight(common, 'a'.repeat(40)); assert.equal(modern.tryAcquire().status, 'acquired');
    const joining = await legacy.acquireWorktreeLandingFlight({ repoRoot: repo, candidateSha: 'a'.repeat(40), pollIntervalMs: 1, waitTimeoutMs: 100 });
    assert.equal(joining.status, 'joining');
    const conflict = await legacy.acquireWorktreeLandingFlight({ repoRoot: repo, candidateSha: 'a'.repeat(40), requirementsDigest: 'b'.repeat(64), pollIntervalMs: 1, waitTimeoutMs: 100 });
    assert.equal(conflict.status, 'conflict');
    const queued = legacy.acquireWorktreeLandingFlight({ repoRoot: repo, candidateSha: 'c'.repeat(40), pollIntervalMs: 5, waitTimeoutMs: 2000 });
    await new Promise(resolve => setTimeout(resolve, 100)); modern.release();
    const original = await queued; assert.equal(original.status, 'acquired');
    const modernJoin = new LegacyLandingFlight(common, 'c'.repeat(40)); assert.equal(modernJoin.tryAcquire().status, 'joining');
    const modernWait = new LegacyLandingFlight(common, 'd'.repeat(40)); assert.equal(modernWait.tryAcquire().status, 'waiting');
    assert.equal(await legacy.releaseWorktreeLandingFlight({ repoRoot: repo, token: original.token }), true);
    assert.equal(modernWait.tryAcquire().status, 'acquired'); assert.equal(modernWait.release(), true);
    console.log('Original and Contribution landing flights agree on joining, conflicting requirements, serialization and matching release in disposable Git directories.');
  } finally { rmSync(root, { recursive: true }); }
}
