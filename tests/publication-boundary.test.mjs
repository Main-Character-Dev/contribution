import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fixture, repository, git, commit } from './integration/service.mjs';
import { run } from '../packages/engine/dist/process.js';

test('an owned hook made nonexecutable cannot silently become a successful managed push', async () => {
  const f = await fixture(); try {
    const path = repository(f.root), remote = join(f.root, 'remote.git'); git(f.root, 'init', '--bare', remote); git(path, 'remote', 'add', 'origin', remote);
    commit(path); const repo = (await f.call('repos.add', { path })).result.repository;
    const config = structuredClone(repo.config); config.publication.remote = 'origin'; config.publication.branch = 'dev';
    assert.equal((await f.call('repos.configure', { repo: repo.id, config, expectedRevision: repo.revision, requestId: randomUUID() })).error, null);
    async function push() {
      const response = await f.call('push', { repo: repo.id, preview: true }); assert.equal(response.error, null); const preview = response.result;
      const accepted = await f.call('push', { repo: repo.id, expectedTip: preview.expectedTip, scopeToken: preview.scopeToken, requestId: randomUUID() });
      assert.equal(accepted.error, null); return f.wait(accepted.operationId);
    }
    const first = await push(); assert.equal(first.operationState, 'succeeded');
    const oldTip = git(remote, 'rev-parse', 'refs/heads/dev');
    writeFileSync(join(path, 'change.txt'), 'change'); git(path, 'add', 'change.txt'); git(path, 'commit', '-m', 'Fixture change');
    chmodSync(join(path, '.git/hooks/pre-push'), 0o600);
    const second = await push(); assert.equal(second.error.code, 'EXISTING_HOOK_OWNER');
    assert.equal(git(remote, 'rev-parse', 'refs/heads/dev'), oldTip);
  } finally { await f.cleanup(); }
});

test('subprocesses discard inherited Git namespace and configuration injection while explicit owned overrides still work', async () => {
  const keys = ['GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_NOSYSTEM', 'GIT_COMMON_DIR', 'GIT_NAMESPACE', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const root = mkdtempSync(join(tmpdir(), 'ct-process-git-env-'));
  try {
    for (const key of keys) process.env[key] = 'caller-injection';
    const result = await run(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.env))'], { cwd: root, env: { GIT_INDEX_FILE: join(root, 'owned-index') } });
    assert.equal(result.code, 0); const observed = JSON.parse(result.stdout);
    for (const key of keys) assert.equal(observed[key], undefined, key);
    assert.equal(observed.GIT_INDEX_FILE, join(root, 'owned-index'));
  } finally {
    for (const key of keys) if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    rmSync(root, { recursive: true });
  }
});
