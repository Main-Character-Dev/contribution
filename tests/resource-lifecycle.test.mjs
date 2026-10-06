import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Journal } from '../packages/engine/dist/journal.js';
import { ResourceLifecycle, bootIdentity } from '../packages/engine/dist/resource-lifecycle.js';
import { processResourceAdapter, ownedProcess } from '../packages/engine/dist/resource-process.js';
import { run } from '../packages/engine/dist/process.js';
import { validateContract } from '../packages/contracts/dist/index.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ct-resource-')), store = new Journal(join(root, 'state'));
  let context = { clone: 'fixture-clone', revision: 'v1' }, boot = 'fixture-boot';
  const lifecycle = new ResourceLifecycle(store, () => context, () => boot), repo = randomUUID();
  const op = store.admit(randomUUID(), 'checks', repo, {}, 'fixture'); store.update(op, { state: 'failed' });
  const intent = overrides => ({ requestId: randomUUID(), kind: 'provider', owner: 'utility', lifetime: 'ephemeral', adapter: 'fixture-provider', adapterVersion: 1, scope: randomUUID(), reason: 'Disposable fixture', stopAction: 'fixture named-session close', ...overrides });
  const add = overrides => { const input = intent(overrides), initial = lifecycle.begin(op, input); return { input, resource: lifecycle.grant(lifecycle.allocate(initial, { type: 'provider', value: { handle: initial.resourceId } })) }; };
  return { root, store, lifecycle, op, intent, add, context: value => context = value, boot: value => boot = value, close: () => { store.close(); rmSync(root, { recursive: true }); } };
}
function adapter(f, hooks = {}) {
  const absent = new Set(); let stops = 0;
  const value = { id: 'fixture-provider', version: 1,
    observe: async r => { await hooks.observe?.(r); return absent.has(r.resourceId) ? 'absent' : r.identity; },
    stop: async (r, guard) => { await hooks.stop?.(r); guard(); stops++; absent.add(r.resourceId); }
  }; f.lifecycle.register(value); return { absent, stops: () => stops };
}

test('AT-LC18 intent is retained before allocation, immutable replay does not grant another effect, journal migration fences older readers', () => {
  const f = fixture(); try {
    const input = f.intent(), r = f.lifecycle.begin(f.op, input);
    assert.equal(f.store.record('resource', r.resourceId).state, 'intent'); assert.equal(r.identity, null);
    assert.equal(f.store.db.prepare('PRAGMA user_version').get().user_version, 2);
    assert.deepEqual(f.lifecycle.begin(f.op, input), r);
    assert.throws(() => f.lifecycle.begin(f.op, { ...input, lifetime: 'interactive' }), { code: 'REQUEST_ID_CONFLICT' });
    assert.throws(() => f.lifecycle.grant(r), { code: 'RESOURCE_GRANT_UNAVAILABLE' });
    assert.equal(validateContract('resource', { ...r, hostId: 'not-host' }).valid, false);
    assert.equal(validateContract('resource-policy', { schemaVersion: 1, hostLimits: { unknown: 3 }, projectLimits: {} }).valid, false);
  } finally { f.close(); }
});

test('AT-LC03/19 borrowed, retained interactive, unknown and pinned resources stay protected after expiry', async () => {
  const f = fixture(); try {
    const a = adapter(f);
    for (const options of [{ owner: 'borrowed', lifetime: 'borrowed' }, { owner: 'unknown' }, { owner: 'native' }, { lifetime: 'interactive', deadlineAt: '2020-01-01T00:00:00Z' }, { pinned: true }]) {
      const { resource } = f.add(options); await assert.rejects(f.lifecycle.stop(resource.resourceId), { code: 'RESOURCE_PROTECTED' });
    }
    await f.lifecycle.reconcile(); assert.equal(a.stops(), 0);
    assert(f.lifecycle.all().filter(r => r.lifetime === 'interactive').every(r => r.state === 'retained'));
    const policy = f.lifecycle.policy(); f.lifecycle.configure({ schemaVersion: 1, hostLimits: { provider: 1 }, projectLimits: {} }, policy.revision, randomUUID());
    assert.throws(() => f.add(), { code: 'RESOURCE_LIMIT' });
  } finally { f.close(); }
});

