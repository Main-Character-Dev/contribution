import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Journal } from '../packages/engine/dist/journal.js';
import { Engine } from '../packages/engine/dist/service.js';
import { Fault, digest } from '../packages/engine/dist/core.js';
import { repository, commit, git } from './integration/service.mjs';

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ct-task-capture-')), state = join(root, 'state'), path = repository(root), base = commit(path), task = join(root, 'task');
  git(path, 'worktree', 'add', '--detach', task, base); const tip = commit(task, 'done.txt', 'selected work');
  let store = new Journal(state), engine = new Engine(store, { identity: 'fixture' }); const repo = await engine.repos.add(path);
  store.setMeta('paused', true);
  const args = { repo: repo.id, requestId: randomUUID(), sourcePath: task, sourceTip: tip, base, metadata: { schemaVersion: 1 } };
  const call = (command, input) => engine.dispatch({ schemaVersion: 1, command, args: input, cwd: path });
  return { root, path, task, tip, base, repo, args, call, get store() { return store; }, get engine() { return engine; },
    reopen: () => { engine.stopping = true; store.close(); store = new Journal(state); engine = new Engine(store, { identity: 'fixture' }); },
    cleanup: async () => { engine.stopping = true; while (engine.active.size) await new Promise(resolve => setTimeout(resolve, 10)); store.close(); rmSync(root, { recursive: true }); } };
}

test('validated task capture survives restart and an advanced dirty source before admission', async t => {
  for (const stage of ['selection', 'admission']) {
    const f = await fixture(); try {
      const original = stage === 'selection' ? f.store.put.bind(f.store) : f.store.admit.bind(f.store); let stopped = false;
      const mock = t.mock.method(f.store, stage === 'selection' ? 'put' : 'admit', (...args) => {
        if (stage === 'admission' && args[1] === 'submit' && !stopped) { stopped = true; throw new Fault('FIXTURE_STOPPED', 'Before admission'); }
        const value = original(...args);
        if (stage === 'selection' && args[0] === 'captureIntent' && !stopped) { stopped = true; throw new Fault('FIXTURE_STOPPED', 'After durable eligibility'); }
        return value;
      });
      const failed = await f.call('submit', f.args); assert.equal(failed.error.code, 'FIXTURE_STOPPED'); assert.equal(failed.result.requestRetained, true); assert.equal(failed.result.requestId, f.args.requestId); mock.mock.restore();
      assert.equal(f.store.record('captureIntent', f.args.requestId).validated, true); assert.equal(f.store.byRequest(f.args.requestId), undefined);
      f.reopen(); const later = commit(f.task, 'later.txt', 'later committed work'); writeFileSync(join(f.task, 'draft'), 'unrelated draft');
      const resume = { repo: f.repo.id, requestId: f.args.requestId, resume: true };
      f.store.setMeta('maintenance', true);
      const held = await f.call('submit', resume); assert.equal(held.error.code, 'SERVICE_MAINTENANCE'); assert.equal(held.result.requestRetained, true);
      f.store.setMeta('maintenance', false);
      const replies = await Promise.all([f.call('submit', resume), f.call('submit', f.args)]);
      assert.equal(replies[0].error, null, JSON.stringify(replies[0])); assert.equal(replies[1].operationId, replies[0].operationId);
      const capture = f.store.record('capture', f.args.requestId); assert.deepEqual(capture.commits, [f.tip]); assert.equal(git(f.path, 'rev-parse', capture.retention), f.tip);
      assert.equal(git(f.task, 'rev-parse', 'HEAD'), later); assert.equal(readFileSync(join(f.task, 'draft'), 'utf8'), 'unrelated draft');
    } finally { t.mock.restoreAll(); await f.cleanup(); }
  }
});

test('accepted task replay retains its original policy after later configuration changes', async () => {
  const f = await fixture(); try {
    const accepted = await f.call('submit', f.args); assert.equal(accepted.error, null);
    const original = f.store.get(accepted.operationId); f.store.update(original, { state: 'cancelled' });
    const config = { ...f.repo.config, name: 'Later display name' };
    const changed = await f.call('repos.configure', { repo: f.repo.id, config, expectedRevision: f.repo.revision, requestId: randomUUID() }); assert.equal(changed.error, null, JSON.stringify(changed));
    assert.equal((await f.call('submit', f.args)).operationId, accepted.operationId); assert.equal(f.store.get(accepted.operationId).input.policy, original.input.policy);
    assert.equal((await f.call('submit', { repo: f.repo.id, requestId: f.args.requestId, resume: true })).operationId, accepted.operationId);
    assert.notEqual(digest(config), original.input.policy);
    assert.equal((await f.call('submit', { ...f.args, metadata: { schemaVersion: 1, integrationMessage: 'different' } })).error.code, 'REQUEST_ID_CONFLICT');
    assert.equal((await f.call('submit', { ...f.args, resume: true })).error.code, 'INVALID_USAGE');
  } finally { await f.cleanup(); }
});

test('an interrupted task cannot overwrite a changed retention ref or select a new source under its old identity', async t => {
  const f = await fixture(); try {
    const original = f.store.admit.bind(f.store);
    const mock = t.mock.method(f.store, 'admit', (...args) => { if (args[1] === 'submit') throw new Fault('FIXTURE_STOPPED', 'Before admission'); return original(...args); });
    assert.equal((await f.call('submit', f.args)).error.code, 'FIXTURE_STOPPED'); mock.mock.restore();
    const capture = f.store.record('capture', f.args.requestId), later = commit(f.task, 'later.txt', 'preserve later work');
    assert.equal((await f.call('submit', { ...f.args, sourceTip: later })).error.code, 'REQUEST_ID_CONFLICT');
    git(f.path, 'update-ref', capture.retention, later, f.tip);
    assert.equal((await f.call('submit', f.args)).error.code, 'CAPTURE_RECOVERY_REQUIRED'); assert.equal(git(f.path, 'rev-parse', capture.retention), later);
    assert.equal(f.store.byRequest(f.args.requestId), undefined);
  } finally { t.mock.restoreAll(); await f.cleanup(); }
});
