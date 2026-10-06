import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Journal } from '../packages/engine/dist/journal.js';
import { ResourceLifecycle } from '../packages/engine/dist/resource-lifecycle.js';
import { NamedOwnerAdapter, withNamedOwner, boundedOwnerCall } from '../packages/engine/dist/resource-owner.js';
import { NativeWorktreeCloseout } from '../packages/engine/dist/native-worktree-closeout.js';
import { RepositoryResources } from '../packages/engine/dist/repository-resources.js';
import { resourceHealth } from '../packages/engine/dist/resource-health.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ct-owner-')), store = new Journal(root), lifecycle = new ResourceLifecycle(store, () => ({ clone: 'fixture', revision: '1' }), () => 'boot');
  const op = store.admit(randomUUID(), 'checks', randomUUID(), {}, 'fixture');
  return { root, store, lifecycle, op, close: () => { store.close(); rmSync(root, { recursive: true }); } };
}
test('AT-LC07/15 named sessions reserve before grant, close only exact owners and preserve borrowed/retained sessions', async () => {
  const f = fixture(); try {
    const sessions = new Map(), events = [];
    const owner = { id: 'fixture-browser', version: 1, kind: 'provider', reserve: async (request, guard) => { guard(); const record = f.lifecycle.all().find(r => r.requestId === request); assert.equal(record.state, 'intent'); const identity = { type: 'provider', value: { session: request } }; sessions.set(request, identity); events.push('reserve'); return identity; },
      start: async (identity, guard) => { guard(); assert.equal(f.lifecycle.all().find(r => r.identity?.value.session === identity.value.session).state, 'active'); events.push('start'); },
      observe: async identity => sessions.get(identity.value.session) ?? 'absent', close: async (identity, guard) => { guard(); sessions.delete(identity.value.session); events.push('close'); } };
    const adapter = new NamedOwnerAdapter(owner); f.lifecycle.register(adapter);
    const input = { scope: 'browser:exact', lifetime: 'ephemeral', reason: 'fixture', stopAction: 'Close exact browser session through its owner' };
    const result = await withNamedOwner(f.lifecycle, f.op, adapter, input, async () => { throw new Error('original workflow'); });
    assert.equal(result.error.message, 'original workflow'); assert.equal(result.resource.state, 'stopped'); assert.deepEqual(events, ['reserve', 'start', 'close']);
    const borrowedIdentity = { type: 'provider', value: { session: 'user-tab' } }; sessions.set('user-tab', borrowedIdentity);
    const borrowed = await withNamedOwner(f.lifecycle, f.op, adapter, { ...input, borrowedIdentity }, async () => 'view');
    assert.equal(borrowed.resource.state, 'stopped'); assert(sessions.has('user-tab')); assert.equal(events.length, 3);
    owner.start = async (_, guard) => { guard(); };
    const retained = await withNamedOwner(f.lifecycle, f.op, adapter, { ...input, lifetime: 'interactive' }, async () => 'visual');
    assert.equal(retained.resource.state, 'retained'); assert(sessions.has(retained.resource.requestId));
    await f.lifecycle.stop(retained.resource.resourceId, true); assert(!sessions.has(retained.resource.requestId)); assert(sessions.has('user-tab'));
  } finally { f.close(); }
});
test('AT-LC06/07 stalled owning API expires its final mutation guard', async () => {
  let mutate = 0;
  await assert.rejects(() => boundedOwnerCall(async signal => { await new Promise(resolve => setTimeout(resolve, 30)); if (!signal.aborted) mutate++; }, new AbortController().signal, 5));
  await new Promise(resolve => setTimeout(resolve, 40)); assert.equal(mutate, 0);
});
test('AT-LC12 native API fallback names the owning chat and exact attachment; changed/native foreign owners stay protected', async () => {
  const f = fixture(); try {
    const attachment = { identityKey: 'native-exact', ownerChatId: randomUUID(), hostId: f.store.hostId, generation: '1', retainedHistory: true, integrated: true, completed: true, ignoredFilesPreserved: true };
    const fallback = await new NativeWorktreeCloseout(f.store).archive(attachment, attachment.ownerChatId, randomUUID()); assert.equal(fallback.supported, false); assert.equal(fallback.ownerChatId, attachment.ownerChatId); assert.equal(f.store.records('nativeCloseout').length, 0);
    let rows = [attachment], calls = 0;
    const closeout = new NativeWorktreeCloseout(f.store, { inventory: async () => rows, archive: async (key, guard) => { guard(); assert.equal(key, attachment.identityKey); calls++; rows = []; } });
    await assert.rejects(() => closeout.archive(attachment, randomUUID(), randomUUID()), { code: 'NATIVE_WORKTREE_PROTECTED' });
    rows = [{ ...attachment, generation: '2' }]; await assert.rejects(() => closeout.archive(attachment, attachment.ownerChatId, randomUUID()), { code: 'NATIVE_ATTACHMENT_CHANGED' });
    rows = [attachment]; const request = randomUUID(), result = await closeout.archive(attachment, attachment.ownerChatId, request); assert.deepEqual(await closeout.archive(attachment, attachment.ownerChatId, request), result); assert.equal(calls, 1);
  } finally { f.close(); }
});
test('AT-LC17 exact host qualification gates every repository family and preserves interim helpers by default', () => {
  const f = fixture(); try {
    for (const family of ['maincharacter', 'mathy', 'roboty', 'glassalpha']) {
      const adapter = new RepositoryResources(f.lifecycle, family, { version: 1 });
      assert.throws(() => adapter.qualify(f.op), { code: 'RESOURCE_ADOPTION_UNQUALIFIED' });
      f.store.put('resourceQualification', f.op.repositoryId, { repositoryId: f.op.repositoryId, enrollmentRevision: '1', clone: 'fixture', hostId: f.store.hostId, adapterVersion: 1, exactDeviceCoordination: true, hostCancellationAndCrash: true, rollbackVerified: true }); adapter.qualify(f.op);
      f.store.put('resourceQualification', f.op.repositoryId, { ...f.store.record('resourceQualification', f.op.repositoryId), hostId: randomUUID() }); assert.throws(() => adapter.qualify(f.op), { code: 'RESOURCE_ADOPTION_UNQUALIFIED' });
      f.store.db.prepare("DELETE FROM records WHERE namespace='resourceQualification'").run();
    }
  } finally { f.close(); }
});
test('AT-LC16/19 bounded health is timestamped, unknown fields remain unknown and no RSS causality claim is exported', async () => {
  const f = fixture(); try { const health = await resourceHealth(f.lifecycle); assert(health.observedAt); assert(health.sampleMilliseconds >= 200); assert.equal(health.resources.recordedDevices, 0); assert(!JSON.stringify(health).includes('argv')); assert.equal(health.memory.interpretation, 'native observation; no summed RSS or attribution'); } finally { f.close(); }
});