test('AT-LC04/05 final identity check blocks drift during asynchronous provider inspection and protects foreign host/boot/enrollment', async () => {
  for (const kind of ['record', 'clone', 'revision', 'boot', 'host']) {
    const f = fixture(); try {
      let release; const observed = new Promise(resolve => release = resolve);
      const a = adapter(f, { observe: async () => observed }), { resource } = f.add();
      const stop = f.lifecycle.stop(resource.resourceId);
      await new Promise(resolve => setImmediate(resolve));
      const current = f.lifecycle.get(resource.resourceId);
      if (kind === 'record') f.store.put('resource', resource.resourceId, { ...current, token: randomUUID() });
      if (kind === 'clone') f.context({ clone: 'replacement', revision: 'v1' });
      if (kind === 'revision') f.context({ clone: 'fixture-clone', revision: 'v2' });
      if (kind === 'boot') f.boot('new-boot');
      if (kind === 'host') f.store.put('resource', resource.resourceId, { ...current, hostId: randomUUID() });
      release(); await assert.rejects(stop); assert.equal(a.stops(), 0, kind);
    } finally { f.close(); }
  }
});

test('AT-LC06/07 total cleanup deadline cancels a stalled adapter; late callback has no mutation grant; failures remain separate', async () => {
  const f = fixture(); try {
    let release; const waiting = new Promise(resolve => release = resolve), a = adapter(f, { stop: async () => waiting });
    const { resource } = f.add();
    await assert.rejects(f.lifecycle.stop(resource.resourceId, false, 30), { code: 'RESOURCE_CLEANUP_TIMEOUT' });
    assert.equal(f.lifecycle.get(resource.resourceId).state, 'unresolved'); release();
    await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(a.stops(), 0);
    await assert.rejects(f.lifecycle.stop(resource.resourceId), { code: 'RESOURCE_RECONCILIATION_REQUIRED' });
  } finally { f.close(); }
});

test('AT-LC08/13 startup observes without dispatch; dependency-ordered exact preview replays one retained cleanup and preserves new resources', async () => {
  const f = fixture(); try {
    const a = adapter(f), outer = f.add(), child = f.add({ dependencies: [outer.resource.resourceId] });
    await assert.rejects(f.lifecycle.stop(outer.resource.resourceId), { code: 'RESOURCE_DEPENDENCY_ACTIVE' });
    await f.lifecycle.reconcile(); assert.equal(a.stops(), 0);
    const preview = await f.lifecycle.preview(), request = randomUUID(), newer = f.add();
    const result = await f.lifecycle.apply(preview.scopeToken, request);
    assert.deepEqual(result.released, [child.resource.resourceId, outer.resource.resourceId]);
    assert.deepEqual(await f.lifecycle.apply(preview.scopeToken, request), result);
    assert.equal(f.lifecycle.get(newer.resource.resourceId).state, 'active'); assert.equal(a.stops(), 2);
    await assert.rejects(f.lifecycle.apply(randomUUID(), request), { code: 'REQUEST_ID_CONFLICT' });
  } finally { f.close(); }
});

test('AT-LC01/06 actual grant worker preserves stdin, stops redirected descendants after leader exit and retains accurate failure/cleanup', { timeout: 15000 }, async () => {
  const f = fixture(); try {
    const lifecycle = new ResourceLifecycle(f.store, () => ({ clone: 'fixture-clone', revision: 'v1' }), bootIdentity); lifecycle.register(processResourceAdapter);
    const result = await run('/bin/sh', ['-c', 'cat; (trap "" TERM; while :; do sleep 1; done) >/dev/null 2>&1 & echo ready; sleep 0.4; exit 7'], {
      input: 'private stdin\n', ownership: () => ownedProcess(lifecycle, f.op), timeoutMs: 7000, terminationGraceMs: 100
    });
    assert.match(result.stdout, /private stdin/); assert.equal(result.actualExitCode, 7); assert.equal(result.code, 7); assert.equal(result.cleanup.released, true);
    assert(lifecycle.all().every(r => r.state === 'stopped')); assert(lifecycle.all().every(r => r.outcome.actualExitCode === 7));
  } finally { f.close(); }
});

