import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fixture, repository, commit, git } from './integration/service.mjs';
import { Journal } from '../packages/engine/dist/journal.js';

async function configured(f, script = 'exit 0', gate = 'enabled') {
  const repo = repository(f.root); commit(repo); const remote = join(f.root, 'remote.git'); mkdirSync(remote); git(remote, 'init', '--bare'); git(repo, 'remote', 'add', 'origin', remote);
  const added = (await f.call('repos.add', { path: repo })).result.repository;
  const config = structuredClone(added.config); config.publication.remote = 'origin'; config.publication.branch = 'dev'; config.validation.gate = gate;
  config.validation.checks = [{ id: 'fixture', profiles: ['local-development'], argv: ['/bin/sh', '-c', script], cwd: '.', timeoutSeconds: 10, reuse: 'never' }];
  assert.equal((await f.call('repos.configure', { repo: added.id, config, expectedRevision: added.revision, requestId: randomUUID() })).error, null);
  return { repo, remote, id: added.id };
}
async function select(f, repo) { const preview = await f.call('push', { repo, preview: true }); assert.equal(preview.error, null); return { repo, expectedTip: preview.result.expectedTip, scopeToken: preview.result.scopeToken, requestId: randomUUID() }; }

test('restart reconciles uncertain push delivery by observing the frozen remote without replaying transport', async () => {
  for (const delivered of [true, false]) {
    const f = await fixture(); try {
      const c = await configured(f); await f.call('service.pause'); const selected = await select(f, c.id), accepted = await f.call('push', selected);
      if (delivered) git(c.repo, '-c', 'core.hooksPath=/dev/null', 'push', 'origin', 'dev');
      await f.stop();
      const journal = new Journal(f.state), op = journal.get(accepted.operationId);
      journal.update(op, { state: 'running', effectDispatched: true, result: { delivery: 'unknown' } });
      journal.put('gate', op.operationId, { state: 'passed', sourceTip: selected.expectedTip }); journal.close();
      const marker = join(c.remote, 'transport-replayed');
      writeFileSync(join(c.remote, 'hooks/pre-receive'), '#!/bin/sh\ntouch "' + marker + '"\nexit 1\n', { mode: 0o700 });
      await f.start(); const result = await f.call('runs.get', { operationId: op.operationId });
      assert.equal(result.operationState, delivered ? 'succeeded' : 'outcome_unknown');
      assert.equal(result.result.delivery, delivered ? 'delivered' : 'unknown');
      if (delivered) assert.equal(result.result.observedBy, 'remote_ref_reconciliation');
      const { existsSync } = await import('node:fs'); assert.equal(existsSync(marker), false);
      assert.equal((await f.call('push', selected)).operationId, op.operationId);
    } finally { await f.cleanup(); }
  }
});

test('a matching remote never turns absent, failed or differently bound gate evidence into recovered success', async () => {
  for (const state of ['missing', 'failed', 'wrong-tip']) {
    const f = await fixture(); try {
      const c = await configured(f); await f.call('service.pause');
      const selected = await select(f, c.id), accepted = await f.call('push', selected);
      git(c.repo, '-c', 'core.hooksPath=/dev/null', 'push', 'origin', 'dev'); await f.stop();
      const journal = new Journal(f.state), op = journal.get(accepted.operationId);
      journal.update(op, { state: 'running', effectDispatched: true, result: { delivery: 'unknown' } });
      if (state !== 'missing') journal.put('gate', op.operationId, { state: state === 'failed' ? 'failed' : 'passed', sourceTip: state === 'wrong-tip' ? 'a'.repeat(40) : selected.expectedTip });
      journal.close(); await f.start();
      const result = await f.call('runs.reconcile', { operationId: op.operationId });
      assert.equal(result.operationState, 'outcome_unknown'); assert.equal(result.result.delivery, 'delivered');
      assert.equal(result.result.gateReconciliationRequired, true);
      assert.equal((await f.call('push', selected)).operationId, op.operationId);
    } finally { await f.cleanup(); }
  }
});

test('push comparison and delivery observation use the selected push URL, independently of fetch URL', async () => {
  const f = await fixture(); try {
    const c = await configured(f), destination = join(f.root, 'publication.git'); mkdirSync(destination); git(destination, 'init', '--bare');
    git(c.repo, '-c', 'core.hooksPath=/dev/null', 'push', 'origin', 'dev');
    git(c.repo, 'remote', 'set-url', '--push', 'origin', destination);
    const preview = await f.call('push', { repo: c.id, preview: true });
    assert.equal(preview.result.scope.destination, destination);
    const accepted = await f.call('push', { repo: c.id, expectedTip: preview.result.expectedTip, scopeToken: preview.result.scopeToken, requestId: randomUUID() });
    const result = await f.wait(accepted.operationId);
    assert.equal(result.operationState, 'succeeded', JSON.stringify(result));
    assert.equal(result.result.delivery, 'delivered'); assert.equal(git(destination, 'rev-parse', 'refs/heads/dev'), preview.result.expectedTip);
  } finally { await f.cleanup(); }
});

