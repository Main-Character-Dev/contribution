import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Journal } from '../packages/engine/dist/journal.js';
import { ResourceLifecycle } from '../packages/engine/dist/resource-lifecycle.js';
import { SimulatorResourceAdapter, withSimulator } from '../packages/engine/dist/resource-simulator.js';

function fixture(initial = 'Shutdown') {
  const root = mkdtempSync(join(tmpdir(), 'ct-sim-resource-')), store = new Journal(root), lifecycle = new ResourceLifecycle(store, () => ({ clone: 'fixture', revision: '1' }), () => 'boot-1');
  const op = store.admit(randomUUID(), 'checks', randomUUID(), {}, 'fixture'); let lease, state = initial;
  const events = [], udid = 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA', runtime = 'com.apple.CoreSimulator.SimRuntime.iOS-fixture';
  const admission = { acquire: async () => { events.push('acquire'); lease = { token: randomUUID(), udid, runtime, hostId: store.hostId, bootId: 'boot-1', exclusiveDevice: true }; return lease; }, current: (u, token) => lease?.udid === u && lease?.token === token ? lease : null, release: async selected => { assert.equal(lease.token, selected.token); events.push('release'); lease = undefined; } };
  const driver = { state: async () => state, boot: async (u, guard) => { guard(); assert.equal(u, udid); events.push('boot'); state = 'Booted'; }, shutdown: async (u, guard) => { guard(); assert.equal(u, udid); events.push('shutdown'); state = 'Shutdown'; } };
  const adapter = new SimulatorResourceAdapter(admission, driver); lifecycle.register(adapter);
  return { root, store, lifecycle, op, udid, runtime, events, admission, driver, adapter, state: () => state, setState: v => state = v, drift: () => lease.token = randomUUID(), close: () => { store.close(); rmSync(root, { recursive: true }); } };
}

test('AT-LC02 success and workflow failure restore only the exact owned initially stopped device before admission release', async () => {
  for (const initial of ['Shutdown', 'Booted']) for (const failure of [false, true]) {
    const f = fixture(initial); try {
      const result = await withSimulator(f.lifecycle, f.op, f, f.adapter, async () => { f.events.push('driver-exit'); if (failure) throw new Error('original failure'); return 'result'; });
      assert.equal(result.admissionReleased, true); assert.equal(f.state(), initial);
      assert.deepEqual(f.events, initial === 'Shutdown' ? ['acquire', 'boot', 'driver-exit', 'shutdown', 'release'] : ['acquire', 'driver-exit', 'release']);
      if (failure) assert.equal(result.error.message, 'original failure'); else assert.equal(result.value, 'result');
    } finally { f.close(); }
  }
});

test('AT-LC03 nested borrowed driver delegates once; explicitly retained visual session preserves device and lease', async () => {
  const f = fixture(); try {
    const result = await withSimulator(f.lifecycle, f.op, { ...f, lifetime: 'interactive' }, f.adapter, async parent => {
      const child = await withSimulator(f.lifecycle, f.op, { ...f, parentId: parent.resourceId }, f.adapter, async () => 'nested');
      assert.equal(child.value, 'nested'); assert.equal(child.admissionReleased, false); assert.equal(child.resource.state, 'stopped'); return 'visual';
    });
    assert.equal(result.value, 'visual'); assert.equal(result.resource.state, 'retained'); assert.equal(result.admissionReleased, false); assert.equal(f.state(), 'Booted');
    assert.deepEqual(f.events, ['acquire', 'boot']);
    await f.lifecycle.stop(result.resource.resourceId, true); assert.equal(f.events.at(-1), 'release');
    assert.equal(f.state(), 'Shutdown');
  } finally { f.close(); }
});

test('AT-LC04/05 changed lease or asynchronous observation cannot shut down a replacement device', async () => {
  const f = fixture(); try {
    const result = await withSimulator(f.lifecycle, f.op, f, f.adapter, async () => { f.drift(); return 'completed'; });
    assert.equal(result.admissionReleased, false); assert.equal(result.resource.state, 'unresolved'); assert.equal(f.state(), 'Booted'); assert(!f.events.includes('shutdown')); assert(!f.events.includes('release'));
  } finally { f.close(); }
});