test('AT-LC18 failed durable grant cannot run target code and unique intent stays recoverable', { timeout: 10000 }, async () => {
  const f = fixture(); try {
    const sentinel = join(f.root, 'effect');
    await assert.rejects(run('/bin/sh', ['-c', 'touch "$1"', 'fixture', sentinel], {
      ownership: { intent() {}, allocated() {}, grant() { throw new Error('journal unavailable'); }, members() {}, stopping() {}, finished() {}, uncertain() {} }, timeoutMs: 3000
    }), { code: 'PROCESS_OBSERVER_FAILED' });
    assert(!existsSync(sentinel));
  } finally { f.close(); }
});

test('AT-LC21 newer incompatible journal is rejected read-only without losing resource evidence', () => {
  const f = fixture(); f.add(); f.store.db.exec('PRAGMA user_version=3'); f.store.close();
  try {
    const file = join(f.root, 'state', 'journal.sqlite'), before = readFileSync(file);
    assert.throws(() => new Journal(join(f.root, 'state')), { code: 'DATABASE_TOO_NEW' }); assert.deepEqual(readFileSync(file), before);
  } finally { rmSync(f.root, { recursive: true }); }
});

test('AT-LC13 interrupted cleanup accepts only its own recorded generation and fences new scope allocation', async () => {
  const f = fixture(); try {
    let fail = true;
    adapter(f, { stop: async () => { if (fail) throw new Error('owner close failed'); } });
    const { resource } = f.add(), preview = await f.lifecycle.preview(), request = randomUUID();
    await assert.rejects(() => f.lifecycle.apply(preview.scopeToken, request));
    const pending = f.lifecycle.get(resource.resourceId);
    assert.equal(pending.state, 'unresolved'); assert(f.store.record('resourceCleanupExpectation', resource.resourceId));
    assert.throws(() => f.lifecycle.begin(f.op, f.intent({ scope: resource.scope })), { code: 'RESOURCE_CLEANUP_PENDING' });
    fail = false;
    // A record changed by another actor is not endorsed by the cleanup receipt,
    // even if pin/identity values appear unchanged again.
    f.store.put('resource', resource.resourceId, { ...pending, generation: pending.generation + 2, retryAfter: null });
    await assert.rejects(() => f.lifecycle.apply(preview.scopeToken, request), { code: 'RESOURCE_SELECTION_CHANGED' });
    assert.equal(f.lifecycle.get(resource.resourceId).state, 'unresolved');
  } finally { f.close(); }
});

test('AT-LC18 a waiting worker tolerates delayed journal grant without premature exit or execution', async () => {
  const { execFileSync } = await import('node:child_process');
  const f = fixture(); try {
    const lifecycle = new ResourceLifecycle(f.store, () => ({ clone: 'fixture-clone', revision: 'v1' }), bootIdentity); lifecycle.register(processResourceAdapter);
    const owner = ownedProcess(lifecycle, f.op), grant = owner.grant;
    owner.grant = () => { execFileSync('/bin/sleep', ['0.3']); grant(); };
    const result = await run('/bin/sh', ['-c', 'echo granted-once'], { ownership: owner, timeoutMs: 3000 });
    assert.equal(result.code, 0); assert.equal(result.stdout.trim(), 'granted-once'); assert.equal(result.cleanup.released, true);
  } finally { f.close(); }
});

test('AT-LC08 bounded restart inspection defers remaining owned observations visibly without dispatch', async () => {
  const f = fixture(); try {
    let mutations = 0;
    f.lifecycle.register({ id: 'fixture-provider', version: 1, observe: () => new Promise(() => {}), stop: async () => { mutations++; } });
    const first = f.add(), second = f.add(); const start = performance.now();
    await f.lifecycle.reconcile(10);
    assert(performance.now() - start < 200); assert.equal(mutations, 0);
    assert.equal(f.lifecycle.get(first.resource.resourceId).state, 'unresolved'); assert.equal(f.lifecycle.get(second.resource.resourceId).state, 'unresolved');
  } finally { f.close(); }
});