test('AT-LC20 retained local resources fence enrollment/authority changes while host-local identity remains private', async () => {
  const { assertRepositorySettled } = await import('../packages/engine/dist/repository-idle.js');
  const f = fixture(); try {
    const op = f.store.update(f.op, { state: 'succeeded' });
    assertRepositorySettled(f.store, op.repositoryId);
    const row = f.lifecycle.begin(op, { requestId: randomUUID(), kind: 'provider', owner: 'utility', lifetime: 'interactive', adapter: 'unsupported-browser', adapterVersion: 1, scope: 'exact-browser', reason: 'private fixture', stopAction: 'Use owning browser session' });
    assert.throws(() => assertRepositorySettled(f.store, op.repositoryId), { code: 'RESOURCE_RECONCILIATION_REQUIRED' });
    const owned = f.lifecycle.grant(f.lifecycle.allocate(row, { type: 'provider', value: { exact: 'private-session' } }));
    await assert.rejects(() => f.lifecycle.stop(owned.resourceId, true), { code: 'RESOURCE_ADAPTER_UNAVAILABLE' });
    assert.throws(() => assertRepositorySettled(f.store, op.repositoryId), { code: 'RESOURCE_RECONCILIATION_REQUIRED' });
    f.lifecycle.finish(owned, { fixtureOwnerConfirmedRelease: true }, true); assertRepositorySettled(f.store, op.repositoryId);
  } finally { f.close(); }
});

test('AT-LC15 owned disposable server command records its process owner; a port observation creates no authority', async () => {
  const { run } = await import('../packages/engine/dist/process.js'), { ownedProcess, processResourceAdapter } = await import('../packages/engine/dist/resource-process.js'), { bootIdentity } = await import('../packages/engine/dist/resource-lifecycle.js');
  const f = fixture(); try {
    const lifecycle = new ResourceLifecycle(f.store, () => ({ clone: 'fixture', revision: '1' }), bootIdentity); lifecycle.register(processResourceAdapter);
    const result = await run('/bin/sh', ['-c', 'echo server-ready; sleep 30'], { ownership: () => ownedProcess(lifecycle, f.op, [], 'server'), timeoutMs: 300, terminationGraceMs: 100 });
    assert.equal(result.timedOut, true); assert.equal(result.cleanup.released, true);
    const record = lifecycle.all()[0]; assert.equal(record.kind, 'server'); assert.equal(record.state, 'stopped'); assert.equal(record.identity.type, 'process');
    assert.equal(lifecycle.all().length, 1); // No discovery/port-based owner.
  } finally { f.close(); }
});
