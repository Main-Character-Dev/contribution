import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fixture, repository, git } from './integration/service.mjs';
import { Journal } from '../packages/engine/dist/journal.js';

test('bootstrap write-ahead intent recovers partial files without touching unrelated index entries', async () => {
  for (const boundary of ['before_file', 'one_file', 'owner_edit']) {
    const f = await fixture(); try {
      const path = repository(f.root), repo = (await f.call('repos.add', { path })).result.repository;
      writeFileSync(join(path, 'unrelated.txt'), 'staged owner work'); git(path, 'add', 'unrelated.txt');
      const ownerIndex = git(path, 'ls-files', '--stage', '--', 'unrelated.txt');
      await f.call('service.pause'); const accepted = await f.call('repos.initialize', { repo: repo.id, requestId: randomUUID() });
      await f.stop(); const journal = new Journal(f.state), op = journal.get(accepted.operationId);
      const generated = { 'contribution.json': JSON.stringify(repo.config, null, 2) + '\n', 'CONTRIBUTION.md': '# Contribution workflow\n\nCommit task-owned work in a native task worktree. Submit completed commits through Contribution. Publication always requires an explicit Push request.\n' };
      journal.update(op, { state: 'running', effectDispatched: true, result: { bootstrapIntent: generated } }); journal.close();
      if (boundary !== 'before_file') writeFileSync(join(path, 'contribution.json'), boundary === 'owner_edit' ? 'owner edits' : generated['contribution.json']);
      await f.start(); const result = await f.call('runs.get', { operationId: op.operationId });
      assert.equal(git(path, 'ls-files', '--stage', '--', 'unrelated.txt'), ownerIndex);
      if (boundary === 'owner_edit') {
        assert.equal(result.operationState, 'outcome_unknown'); assert.equal(readFileSync(join(path, 'contribution.json'), 'utf8'), 'owner edits');
        assert.equal(existsSync(join(path, 'CONTRIBUTION.md')), false);
      } else {
        assert.equal(result.operationState, 'succeeded', JSON.stringify(result));
        assert.equal(git(path, 'rev-list', '--count', 'HEAD'), '1');
        assert.deepEqual(git(path, 'ls-tree', '--name-only', 'HEAD').split('\n'), ['CONTRIBUTION.md', 'contribution.json']);
      }
    } finally { await f.cleanup(); }
  }
});
