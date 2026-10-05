import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, statSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { reportingPatch, reportingEnvironment } from '../packages/adapters/dist/index.js';
import { LegacyReporting } from '../packages/engine/dist/legacy-reporting.js';
import { Journal } from '../packages/engine/dist/journal.js';
import { repository, commit, git } from './integration/service.mjs';

const roboty = `import path from 'node:path';
const git = () => '/fixture/.git';
export function resolvePrePushEvidencePaths(cwd = process.cwd()) {
 const logDirectory = '/fixture/logs';
 return { logDirectory,
 statusLog: path.join(logDirectory, "pre-push-latest.log"),
 summaryLog: path.join(logDirectory, "pre-push-summary-latest.log"),
 repairJson: path.join(logDirectory, "pre-push-repair-latest.json"),
 repairPrompt: path.join(logDirectory, "pre-push-repair-latest.txt"),
 repairArchive: path.join(logDirectory, "pre-push-repairs"),
 };
}
export const gateSelection = ['unchanged-policy-owner'];
`;

test('reporting patches preserve legacy defaults and separate every managed output', async () => {
  const patched = reportingPatch('roboty-v1', roboty);
  assert.equal(patched.replacements, 6); assert.throws(() => reportingPatch('roboty-v1', patched.source), /seam changed/);
  const original = await import('data:text/javascript;base64,' + Buffer.from(roboty).toString('base64'));
  const candidate = await import('data:text/javascript;base64,' + Buffer.from(patched.source).toString('base64'));
  assert.deepEqual(candidate.resolvePrePushEvidencePaths('/fixture', {}), original.resolvePrePushEvidencePaths('/fixture'));
  const paths = { statusLog: '/one/status', summaryLog: '/one/summary', repairJson: '/one/repair.json', repairPrompt: '/one/repair.txt', archive: '/one/archive' };
  const observed = candidate.resolvePrePushEvidencePaths('/fixture', reportingEnvironment('roboty-v1', paths));
  for (const key of ['statusLog', 'summaryLog', 'repairJson', 'repairPrompt']) assert.equal(observed[key], paths[key]);
  assert.equal(observed.repairArchive, paths.archive); assert.deepEqual(candidate.gateSelection, original.gateSelection);
  assert.deepEqual(reportingEnvironment('glassalpha-v1', paths), {});
  assert.equal(reportingPatch('maincharacter-v1', '# existing hook\n').source, '# existing hook\n');
  const mathy = 'failureArchive: path.join(logDirectory, `${EVIDENCE_PREFIX}-failures`),';
  assert.match(reportingPatch('mathy-v1', mathy).source, /environment.MATHY_PRE_PUSH_FAILURE_ARCHIVE/);
  assert.equal(reportingEnvironment('mathy-v1', paths).MATHY_PRE_PUSH_FAILURE_ARCHIVE, paths.archive);
});

test('parallel attempt reporters cannot overwrite another attempt or its sealed snapshot', () => {
  const root = mkdtempSync(join(tmpdir(), 'ct-reporting-')), store = new Journal(join(root, 'state'));
  try {
    const repo = { id: randomUUID(), config: { validation: { adapter: 'roboty-v1' } } }, reporting = new LegacyReporting(store);
    const one = store.admit(randomUUID(), 'push', repo.id, {}, 'fixture'), two = store.admit(randomUUID(), 'push', repo.id, {}, 'fixture');
    const first = reporting.allocate(one, repo), second = reporting.allocate(two, repo);
    assert.notEqual(first.paths.directory, second.paths.directory);
    writeFileSync(first.paths.statusLog, 'first complete evidence'); writeFileSync(second.paths.statusLog, 'second complete evidence');
    assert.deepEqual(reporting.allocate(one, repo), first); assert.equal(readFileSync(first.paths.statusLog, 'utf8'), 'first complete evidence');
    mkdirSync(first.paths.archive, { mode: 0o700 }); writeFileSync(join(first.paths.archive, 'repair.json'), '{"fixture":true}');
    const retained = reporting.seal(one); assert.equal(retained.interpretation, 'retained_output_only'); assert.equal(retained.files.length, 2);
    writeFileSync(first.paths.statusLog, 'late unrelated change'); writeFileSync(second.paths.statusLog, 'second updated');
    assert.equal(readFileSync(join(retained.snapshot, 'status.log'), 'utf8'), 'first complete evidence');
    assert.equal(statSync(join(retained.snapshot, 'status.log')).mode & 0o777, 0o400);
    assert.deepEqual(reporting.seal(one), retained);
    symlinkSync(join(retained.snapshot, 'status.log'), second.paths.summaryLog);
    assert.throws(() => reporting.seal(two), error => error.code === 'ATTEMPT_EVIDENCE_INVALID');
  } finally { store.close(); rmSync(root, { recursive: true }); }
});

test('private reporting proposals preserve project files, survive source changes and reserve request identity', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ct-reporting-plan-')), store = new Journal(join(root, 'state'));
  try {
    const path = repository(root); mkdirSync(join(path, 'scripts')); writeFileSync(join(path, 'scripts/local-pre-push.mjs'), roboty); commit(path);
    const repo = { id: randomUUID(), path, config: { validation: { adapter: 'roboty-v1', gate: 'enabled' } } }, reporting = new LegacyReporting(store), requestId = randomUUID();
    const before = git(path, 'status', '--porcelain'), original = readFileSync(join(path, 'scripts/local-pre-push.mjs'), 'utf8');
    const [first, duplicate] = await Promise.allSettled([reporting.proposal(repo, requestId), reporting.proposal(repo, requestId)]);
    assert.equal(first.status, 'fulfilled'); assert.equal(duplicate.status, 'rejected'); assert.equal(duplicate.reason.code, 'MIGRATION_PROPOSAL_PENDING');
    const result = first.value; assert.equal(result.mutation, 'none'); assert.equal(result.replacements, 6); assert.equal(result.stage, 'reporting_only');
    assert.equal(readFileSync(result.privateReview.before, 'utf8'), original); assert.equal(statSync(result.privateReview.after).mode & 0o777, 0o600);
    assert.equal(git(path, 'status', '--porcelain'), before); assert.equal(readFileSync(join(path, 'scripts/local-pre-push.mjs'), 'utf8'), original);
    writeFileSync(join(path, 'scripts/local-pre-push.mjs'), 'changed by project owner');
    assert.deepEqual(await reporting.proposal(repo, requestId), result);
    await assert.rejects(reporting.proposal({ ...repo, id: randomUUID() }, requestId), error => error.code === 'REQUEST_ID_CONFLICT');
    await assert.rejects(reporting.proposal(repo, randomUUID()), /seam changed/);
  } finally { store.close(); rmSync(root, { recursive: true }); }
});

test('inactive adoption proposes no validator or hook activation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ct-inactive-plan-')), store = new Journal(join(root, 'state'));
  try {
    const path = repository(root); commit(path);
    const repo = { id: randomUUID(), path, config: { validation: { adapter: 'glassalpha-v1', gate: 'inactive' } } };
    const plan = await new LegacyReporting(store).proposal(repo, randomUUID());
    assert.equal(plan.gate, 'inactive'); assert.equal(plan.replacements, 0); assert.equal(plan.sourcePath, null);
    assert.equal(plan.beforeDigest, plan.afterDigest); assert.match(plan.activation, /^blocked/);
  } finally { store.close(); rmSync(root, { recursive: true }); }
});
