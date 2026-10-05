import test from 'node:test';
import assert from 'node:assert/strict';
import { observe, readiness, apiFailure, githubRepository } from '../packages/engine/dist/github.js';

const head = 'a'.repeat(40), merge = 'b'.repeat(40);
const pr = { number: 8, url: 'https://github.com/example/fixture/pull/8', title: 'Fixture', state: 'OPEN', isDraft: false,
  headRefOid: head, baseRefName: 'main', baseRefOid: 'c'.repeat(40), mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: null, potentialMergeCommit: { oid: merge }, baseRef: { branchProtectionRule: null } };
const rules = [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'test', integration_id: 1 }] } }];
const check = { id: 1, name: 'test', head_sha: head, app: { id: 1 }, status: 'completed', conclusion: 'success' };
function api(overrides = {}) { return async path => {
  const body = path === '/graphql' ? { data: { repository: { pullRequest: pr } } } : path.includes('/actions/runs') ? { workflow_runs: [] } : path.includes('/pulls?') ? [{ number: 8 }] : path.includes('/check-runs') ? { check_runs: [{ ...check, head_sha: path.includes(merge) ? merge : head }] } : path.includes('/statuses') ? [] : rules;
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


test('classic statuses and same-name check runs both pass on the selected test-merge commit', async () => {
  const anySource = [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'test' }] } }];
  const status = { id: 50, kind: 'commit_status', name: 'test', head_sha: head, status: 'completed', conclusion: 'failure' };
  assert.equal(readiness(pr, [check, status], anySource).readiness, 'blocked');
  assert.equal(readiness(pr, [{ ...status, conclusion: 'success' }], anySource).readiness, 'ready');
  assert.equal(readiness(pr, [{ ...status, conclusion: 'success' }], rules).readiness, 'blocked', 'a classic status does not prove the required app identity');
  assert.equal(readiness({ ...pr, testMergeOid: merge }, [{ ...check, id: 999 }, { ...check, id: 2, head_sha: merge, conclusion: 'failure' }], rules).readiness, 'blocked');
  assert.equal(readiness({ ...pr, testMergeOid: merge }, [{ ...check, id: 999, conclusion: 'failure' }, { ...check, id: 2, head_sha: merge }], rules).readiness, 'ready');
  const classic = { ...pr, potentialMergeCommit: null, baseRef: { branchProtectionRule: { requiresStatusChecks: true, requiredStatusChecks: [{ context: 'legacy', app: null }] } } };
  const result = await observe(async path => {
    if (path === '/graphql') return { status: 200, headers: {}, body: { data: { repository: { pullRequest: classic } } } };
    if (path.includes('/statuses')) return { status: 200, headers: {}, body: [{ id: 100, context: 'legacy', state: 'failure' }] };
    return api()(path);
  }, 'example', 'fixture', 'dev');
  assert.equal(result.readiness, 'blocked'); assert.deepEqual(result.reasonCodes, ['REQUIRED_CHECK:legacy']);
  assert.equal(result.checks.find(item => item.kind === 'commit_status').head_sha, head);
});

test('idle discovery includes scheduled/manual activity and polls older active runs without rolling attempts backward', async () => {
  const old = { id: 42, run_attempt: 2, status: 'in_progress', conclusion: null, updated_at: '2026-10-01T00:00:00Z' };
  const previous = { observedAt: '2026-10-02T00:00:00Z', freshness: 'fresh', readiness: 'no_pull_request', reasonCodes: [], pullRequest: null, checks: [], workflows: [old], retryAt: null };
  const paths = [];
  const result = await observe(async path => {
    paths.push(path);
    const body = path.includes('/actions/runs?') ? { workflow_runs: [{ id: 50, run_attempt: 1, status: 'completed', conclusion: 'failure', event: 'schedule', updated_at: '2026-10-02T01:00:00Z' }] }
      : path.endsWith('/actions/runs/42') ? { ...old, status: 'completed', conclusion: 'success', updated_at: '2026-10-02T00:30:00Z' } : [];
    return { status: 200, headers: {}, body };
  }, 'example', 'fixture', 'dev', previous);
  assert.equal(result.freshness, 'fresh'); assert.equal(result.workflows.length, 2);
  assert.equal(result.workflows.find(run => run.id === 42).conclusion, 'success');
  assert(paths.some(path => path.includes('created=%3E%3D2026-10-01T23%3A45')));
  const outdated = await observe(async path => ({ status: 200, headers: {}, body: path.includes('/actions/runs?') ? { workflow_runs: [{ ...old, run_attempt: 1, status: 'completed', conclusion: 'failure' }] } : [] }), 'example', 'fixture', 'dev', result);
  assert.equal(outdated.workflows.find(run => run.id === 42).run_attempt, 2);
  assert.equal(outdated.workflows.find(run => run.id === 42).conclusion, 'success');
});

test('head, base, merge candidate, rules and review changes during collection invalidate provisional readiness', async () => {
  for (const changed of ['head', 'base', 'merge', 'review', 'classic', 'rules', 'permission']) {
    let prReads = 0, ruleReads = 0;
    const result = await observe(async (path, query) => {
      const response = await api()(path, query);
      if (path === '/graphql' && ++prReads === 2) {
        if (changed === 'permission') return { status: 403, headers: {}, body: {} };
        const final = structuredClone(pr);
        if (changed === 'head') final.headRefOid = 'd'.repeat(40);
        if (changed === 'base') final.baseRefOid = 'd'.repeat(40);
        if (changed === 'merge') final.potentialMergeCommit.oid = 'd'.repeat(40);
        if (changed === 'review') final.reviewDecision = 'CHANGES_REQUESTED';
        if (changed === 'classic') final.baseRef.branchProtectionRule = { requiresStatusChecks: true, requiredStatusChecks: [{ context: 'new-check', app: null }] };
        return { status: 200, headers: {}, body: { data: { repository: { pullRequest: final } } } };
      }
      if (path.includes('/rules/branches/') && ++ruleReads === 2 && changed === 'rules') return { status: 200, headers: {}, body: [...rules, { type: 'pull_request', parameters: { required_approving_review_count: 2 } }] };
      return response;
    }, 'example', 'fixture', 'dev');
    assert.equal(result.readiness, 'unknown', changed); assert.equal(result.freshness, 'stale');
    assert.equal(result.reasonCodes[0], changed === 'permission' ? 'GITHUB_PERMISSION_DENIED' : 'GITHUB_OBSERVATION_CHANGED');
  }
});

test('missing or malformed rule and app identity cannot silently become any-source checks', async () => {
  for (const app of [{}, { databaseId: null }, { databaseId: 0 }, { databaseId: '1' }]) {
    const malformed = { ...pr, baseRef: { branchProtectionRule: { requiresStatusChecks: true, requiredStatusChecks: [{ context: 'test', app }] } } };
    const result = await observe(async path => path === '/graphql' ? { status: 200, headers: {}, body: { data: { repository: { pullRequest: malformed } } } } : api()(path), 'example', 'fixture', 'dev');
    assert.equal(result.readiness, 'unknown'); assert.equal(result.reasonCodes[0], 'GITHUB_RULES_UNKNOWN');
  }
  for (const rule of [{}, { type: null }, { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'test', integration_id: 0 }] } }, { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'test', integration_id: '1' }] } }]) {
    assert.throws(() => readiness(pr, [check], [rule]), error => error.code === 'GITHUB_RULES_UNKNOWN');
  }
});
