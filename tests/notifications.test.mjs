import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Journal } from '../packages/engine/dist/journal.js';
import { Milestones } from '../packages/engine/dist/notifications.js';
const setup = () => {
  const root = mkdtempSync(join(tmpdir(), 'ct-notice-')), store = new Journal(root), center = new Milestones(store);
  const repo = { id: randomUUID(), canonicalHostId: store.hostId, config: { name: 'Fixture' } };
  store.setMeta('settings', { notifications: { preferredHostId: store.hostId, success: true, failure: true } });
  return { root, store, center, repo, cleanup: () => { store.close(); rmSync(root, { recursive: true }); } };
};

test('local gate and delivery group by operation, and a lost delivery acknowledgement never grants another banner', () => {
  const f = setup(); try {
    const op = f.store.admit(randomUUID(), 'push', f.repo.id, {}, 'fixture', 'running');
    f.store.put('gate', op.operationId, { state: 'passed' }); f.center.synchronize([f.repo]);
    const gate = f.center.pending(f.store.hostId)[0]; assert.match(gate.title, /gate passed/);
    f.store.update(op, { state: 'succeeded', result: { delivery: 'delivered' } }); f.center.synchronize([f.repo]);
    const delivery = f.center.pending(f.store.hostId)[0]; assert.equal(delivery.id, gate.id); assert.notEqual(delivery.revision, gate.revision); assert.match(delivery.title, /Published/);
    assert.throws(() => f.center.claim(f.store.hostId, f.repo.id, gate.id, gate.revision, randomUUID()), error => error.code === 'NOTIFICATION_CHANGED');
    const request = randomUUID(), claim = f.center.claim(f.store.hostId, f.repo.id, delivery.id, delivery.revision, request);
    assert.equal(claim.newlyClaimed, true); assert.equal(f.center.claim(f.store.hostId, f.repo.id, delivery.id, delivery.revision, request).newlyClaimed, false);
    assert.throws(() => f.center.claim(f.store.hostId, f.repo.id, delivery.id, delivery.revision, randomUUID()), error => error.code === 'NOTIFICATION_ALREADY_CLAIMED');
    const restarted = new Milestones(f.store); restarted.synchronize([f.repo]); assert.equal(restarted.pending(f.store.hostId)[0].state, 'claimed');
    restarted.acknowledge(f.store.hostId, f.repo.id, delivery.id, delivery.revision, claim.notice.claim.token, false);
    assert.equal(restarted.pending(f.store.hostId)[0].state, 'uncertain');
    restarted.acknowledge(f.store.hostId, f.repo.id, delivery.id, delivery.revision, claim.notice.claim.token, true);
    assert.deepEqual(restarted.pending(f.store.hostId), []);
  } finally { f.cleanup(); }
});

test('preferred host and attention preferences fence delivery while remote reruns supersede obsolete failures', () => {
  const f = setup(); try {
    const target = randomUUID(), workflow = { id: 123, run_attempt: 1, name: 'Scheduled task', status: 'completed', conclusion: 'failure', updated_at: new Date().toISOString(), html_url: 'https://github.com/example/fixture/actions/runs/123' };
    f.store.setMeta('settings', { notifications: { preferredHostId: target, success: true, failure: true } });
    f.store.put('github', f.repo.id, { freshness: 'fresh', workflows: [workflow], readiness: 'no_pull_request' });
    f.center.synchronize([f.repo]); assert.deepEqual(f.center.pending(f.store.hostId), []);
    const notice = f.center.pending(target)[0];
    assert.throws(() => f.center.claim(f.store.hostId, f.repo.id, notice.id, notice.revision, randomUUID()), error => error.code === 'NOTIFICATION_CHANGED');
    f.store.put('github', f.repo.id, { freshness: 'fresh', workflows: [{ ...workflow, run_attempt: 2, status: 'in_progress', conclusion: null }], readiness: 'no_pull_request' });
    f.center.synchronize([f.repo]); assert.deepEqual(f.center.pending(target), []);
    f.store.put('github', f.repo.id, { freshness: 'fresh', workflows: [{ ...workflow, run_attempt: 2 }], readiness: 'no_pull_request' });
    f.center.synchronize([f.repo]); assert.equal(f.center.pending(target)[0].id, notice.id); assert.notEqual(f.center.pending(target)[0].revision, notice.revision);
    f.store.setMeta('settings', { notifications: { preferredHostId: target, success: true, failure: false } }); assert.deepEqual(f.center.pending(target), []);
  } finally { f.cleanup(); }
});

test('a superseded delivered failure is withdrawn once and stale GitHub readiness cannot create a success alert', () => {
  const f = setup(); try {
    const workflow = { id: 7, run_attempt: 1, name: 'Test', status: 'completed', conclusion: 'failure', updated_at: new Date().toISOString() };
    f.store.put('github', f.repo.id, { freshness: 'fresh', workflows: [workflow], readiness: 'no_pull_request' }); f.center.synchronize([f.repo]);
    const notice = f.center.pending(f.store.hostId)[0], claim = f.center.claim(f.store.hostId, f.repo.id, notice.id, notice.revision, randomUUID());
    f.center.acknowledge(f.store.hostId, f.repo.id, notice.id, notice.revision, claim.notice.claim.token, true);
    f.store.put('github', f.repo.id, { freshness: 'fresh', workflows: [{ ...workflow, run_attempt: 2, conclusion: 'success' }], readiness: 'no_pull_request' }); f.center.synchronize([f.repo]);
    assert.equal(f.center.pending(f.store.hostId)[0].state, 'superseded');
    f.center.acknowledge(f.store.hostId, f.repo.id, notice.id, notice.revision, claim.notice.claim.token, false);
    assert.deepEqual(f.center.pending(f.store.hostId), []);
    f.store.put('github', f.repo.id, { freshness: 'fresh', workflows: [], readiness: 'ready', pullRequest: { number: 1, headRefOid: 'a'.repeat(40), baseRefOid: 'b'.repeat(40), url: 'https://github.com/example/fixture/pull/1' } });
    f.center.synchronize([f.repo]); assert.equal(f.center.pending(f.store.hostId)[0].outcome, 'success');
    f.store.put('github', f.repo.id, { freshness: 'stale', readiness: 'unknown', workflows: [] }); f.center.synchronize([f.repo]); assert.deepEqual(f.center.pending(f.store.hostId), []);
  } finally { f.cleanup(); }
});
