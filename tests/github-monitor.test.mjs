import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Journal } from '../packages/engine/dist/journal.js';
import { Repositories } from '../packages/engine/dist/repositories.js';
import { GitHubMonitor } from '../packages/engine/dist/github.js';
import { digest } from '../packages/engine/dist/core.js';
import { repository, git } from './integration/service.mjs';

async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'ct-gh-monitor-')), store = new Journal(join(root, 'state')), repos = new Repositories(store), path = repository(root);
  git(path, 'remote', 'add', 'origin', 'https://github.com/example/first.git');
  const repo = await repos.add(path); repo.config.publication = { remote: 'origin', branch: 'dev', pullRequestBase: 'main', mode: 'explicit' }; repo.revision = digest(repo.config); repos.save(repo);
  let resolve, reads = 0; const barrier = new Promise(r => { resolve = r; });
  const monitor = new GitHubMonitor(store, async path => { reads++; await barrier; return { status: 200, headers: {}, body: path.includes('/actions/runs') ? { workflow_runs: [] } : [] }; });
  return { root, store, repos, path, repo, monitor, release: () => resolve(), reads: () => reads, cleanup: () => { store.close(); rmSync(root, { recursive: true }); } };
}

test('manual refreshes join one per-repository observation and lifecycle sees it as active', async () => {
  const f = await setup(); try {
    const a = f.monitor.refresh(f.repo), b = f.monitor.refresh(f.repo);
    while (!f.reads()) await new Promise(r => setTimeout(r, 5));
    assert.equal(f.monitor.busy, true); assert.equal(f.reads(), 1);
    f.release(); const [first, second] = await Promise.all([a, b]); assert.deepEqual(first, second);
    assert.equal(first.readiness, 'no_pull_request'); assert.equal(f.reads(), 2); assert.equal(f.monitor.busy, false);
  } finally { f.cleanup(); }
});

test('destination drift during polling invalidates the observation and old cached results stay stale', async () => {
  const f = await setup(); try {
    const pending = f.monitor.refresh(f.repo);
    while (!f.reads()) await new Promise(r => setTimeout(r, 5));
    git(f.path, 'remote', 'set-url', 'origin', 'https://github.com/example/second.git');
    f.release(); const result = await pending; assert.equal(result.readiness, 'unknown'); assert.deepEqual(result.reasonCodes, ['GITHUB_SELECTION_CHANGED']);
    const next = await f.monitor.refresh(f.repo); assert.equal(next.readiness, 'no_pull_request');
    git(f.path, 'remote', 'set-url', 'origin', 'https://github.com/example/third.git');
    const cached = await f.monitor.cached(f.repo); assert.equal(cached.freshness, 'stale'); assert.equal(cached.readiness, 'unknown');
    assert.equal(cached.lastKnown.readiness, 'no_pull_request');
  } finally { f.cleanup(); }
});

test('configuration changes during polling cannot retain readiness for the previous selected branch', async () => {
  const f = await setup(); try {
    const pending = f.monitor.refresh(f.repo);
    while (!f.reads()) await new Promise(r => setTimeout(r, 5));
    const changed = structuredClone(f.repo); changed.config.publication.branch = 'new'; changed.revision = digest(changed.config); f.repos.save(changed);
    f.release(); const result = await pending; assert.equal(result.readiness, 'unknown'); assert.equal(result.freshness, 'stale');
    const next = await f.monitor.refresh(changed); assert.equal(next.readiness, 'no_pull_request');
    assert.equal((await f.monitor.cached(f.repo)).readiness, 'unknown');
  } finally { f.cleanup(); }
});
