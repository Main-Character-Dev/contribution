import test from 'node:test';
import assert from 'node:assert/strict';
import { observe, readiness, apiFailure, githubRepository } from '../packages/engine/dist/github.js';

const head = 'a'.repeat(40), merge = 'b'.repeat(40);
const pr = { number: 8, url: 'https://github.com/example/fixture/pull/8', title: 'Fixture', state: 'OPEN', isDraft: false,
  headRefOid: head, baseRefName: 'main', baseRefOid: 'c'.repeat(40), mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: null, potentialMergeCommit: { oid: merge } };
const rules = [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'test', integration_id: 1 }] } }];
const check = { id: 1, name: 'test', head_sha: head, app: { id: 1 }, status: 'completed', conclusion: 'success' };
function api(overrides = {}) { return async path => {
  const body = path === '/graphql' ? { data: { repository: { pullRequest: pr } } } : path.includes('/actions/runs') ? { workflow_runs: [] } : path.includes('/pulls?') ? [{ number: 8 }] : path.includes('/check-runs') ? { check_runs: [check] } : rules;
  return { status: 200, headers: {}, body, ...overrides };
}; }
test('current head and explicit test-merge association determine required-check readiness', async () => {
  assert.equal((await observe(api(), 'example', 'fixture', 'dev')).readiness, 'ready');
  assert.equal(readiness(pr, [{ ...check, head_sha: 'old' }], rules).readiness, 'blocked');
  assert.equal(readiness({ ...pr, testMergeOid: merge }, [{ ...check, head_sha: merge }], rules).readiness, 'ready');
  assert.equal(readiness(pr, [{ ...check, conclusion: 'skipped' }], rules).readiness, 'ready');
  assert.equal(readiness({ ...pr, isDraft: true }, [check], rules).readiness, 'draft');
  assert.equal(readiness({ ...pr, reviewDecision: 'CHANGES_REQUESTED' }, [check], rules).readiness, 'blocked');
  assert.equal(readiness({ ...pr, mergeStateStatus: 'UNKNOWN' }, [check], rules).readiness, 'unknown');
  assert.equal(readiness(pr, [check, { ...check, id: 2, name: 'optional', conclusion: 'failure' }], rules).readiness, 'ready');
  assert.equal(readiness(pr, [{ ...check, id: 2 }, { ...check, id: 1, conclusion: 'failure' }], rules).readiness, 'ready');
});
test('auth, permission, ambiguous 404, API, primary and secondary rate errors never become fresh success', async () => {
  const previous = await observe(api(), 'example', 'fixture', 'dev');
  for (const [status, headers, body, code] of [
    [401, {}, {}, 'GITHUB_AUTH_REQUIRED'], [403, {}, {}, 'GITHUB_PERMISSION_DENIED'], [404, {}, {}, 'GITHUB_NOT_FOUND_OR_INACCESSIBLE'],
    [503, {}, {}, 'GITHUB_API_UNAVAILABLE'], [429, { 'retry-after': '120' }, {}, 'GITHUB_RATE_LIMITED'],
    [403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now()/1000)+90) }, {}, 'GITHUB_RATE_LIMITED'],
    [403, {}, { message: 'You have exceeded a secondary rate limit.' }, 'GITHUB_RATE_LIMITED'],
  ]) {
    const result = await observe(api({ status, headers, body }), 'example', 'fixture', 'dev', previous);
    assert.equal(result.readiness, 'unknown'); assert.equal(result.freshness, 'stale'); assert.equal(result.reasonCodes[0], code);
    assert.equal(result.lastKnown.readiness, 'ready'); assert.equal(result.checks.length, 0);
    if (code === 'GITHUB_RATE_LIMITED') assert.ok(Date.parse(result.retryAt) > Date.now());
  }
  const malformed = await observe(api({ body: {} }), 'example', 'fixture', 'dev', previous); assert.equal(malformed.reasonCodes[0], 'GITHUB_MALFORMED_RESPONSE');
  const lost = await observe(async () => { throw new Error('lost'); }, 'example', 'fixture', 'dev', previous); assert.equal(lost.readiness, 'unknown');
});
test('bounded pagination cannot silently omit missing checks or PRs; no PR is a successful distinct observation', async () => {
  const incomplete = await observe(api({ headers: { link: '<https://api.github.com/next>; rel="next"' } }), 'example', 'fixture', 'dev');
  assert.equal(incomplete.readiness, 'unknown'); assert.equal(incomplete.reasonCodes[0], 'GITHUB_OBSERVATION_INCOMPLETE');
  const noPR = await observe(async path => ({ status: 200, headers: {}, body: path.includes('/actions/runs') ? { workflow_runs: [] } : [] }), 'example', 'fixture', 'dev');
  assert.equal(noPR.readiness, 'no_pull_request'); assert.equal(noPR.freshness, 'fresh');
  assert.equal(apiFailure({ status: 200, headers: {}, body: {} }), null);
  assert.deepEqual(githubRepository('git@github.com:example/fixture.git'), { owner: 'example', name: 'fixture' });
  assert.equal(githubRepository('https://secret:token@github.com/example/fixture'), null);
});
