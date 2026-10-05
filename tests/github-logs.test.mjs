import test from 'node:test';
import assert from 'node:assert/strict';
import { workflowJobs, workflowLog } from '../packages/engine/dist/github.js';
const prefix = '/repos/example/fixture';
const job = { id: 17, run_id: 8, run_attempt: 2, status: 'completed', steps: [{ name: 'Fixture step', status: 'completed', conclusion: 'failure' }] };
const jobs = { status: 200, headers: {}, body: { jobs: [job] } };
const redirect = { status: 302, headers: { location: 'https://fixture.blob.core.windows.net/logs?private=temporary' }, body: null };
const api = async path => path.endsWith('/logs') ? redirect : jobs;

test('hosted logs retain exact attempt/job identity, redact text and never retain the signed URL', async () => {
  assert.deepEqual(await workflowJobs(api, prefix, 8, 2), [job]);
  const result = await workflowLog(api, prefix, 8, 2, 17, async url => { assert.equal(url, redirect.headers.location); return new Response('step failed\nghp_fixtureSecret\n', { status: 200 }); });
  assert.equal(result.state, 'available'); assert.equal(result.live, false); assert.equal(result.attempt, 2);
  assert.match(result.text, /step failed/); assert.doesNotMatch(JSON.stringify(result), /fixtureSecret|private=temporary/);
  const truncated = await workflowLog(api, prefix, 8, 2, 17, async () => new Response('x'.repeat(600000)));
  assert.equal(truncated.truncated, true); assert.equal(truncated.text.length, 512 * 1024);
});

test('active, expired, denied, missing and untrusted log locations are distinct from available logs', async () => {
  const forbiddenDownload = async () => { throw new Error('download must not run'); };
  const active = await workflowLog(async () => ({ ...jobs, body: { jobs: [{ ...job, status: 'in_progress' }] } }), prefix, 8, 2, 17, forbiddenDownload);
  assert.equal(active.state, 'not_yet_available');
  for (const [reply, state, reason] of [
    [{ status: 410, headers: {}, body: null }, 'expired', 'GITHUB_LOG_EXPIRED'],
    [{ status: 403, headers: {}, body: {} }, 'denied', 'GITHUB_PERMISSION_DENIED'],
    [{ status: 404, headers: {}, body: {} }, 'unavailable', 'GITHUB_NOT_FOUND_OR_INACCESSIBLE'],
    [{ ...redirect, headers: { location: 'http://127.0.0.1/private' } }, 'unavailable', 'GITHUB_LOG_REDIRECT_INVALID'],
  ]) {
    const result = await workflowLog(async path => path.endsWith('/logs') ? reply : jobs, prefix, 8, 2, 17, forbiddenDownload);
    assert.equal(result.state, state); assert.equal(result.reasonCode, reason); assert.equal(result.text, null);
  }
  const wrongAttempt = await workflowLog(api, prefix, 8, 3, 17, forbiddenDownload);
  assert.equal(wrongAttempt.reasonCode, 'GITHUB_JOB_IDENTITY_CHANGED');
});
