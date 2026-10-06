import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Journal } from '../packages/engine/dist/journal.js';
import { ResourceLifecycle } from '../packages/engine/dist/resource-lifecycle.js';
import { digest } from '../packages/engine/dist/core.js';

function crashed(phase, lifetime = 'ephemeral') {
  const root = mkdtempSync(join(tmpdir(), 'ct-cleanup-crash-')), state = join(root, 'state');
  const child = spawnSync(process.execPath, [join(import.meta.dirname, 'fixtures/resource-cleanup-crash.mjs'), state, phase, lifetime], { timeout: 15000, encoding: 'utf8' });
  if (child.signal !== 'SIGKILL' || child.error) { rmSync(root, { recursive: true }); assert.fail(JSON.stringify({ error: child.error?.message, signal: child.signal, status: child.status, stderr: child.stderr })); }
  const store = new Journal(state), info = store.getMeta('crashFixture');
  let context = { clone: 'crash-fixture', revision: 'v1' }, boot = 'crash-fixture-boot', observation = 'normal', stopFailure = false, closeWait, stops = 0;
  const lifecycle = new ResourceLifecycle(store, () => context, () => boot);
  lifecycle.register({ id: 'crash-owner', version: 1,
    observe: async r => { if (observation === 'stalled') return new Promise(() => {}); if (observation === 'failed') throw new Error('Inspection failed'); return store.record('fixtureAbsent', r.resourceId) ? 'absent' : r.identity; },
    stop: async (r, guard) => { guard(); stops++; if (closeWait) await closeWait; guard(); if (stopFailure) throw new Error('Controlled close failure'); store.transaction(() => { store.put('fixtureAbsent', r.resourceId, true); store.put('fixtureEffects', r.resourceId, (store.record('fixtureEffects', r.resourceId) ?? 0) + 1); }); }
  });
  return { store, info, lifecycle, stops: () => stops, context: value => context = value, boot: value => boot = value, observe: value => observation = value, stopFailure: value => stopFailure = value, closeWait: value => closeWait = value,
    close: () => { store.close(); rmSync(root, { recursive: true }); } };
}

for (const lifetime of ['interactive', 'persistent']) {
  test(`AT-LC03/13 explicit ${lifetime} cleanup finishes after restart confirms absence without another close`, async () => {
    const f = crashed('stop-absent', lifetime);
    try {
      await f.lifecycle.reconcile(); assert.equal(f.stops(), 0);
      assert.deepEqual((await f.lifecycle.apply(f.info.token, f.info.request)).released, f.info.ids);
      assert.equal(f.stops(), 0); f.store.assertRepositoryAvailable(f.info.repo);
      for (const id of f.info.ids) { assert.equal(f.lifecycle.get(id).lifetime, lifetime); assert.equal(f.store.record('fixtureEffects', id), 1); }
    } finally { f.close(); }
  });
}

for (const phase of ['admission-before', 'admission-after', 'stop-state-before', 'stop-state-after', 'first-stop-present', 'stop-present', 'stop-absent', 'finish-state-before', 'finish-state-after',
  'error-state-before', 'error-state-after', 'cleanup-progress-before', 'cleanup-progress-after', 'cleanup-result-before', 'cleanup-result-after']) {
  test(`AT-LC08/13 SIGKILL at ${phase} preserves one exact cleanup and independent effect receipts`, async () => {
    const f = crashed(phase);
    try {
      const before = f.store.record('resourceCleanup', f.info.request);
      if (phase.startsWith('admission-')) { assert.equal(before, undefined); assert.equal(f.store.records('resourceCleanupExpectation').length, 0); }
      else for (const id of f.info.ids) assert.equal(f.store.record('resourceCleanupExpectation', id).current, digest(f.lifecycle.get(id)), 'No torn state/continuation write can commit');
      await f.lifecycle.reconcile();
      // An admission transaction that never committed grants no retained review.
      // Startup observation requires a new preview, with the same unchanged IDs.
      const token = before ? f.info.token : (await f.lifecycle.preview()).scopeToken;
      const result = await f.lifecycle.apply(token, f.info.request);
      assert.deepEqual(result.released, f.info.ids); assert.equal(f.store.record('resourceCleanup', f.info.request).state, 'completed');
      f.store.assertRepositoryAvailable(f.info.repo);
      for (const id of f.info.ids) { assert.equal(f.lifecycle.get(id).state, 'stopped'); assert.equal(f.store.record('fixtureEffects', id), 1, 'A confirmed absent effect must not be repeated'); }
      const stops = f.stops(); assert.deepEqual(await f.lifecycle.apply(token, f.info.request), result); assert.equal(f.stops(), stops);
      await assert.rejects(f.lifecycle.apply(randomUUID(), f.info.request), { code: 'REQUEST_ID_CONFLICT' });
    } finally { f.close(); }
  });
}

