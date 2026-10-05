import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, repository, commit, git } from './integration/service.mjs';

test('status compares the configured canonical branch while reporting checkout drift', async () => {
  const f = await fixture();
  try {
    const path = repository(f.root), original = commit(path), repo = (await f.call('repos.add', { path })).result.repository;
    git(path, 'switch', '-c', 'other'); const changed = commit(path, 'other.txt', 'separate work');
    const response = await f.call('status', { repo: repo.id, refresh: true });
    assert.equal(response.error, null); assert.equal(response.result.canonicalTip, original);
    assert.deepEqual(response.result.checkout, { branch: 'other', tip: changed, matchesCanonicalBranch: false });
    assert.equal(response.result.publication.blockedReason, 'ACTIVE_BRANCH_CHANGED');
    assert.equal(response.result.publication.enabled, false);
    assert.equal(git(path, 'rev-parse', 'HEAD'), changed);
  } finally { await f.cleanup(); }
});
