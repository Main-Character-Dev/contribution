import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Journal } from '../packages/engine/dist/journal.js';
import { ResourceLifecycle } from '../packages/engine/dist/resource-lifecycle.js';

test('stopped history cannot fence admission, replay, live ownership or paged inspection', t => {
  const root = mkdtempSync(join(tmpdir(), 'ct-perf-history-')), store = new Journal(root);
  try {
    const lifecycle = new ResourceLifecycle(store, () => ({ clone: 'fixture', revision: '1' }), () => 'boot');
    const op = store.admit(randomUUID(), 'checks', randomUUID(), {}, 'fixture');
    const input = { requestId: randomUUID(), kind: 'provider', owner: 'utility', lifetime: 'ephemeral', adapter: 'fixture', adapterVersion: 1, scope: 'exact', reason: 'fixture', stopAction: 'fixture' };
    const original = lifecycle.begin(op, input), stopped = lifecycle.finish(original, {}, true);
    store.transaction(() => { for (let i = 0; i < 10001; i++) { const resourceId = randomUUID(); store.put('resource', resourceId, { ...stopped, resourceId, requestId: randomUUID() }); } });
    assert.equal(lifecycle.counts().total, 10002);
    assert.deepEqual(lifecycle.begin(op, input), stopped);
    assert.deepEqual(lifecycle.live(), []);
    assert.equal(lifecycle.history().length, 200);
    const first = lifecycle.history(), next = lifecycle.history(first.at(-1).resourceId);
    assert(!next.some(r => first.some(previous => previous.resourceId === r.resourceId)));
    assert.equal(next.length, 200);
    const prepare = store.db.prepare.bind(store.db), selectedQueries = [];
    const observe = t.mock.method(store.db, 'prepare', sql => { selectedQueries.push(sql); return prepare(sql); });
    lifecycle.live(); lifecycle.counts();
    observe.mock.restore();
    const liveQueries = selectedQueries.filter(sql => sql.includes("$.state") && sql.includes("FROM records"));
    assert.equal(liveQueries.length, 2);
    for (const sql of liveQueries) assert.match(JSON.stringify(prepare('EXPLAIN QUERY PLAN ' + sql).all()), /USING INDEX resource_ownership/);
    const fresh = lifecycle.begin(op, { ...input, requestId: randomUUID() });
    assert.deepEqual(lifecycle.blockers(), [fresh]);
    assert.equal(ResourceLifecycle.pending(store, op.repositoryId), true);
    assert.throws(() => lifecycle.begin(op, { ...input, requestId: randomUUID() }), { code: 'RESOURCE_BUSY' });
    const malformed = { ...stopped, resourceId: randomUUID(), requestId: randomUUID() }; delete malformed.state;
    store.put('resource', malformed.resourceId, malformed);
    assert.throws(() => lifecycle.live());
    assert.throws(() => store.admit(randomUUID(), 'checks', op.repositoryId, {}, 'fixture'), { code: 'RESOURCE_RECONCILIATION_REQUIRED' });
    const plans = ["SELECT body FROM operations WHERE state='queued' ORDER BY sequence", "SELECT body FROM operations WHERE state NOT IN ('succeeded','failed','cancelled','interrupted') ORDER BY sequence"];
    for (const sql of plans) assert.match(JSON.stringify(store.db.prepare('EXPLAIN QUERY PLAN ' + sql).all()), /operations_(queued|unsettled)/);
  } finally { store.close(); rmSync(root, { recursive: true }); }
});