test('AT-LC07 setup uncertainty releases only known unused admission, lost boot acknowledgment preserves possible boot and lease', async () => {
  for (const kind of ['initial-unknown', 'boot-lost']) {
    const f = fixture(kind === 'initial-unknown' ? 'unknown' : 'Shutdown'); try {
      if (kind === 'boot-lost') f.driver.boot = async (_, guard) => { guard(); f.setState('Booted'); throw new Error('lost ack'); };
      const result = await withSimulator(f.lifecycle, f.op, f, f.adapter, async () => { throw new Error('must not dispatch'); });
      assert.equal(result.admissionReleased, kind === 'initial-unknown'); assert(!f.events.includes('shutdown'));
      if (kind === 'boot-lost') assert.equal(result.resource.state, 'unresolved');
    } finally { f.close(); }
  }
});

test('AT-LC01/07 cancellation cleanup uses an independent bound; an unreleased driver fences shutdown and admission', async () => {
  for (const kind of ['cancel', 'driver-unreleased']) {
    const f = fixture(); try {
      const controller = new AbortController();
      const result = await withSimulator(f.lifecycle, f.op, f, f.adapter, async parent => {
        if (kind === 'driver-unreleased') f.lifecycle.begin(f.op, { requestId: randomUUID(), kind: 'process', owner: 'utility', lifetime: 'ephemeral', adapter: 'owned-process', adapterVersion: 1, scope: randomUUID(), dependencies: [parent.resourceId], reason: 'fixture driver', stopAction: 'fixture stop' });
        controller.abort(); throw new Error('cancelled original');
      }, controller.signal);
      assert.equal(result.error.message, 'cancelled original'); assert.equal(result.admissionReleased, kind === 'cancel');
      assert.equal(f.events.includes('shutdown'), kind === 'cancel');
    } finally { f.close(); }
  }
});

test('AT-LC09 existing shared slots admit two repositories without a new device lock; borrowers delay owner shutdown', async () => {
  const f = fixture(); try {
    const leases = new Map();
    f.admission.acquire = async () => { const lease = { token: randomUUID(), udid: f.udid, runtime: f.runtime, hostId: f.store.hostId, bootId: 'boot-1', exclusiveDevice: true }; leases.set(lease.token, lease); return lease; };
    f.admission.current = (_, token) => leases.get(token) ?? null;
    f.admission.release = async lease => { leases.delete(lease.token); };
    let releaseBorrower, borrowerStarted; const started = new Promise(resolve => borrowerStarted = resolve), wait = new Promise(resolve => releaseBorrower = resolve);
    let other;
    const result = await withSimulator(f.lifecycle, f.op, f, f.adapter, async () => {
      const op = f.store.admit(randomUUID(), 'checks', randomUUID(), {}, 'fixture');
      other = withSimulator(f.lifecycle, op, f, f.adapter, async () => { borrowerStarted(); await wait; return 'borrowed'; });
      await started; return 'owner-ended';
    });
    assert.equal(result.resource.state, 'unresolved'); assert.equal(f.state(), 'Booted'); assert.equal(leases.size, 2);
    releaseBorrower(); const borrowed = await other; assert.equal(borrowed.resource.state, 'stopped'); assert.equal(leases.size, 1);
    f.store.put('resource', result.resource.resourceId, { ...result.resource, retryAfter: null });
    await f.lifecycle.stop(result.resource.resourceId); assert.equal(leases.size, 0); assert.equal(f.state(), 'Shutdown');
  } finally { f.close(); }
});

test('AT-LC07 borrowed boot with failed admission release remains a blocker and observation cannot shut down the user device', async () => {
  const f = fixture('Booted'); try {
    f.admission.release = async () => { throw new Error('lost release'); };
    const result = await withSimulator(f.lifecycle, f.op, f, f.adapter, async () => 'borrowed');
    assert.equal(result.resource.owner, 'borrowed'); assert.equal(result.resource.state, 'unresolved'); assert.equal(f.lifecycle.blockers().length, 1);
    assert.throws(() => f.store.admit(randomUUID(), 'checks', f.op.repositoryId, {}, 'fixture'), { code: 'RESOURCE_RECONCILIATION_REQUIRED' });
    await f.lifecycle.reconcile(); assert.equal(f.state(), 'Booted'); assert(!f.events.includes('shutdown'));
  } finally { f.close(); }
});