test('queued checks reject changed source and duplicates keep the original captured selection', async () => {
  const f = await fixture(); try {
    const c = await configured(f); await f.call('service.pause');
    const request = { repo: c.id, canonical: true, requestId: randomUUID() };
    const accepted = await f.call('checks.run', request); assert.equal(accepted.error, null);
    commit(c.repo, 'later.txt', 'later'); await f.call('service.resume');
    const result = await f.wait(accepted.operationId); assert.equal(result.error.code, 'SOURCE_CHANGED');
    assert.equal((await f.call('checks.run', request)).operationId, accepted.operationId);
    assert.equal((await f.call('checks.run', { ...request, checkId: 'different' })).error.code, 'REQUEST_ID_CONFLICT');
  } finally { await f.cleanup(); }
});

test('queued publication never absorbs a newer tip; stale destination previews reject before admission', async () => {
  const f = await fixture(); try {
    const c = await configured(f); await f.call('service.pause'); const selected = await select(f, c.id), accepted = await f.call('push', selected);
    commit(c.repo, 'new.txt', 'newer work'); await f.call('service.resume');
    const result = await f.wait(accepted.operationId); assert.equal(result.operationState, 'failed'); assert.equal(result.error.code, 'STALE_PUSH_SELECTION');
    assert.equal((await f.call('push', selected)).operationId, accepted.operationId, 'dedupe returns the retained request even after HEAD advances');
    const fresh = await select(f, c.id); git(c.repo, 'remote', 'set-url', 'origin', join(f.root, 'different.git'));
    assert.equal((await f.call('push', fresh)).error.code, 'STALE_PUSH_SELECTION'); assert.equal(git(c.remote, 'for-each-ref'), '');
  } finally { await f.cleanup(); }
});

test('gate failure and remote rejection retain distinct gate versus delivery evidence', async () => {
  for (const failure of ['gate', 'remote']) {
    const f = await fixture(); try {
      const c = await configured(f, failure === 'gate' ? 'echo fixture-check; exit 7' : 'echo fixture-check; exit 0');
      if (failure === 'remote') writeFileSync(join(c.remote, 'hooks/pre-receive'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
      const accepted = await f.call('push', await select(f, c.id)), result = await f.wait(accepted.operationId);
      assert.equal(result.operationState, 'failed', JSON.stringify(result));
      assert.equal(result.result.gate.state, failure === 'gate' ? 'failed' : 'passed'); assert.equal(result.result.delivery, 'not_delivered');
      assert.equal(git(c.remote, 'for-each-ref'), '');
    } finally { await f.cleanup(); }
  }
});

test('inactive gates remain inactive and external hooks report delivery unobserved', async () => {
  const f = await fixture(); try {
    const c = await configured(f, 'exit 99', 'inactive');
    const accepted = await f.call('push', await select(f, c.id)), result = await f.wait(accepted.operationId);
    assert.equal(result.operationState, 'succeeded', JSON.stringify(result)); assert.equal(result.result.gate.state, 'inactive');
    commit(c.repo, 'external.txt', 'external'); git(c.repo, 'push', 'origin', 'dev');
    const runs = (await f.call('runs.list')).result.operations, external = runs.find(run => run.kind === 'external_gate');
    assert.equal(external.result.delivery, 'unobserved'); assert.equal(external.result.gate.state, 'inactive');
  } finally { await f.cleanup(); }
});

test('concurrent requests keep distinct logs and cancellation ends only the owned check', async () => {
  const f = await fixture(); try {
    const c = await configured(f, 'echo first-marker; sleep 8; echo last-marker');
    const selected = await select(f, c.id), first = await f.call('push', selected), second = await f.call('push', { ...selected, requestId: randomUUID() });
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !(await f.call('logs', { operationId: first.operationId })).result.text.includes('first-marker')) await new Promise(resolve => setTimeout(resolve, 30));
    await f.call('runs.cancel', { operationId: second.operationId }); await f.call('runs.cancel', { operationId: first.operationId });
    const firstResult = await f.wait(first.operationId), secondResult = await f.wait(second.operationId);
    assert.equal(secondResult.operationState, 'cancelled'); assert.notEqual(firstResult.operationState, 'succeeded');
    const firstLog = (await f.call('logs', { operationId: first.operationId })).result, secondLog = (await f.call('logs', { operationId: second.operationId })).result;
    assert.notEqual(firstLog.attemptId, secondLog.attemptId); assert.match(firstLog.text, /first-marker/); assert.doesNotMatch(secondLog.text, /first-marker/);
    assert.equal(readFileSync(join(f.state, 'logs', `${firstLog.attemptId}.log`), 'utf8'), firstLog.text);
  } finally { await f.cleanup(); }
});