for (const drift of ['generation', 'token', 'identity', 'pin', 'dependencies', 'host', 'boot', 'clone', 'enrollment']) {
  test(`AT-LC04/05/13 restart cannot endorse external ${drift} drift as cleanup progress`, async () => {
    const f = crashed('stop-present');
    try {
      const id = f.info.ids[1], prior = f.lifecycle.get(id), proof = f.store.record('resourceCleanupExpectation', id);
      if (drift === 'generation') f.store.put('resource', id, { ...prior, generation: prior.generation + 1 });
      if (drift === 'token') f.store.put('resource', id, { ...prior, token: randomUUID() });
      if (drift === 'identity') f.store.put('resource', id, { ...prior, identity: { type: 'provider', value: { handle: randomUUID() } } });
      if (drift === 'pin') f.store.put('resource', id, { ...prior, pinned: true });
      if (drift === 'dependencies') f.store.put('resource', id, { ...prior, dependencies: [randomUUID()] });
      if (drift === 'host') f.store.put('resource', id, { ...prior, hostId: randomUUID() });
      if (drift === 'boot') f.boot('replacement-boot');
      if (drift === 'clone') f.context({ clone: 'replacement-clone', revision: 'v1' });
      if (drift === 'enrollment') f.context({ clone: 'crash-fixture', revision: 'v2' });
      await f.lifecycle.reconcile(); assert.deepEqual(f.store.record('resourceCleanupExpectation', id), proof);
      await assert.rejects(f.lifecycle.apply(f.info.token, f.info.request), { code: 'RESOURCE_SELECTION_CHANGED' });
      assert.equal(f.stops(), 0); assert.equal(f.store.record('resourceCleanup', f.info.request).state, 'stopping');
      assert.throws(() => f.store.assertRepositoryAvailable(f.info.repo));
      const preview = await f.lifecycle.preview();
      if (preview.candidates.length) await assert.rejects(f.lifecycle.apply(preview.scopeToken, randomUUID()), { code: 'RESOURCE_CLEANUP_PENDING' });
      else assert.deepEqual((await f.lifecycle.apply(preview.scopeToken, randomUUID())).released, []);
      // An empty protected preview is a harmless no-op, never an escape from
      // the original retained fence or authority to consume changed resources.
      assert.equal(f.store.record('resourceCleanup', f.info.request).state, 'stopping'); assert.throws(() => f.store.assertRepositoryAvailable(f.info.repo));
    } finally { f.close(); }
  });
}

for (const observation of ['stalled', 'failed']) {
  test(`AT-LC08/13 ${observation} restart observation retains resumable cleanup without granting teardown`, async () => {
    const f = crashed('first-stop-present');
    try {
      f.observe(observation); await f.lifecycle.reconcile(10); assert.equal(f.stops(), 0);
      for (const id of f.info.ids) { assert.equal(f.lifecycle.get(id).state, 'unresolved'); assert.equal(f.store.record('resourceCleanupExpectation', id).current, digest(f.lifecycle.get(id))); }
      f.observe('normal'); const result = await f.lifecycle.apply(f.info.token, f.info.request);
      assert.deepEqual(result.released, f.info.ids); f.store.assertRepositoryAvailable(f.info.repo);
    } finally { f.close(); }
  });
}

test('AT-LC13 continuation preserves a new resource outside its accepted selection', async () => {
  const f = crashed('cleanup-progress-after');
  try {
    await f.lifecycle.reconcile();
    const op = f.store.get(f.info.operationId), intent = f.lifecycle.begin(op, { requestId: randomUUID(), kind: 'provider', owner: 'utility', lifetime: 'ephemeral', adapter: 'crash-owner', adapterVersion: 1,
      scope: randomUUID(), reason: 'Independent fixture allocation', stopAction: 'crash-owner.close' });
    const newer = f.lifecycle.grant(f.lifecycle.allocate(intent, { type: 'provider', value: { handle: intent.resourceId } }));
    const result = await f.lifecycle.apply(f.info.token, f.info.request);
    assert.deepEqual(result.released, f.info.ids); assert.equal(f.lifecycle.get(newer.resourceId).state, 'active');
    assert.equal(f.store.record('fixtureEffects', newer.resourceId), undefined);
  } finally { f.close(); }
});

test('AT-LC06/13 observation preserves cleanup retry/backoff; confirmed absence finishes without another close', async () => {
  const f = crashed('stop-present');
  try {
    f.stopFailure(true); await assert.rejects(f.lifecycle.apply(f.info.token, f.info.request), /Controlled close failure/);
    const id = f.info.ids[1], failed = f.lifecycle.get(id); assert.equal(failed.retries, 2); assert(failed.retryAfter);
    await f.lifecycle.reconcile(); const observed = f.lifecycle.get(id);
    assert.equal(observed.retries, failed.retries); assert.equal(observed.retryAfter, failed.retryAfter);
    await assert.rejects(f.lifecycle.apply(f.info.token, f.info.request), { code: 'RESOURCE_RECONCILIATION_REQUIRED' });
    const stops = f.stops(); f.store.put('fixtureAbsent', id, true); await f.lifecycle.reconcile();
    assert.deepEqual((await f.lifecycle.apply(f.info.token, f.info.request)).released, f.info.ids);
    assert.equal(f.stops(), stops); assert.equal(f.lifecycle.get(id).retries, 2); f.store.assertRepositoryAvailable(f.info.repo);
  } finally { f.close(); }
});

test('AT-LC05/13 concurrent observation revokes an awaited close grant and keeps the same cleanup resumable', async () => {
  const f = crashed('stop-present');
  try {
    let release; f.closeWait(new Promise(resolve => release = resolve));
    const pending = f.lifecycle.apply(f.info.token, f.info.request); await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.stops(), 1); await f.lifecycle.reconcile(); release();
    await assert.rejects(pending, { code: 'RESOURCE_IDENTITY_CHANGED' });
    const id = f.info.ids[1]; assert.equal(f.store.record('fixtureEffects', id), undefined);
    assert.equal(f.store.record('resourceCleanupExpectation', id).current, digest(f.lifecycle.get(id)));
    f.closeWait(undefined); assert.deepEqual((await f.lifecycle.apply(f.info.token, f.info.request)).released, f.info.ids);
    assert.equal(f.store.record('fixtureEffects', id), 1); f.store.assertRepositoryAvailable(f.info.repo);
  } finally { f.close(); }
});
