import { randomUUID } from 'node:crypto';
import { Journal } from '../../packages/engine/dist/journal.js';
import { ResourceLifecycle } from '../../packages/engine/dist/resource-lifecycle.js';

// Disposable synthetic owner; no OS/provider effect is invoked. SIGKILL is
// directed only at this test's own child process at the selected durable edge.
const [state, phase, lifetime = 'ephemeral'] = process.argv.slice(2), store = new Journal(state);
const lifecycle = new ResourceLifecycle(store, () => ({ clone: 'crash-fixture', revision: 'v1' }), () => 'crash-fixture-boot');
const repo = randomUUID(), op = store.admit(randomUUID(), 'checks', repo, {}, 'fixture');
store.update(op, { state: 'failed' });
const add = dependencies => {
  const r = lifecycle.begin(op, { requestId: randomUUID(), kind: 'provider', owner: 'utility', lifetime, adapter: 'crash-owner', adapterVersion: 1,
    scope: randomUUID(), dependencies, reason: 'Disposable crash fixture', stopAction: 'crash-owner.close' });
  return lifecycle.grant(lifecycle.allocate(r, { type: 'provider', value: { handle: r.resourceId } }));
};
const outer = add([]), child = add([outer.resourceId]), kill = () => process.kill(process.pid, 'SIGKILL');
lifecycle.register({ id: 'crash-owner', version: 1,
  observe: async r => store.record('fixtureAbsent', r.resourceId) ? 'absent' : r.identity,
  stop: async (r, guard) => {
    guard();
    if (r.resourceId === child.resourceId && phase === 'first-stop-present') kill();
    if (r.resourceId === outer.resourceId && phase === 'stop-present') kill();
    store.transaction(() => { store.put('fixtureAbsent', r.resourceId, true); store.put('fixtureEffects', r.resourceId, (store.record('fixtureEffects', r.resourceId) ?? 0) + 1); });
    if (r.resourceId === outer.resourceId && phase === 'stop-absent') kill();
    if (r.resourceId === outer.resourceId && phase.startsWith('error-state-')) throw new Error('Synthetic lost close acknowledgment');
  }
});
const preview = await lifecycle.preview(), request = randomUUID();
store.setMeta('crashFixture', { repo, operationId: op.operationId, ids: [child.resourceId, outer.resourceId], token: preview.scopeToken, request });
const put = store.put.bind(store);
store.put = (namespace, key, value) => {
  let edge;
  if (namespace === 'resourceCleanupExpectation' && key === outer.resourceId) {
    const state = lifecycle.get(outer.resourceId).state;
    edge = ({ active: 'admission', retained: 'admission', stopping: 'stop-state', stopped: 'finish-state', unresolved: 'error-state' })[state];
  } else if (namespace === 'resourceCleanup' && key === request) {
    if (value.state === 'completed') edge = 'cleanup-result';
    else if (value.completed.length === 1) edge = 'cleanup-progress';
  }
  if (phase === `${edge}-before`) kill();
  put(namespace, key, value);
  if (phase === `${edge}-after`) kill();
};
await lifecycle.apply(preview.scopeToken, request);
throw new Error(`Crash edge was not exercised: ${phase}`);
