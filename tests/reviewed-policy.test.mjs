import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Journal } from '../packages/engine/dist/journal.js';
import { digest } from '../packages/engine/dist/core.js';
import { WorkPower } from '../packages/engine/dist/power.js';
import { ManagedStorage } from '../packages/engine/dist/managed-storage.js';
import { ResourceLifecycle } from '../packages/engine/dist/resource-lifecycle.js';

test('existing policy receipts retain their original digest and replay before revision checks', () => {
  const root = mkdtempSync(join(tmpdir(), 'ct-policy-replay-')), store = new Journal(root);
  try {
    const power = new WorkPower(store), storage = new ManagedStorage(store), resources = new ResourceLifecycle(store, () => ({ clone: 'fixture', revision: '1' }), () => 'boot');
    const owners = [
      { owner: power, requests: 'workPowerPolicyRequest', metadata: 'workPowerPolicy', field: 'digest', selection: (config, expectedRevision) => ({ config, expectedRevision }) },
      { owner: storage, requests: 'managedStoragePolicyRequest', metadata: 'managedStoragePolicy', field: 'digest', selection: (config, expectedRevision) => ({ config, expectedRevision }) },
      { owner: resources, requests: 'resourcePolicyRequest', metadata: 'resourcePolicy', field: 'input', selection: (value, revision) => ({ value, revision }) },
    ];
    for (const family of owners) {
      const requestId = randomUUID(), config = family.owner.policy().policy, revision = 'historical-reviewed-revision';
      const result = { policy: config, revision: digest(config), requestId }, receipt = { [family.field]: digest(family.selection(config, revision)), result };
      store.put(family.requests, requestId, receipt);
      assert.deepEqual(family.owner.configure(config, revision, requestId), result);
      assert.deepEqual(store.record(family.requests, requestId), receipt);
      assert.equal(store.getMeta(family.metadata), undefined, 'A replay cannot apply a policy again');
      assert.throws(() => family.owner.configure(config, revision + '-changed', requestId), { code: 'REQUEST_ID_CONFLICT' });
      assert.throws(() => family.owner.configure(config, revision, randomUUID()), { code: 'REVISION_CONFLICT' });
      assert.equal(store.getMeta(family.metadata), undefined);
    }
  } finally { store.close(); rmSync(root, { recursive: true }); }
});

test('resource policy preserves its additional resource-owner collision fence', () => {
  const root = mkdtempSync(join(tmpdir(), 'ct-policy-owner-')), store = new Journal(root);
  try {
    const resources = new ResourceLifecycle(store, () => ({ clone: 'fixture', revision: '1' }), () => 'boot');
    const op = store.admit(randomUUID(), 'checks', randomUUID(), {}, 'fixture'), requestId = randomUUID();
    resources.begin(op, { requestId, kind: 'provider', owner: 'utility', lifetime: 'ephemeral', adapter: 'fixture', adapterVersion: 1, scope: 'fixture', reason: 'fixture', stopAction: 'Owning fixture' });
    const { policy, revision } = resources.policy();
    assert.throws(() => resources.configure(policy, revision, requestId), { code: 'REQUEST_ID_CONFLICT' });
    assert.equal(store.record('resourcePolicyRequest', requestId), undefined); assert.equal(store.getMeta('resourcePolicy'), undefined);
  } finally { store.close(); rmSync(root, { recursive: true }); }
});
