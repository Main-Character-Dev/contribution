import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { fixture, repository, commit, git } from './integration/service.mjs';

test('generic handoff rejects shallow history, submodules and unresolved LFS content before source capture', async () => {
  const f = await fixture(); try {
    for (const kind of ['shallow', 'submodule', 'lfs']) {
      let primary = repository(f.root, kind); commit(primary); commit(primary, 'second.txt', 'second');
      if (kind === 'shallow') {
        const clone = join(f.root, 'shallow-clone'); git(f.root, 'clone', '--depth=1', pathToFileURL(primary).href, clone); primary = clone;
        git(primary, 'config', 'user.name', 'Fixture Author'); git(primary, 'config', 'user.email', 'fixture@example.invalid');
      }
      const base = git(primary, 'rev-parse', 'HEAD'), task = join(f.root, `${kind}-task`);
      git(primary, 'worktree', 'add', '--detach', task, base);
      if (kind === 'submodule') {
        git(task, 'update-index', '--add', '--cacheinfo', `160000,${base},child`); git(task, 'commit', '-m', 'Fixture submodule pointer');
      } else commit(task, 'task.txt', kind === 'lfs' ? 'version https://git-lfs.github.com/spec/v1\noid sha256:' + 'a'.repeat(64) + '\nsize 123\n' : 'task');
      writeFileSync(join(task, 'owner-work.txt'), 'preserve');
      const tip = git(task, 'rev-parse', 'HEAD'), before = git(task, 'status', '--porcelain=v1');
      const repo = (await f.call('repos.add', { path: primary })).result.repository;
      const result = await f.call('submit', { repo: repo.id, sourcePath: task, sourceTip: tip, base, requestId: randomUUID() });
      assert.equal(result.error.code, { shallow: 'SHALLOW_HISTORY', submodule: 'SUBMODULE_UNSUPPORTED', lfs: 'LFS_UNSUPPORTED' }[kind]);
      assert.equal(result.operationId, null); assert.equal(git(task, 'status', '--porcelain=v1'), before);
      assert.equal(git(primary, 'for-each-ref', '--format=%(refname)', 'refs/contribution'), '');
    }
  } finally { await f.cleanup(); }
});
