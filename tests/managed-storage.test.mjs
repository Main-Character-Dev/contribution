import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync, renameSync, readFileSync, statSync, linkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Journal } from '../packages/engine/dist/journal.js';
import { ManagedStorage } from '../packages/engine/dist/managed-storage.js';
import { Engine } from '../packages/engine/dist/service.js';
import { validateContract } from '../packages/contracts/dist/index.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ct-managed-cap-')), store = new Journal(join(root, 'state'));
  const engine = new Engine(store, { identity: 'fixture', node: process.execPath, cli: 'unused' }), storage = new ManagedStorage(store);
  return { root, store, engine, storage, call: (command, args = {}) => engine.dispatch({ schemaVersion: 1, command, args, cwd: root }),
    close: () => { store.close(); rmSync(root, { recursive: true }); } };
}

test('managed census counts all retained categories, unknown files and hard links without traversing external symlinks', () => {
  const f = fixture(); try {
    const external = join(f.root, 'external'); mkdirSync(external); writeFileSync(join(external, 'app-data'), Buffer.alloc(2 * 1024 ** 2));
    symlinkSync(external, join(f.store.directory, 'external-link'));
    for (const name of ['Payloads', 'backups', 'device-builds', 'transfers', 'constructor', '__proto__']) {
      const path = join(f.store.directory, name); mkdirSync(path); writeFileSync(join(path, 'private-name'), Buffer.alloc(1000));
    }
    linkSync(join(f.store.directory, 'backups/private-name'), join(f.store.directory, 'other-hardlink'));
    const before = statSync(join(external, 'app-data')), usage = f.storage.usage();
    assert.equal(usage.complete, true, JSON.stringify(usage)); assert.equal(usage.admissionBlocked, false); assert(usage.logicalBytes < 1024 ** 2);
    for (const category of ['installed_payloads', 'journal_backups', 'device_builds', 'outgoing_git_bundles', 'other_private_state', 'journal']) assert(usage.categories.some(row => row.category === category));
    assert(usage.categories.find(row => row.category === 'other_private_state').logicalBytes >= 3000);
    assert.equal(statSync(join(external, 'app-data')).mtimeMs, before.mtimeMs); assert(!JSON.stringify(usage).includes(f.root)); assert(!JSON.stringify(usage).includes('private-name'));
  } finally { f.close(); }
});

test('incomplete census is explicitly blocked and unsafe root replacement never becomes zero usage', () => {
  const f = fixture(); try {
    const limited = f.storage.usage({ entries: 1, depth: 32, milliseconds: 2000 });
    assert.equal(limited.complete, false); assert.equal(limited.admissionBlocked, true); assert.equal(limited.reason, 'STORAGE_CENSUS_LIMIT');
    renameSync(f.store.directory, join(f.root, 'retained-state')); symlinkSync('retained-state', f.store.directory);
    const changed = f.storage.usage(); assert.equal(changed.complete, false); assert.equal(changed.reason, 'UNSAFE_STATE_DIRECTORY'); assert.equal(changed.admissionBlocked, true);
  } finally { f.close(); }
});

test('managed-data pressure blocks new jobs while preserving duplicate requests, pins, files and explicit policy recovery', async () => {
  const f = fixture(); try {
    const operation = f.store.admit(randomUUID(), 'checks', randomUUID(), {}, 'fixture'); f.store.update(operation, { state: 'failed', pinned: true });
    f.store.log(operation, 'protected evidence');
    const policy = f.storage.policy(), request = randomUUID();
    const small = { schemaVersion: 1, maxStateBytes: 1024 ** 2 };
    assert.equal((await f.call('service.storage-policy', { config: small, expectedRevision: policy.revision, requestId: request })).error, null);
    const path = join(f.store.directory, 'retained-artifact'); writeFileSync(path, Buffer.alloc(2 * 1024 ** 2, 7));
    assert.equal((await f.call('doctor')).result.managedStorage.admissionBlocked, true);
    assert.throws(() => f.store.admit(randomUUID(), 'device', randomUUID(), {}, 'fixture'), { code: 'MANAGED_STORAGE_PRESSURE' });
    assert.equal(f.store.admit(operation.requestId, operation.kind, operation.repositoryId, operation.input, 'fixture').operationId, operation.operationId);
    assert.equal(f.store.get(operation.operationId).pinned, true); assert.equal(readFileSync(path).length, 2 * 1024 ** 2);
    const current = (await f.call('service.storage-policy')).result;
    const config = { schemaVersion: 1, maxStateBytes: 16 * 1024 ** 2 }, args = { config, expectedRevision: current.revision, requestId: randomUUID() };
    const raised = await f.call('service.storage-policy', args); assert.equal(raised.error, null);
    assert.deepEqual((await f.call('service.storage-policy', args)).result, raised.result);
    assert.equal((await f.call('service.storage-policy', { ...args, config: small })).error.code, 'REQUEST_ID_CONFLICT');
    assert.equal((await f.call('service.storage-policy', { ...args, requestId: randomUUID() })).error.code, 'REVISION_CONFLICT');
    assert.equal(f.store.admit(randomUUID(), 'checks', randomUUID(), {}, 'fixture').state, 'queued');
    assert.equal((await f.call('doctor')).result.managedStorage.admissionBlocked, false);
  } finally { f.close(); }
});

test('storage policy is a strict separate contract and maintenance allows only its read route', async () => {
  const f = fixture(); try {
    for (const config of [{ schemaVersion: 1, maxStateBytes: 1 }, { schemaVersion: 1, maxStateBytes: 1e100 }, { schemaVersion: 2, maxStateBytes: 1048576 }, { schemaVersion: 1, maxStateBytes: 1048576, bypass: true }]) {
      assert.equal(validateContract('storage-policy', config).valid, false);
    }
    const before = JSON.stringify(f.store.getMeta('settings')), selected = f.storage.policy();
    f.store.setMeta('maintenance', true);
    assert.equal((await f.call('service.storage-policy')).error, null);
    assert.equal((await f.call('service.storage-policy', { config: selected.policy, expectedRevision: selected.revision, requestId: randomUUID() })).error.code, 'SERVICE_MAINTENANCE');
    assert.equal((await f.call('service.storage-policy', { expectedRevision: selected.revision })).error.code, 'INVALID_USAGE');
    assert.equal(JSON.stringify(f.store.getMeta('settings')), before);
  } finally { f.close(); }
});

test('already queued work waits under managed pressure and resumes only after a reviewed limit increase', async () => {
  const { repository } = await import('./integration/service.mjs');
  const f = fixture(); try {
    f.store.setMeta('paused', true);
    const repo = (await f.call('repos.add', { path: repository(f.root) })).result.repository;
    const accepted = await f.call('repos.initialize', { repo: repo.id, requestId: randomUUID() }); assert.equal(accepted.error, null);
    const policy = f.storage.policy();
    await f.call('service.storage-policy', { config: { schemaVersion: 1, maxStateBytes: 1048576 }, expectedRevision: policy.revision, requestId: randomUUID() });
    writeFileSync(join(f.store.directory, 'large-retained-output'), Buffer.alloc(2 * 1024 ** 2));
    await f.call('service.resume'); await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(f.store.get(accepted.operationId).state, 'queued'); assert.equal(f.engine.active.size, 0);
    assert.equal((await f.call('service.status')).result.storageHold.reason, 'MANAGED_STORAGE_PRESSURE');
    await f.call('service.storage-policy', { config: { schemaVersion: 1, maxStateBytes: 16 * 1024 ** 2 }, expectedRevision: f.storage.policy().revision, requestId: randomUUID() });
    const deadline = Date.now() + 5000;
    while (f.store.get(accepted.operationId).state !== 'succeeded' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(f.store.get(accepted.operationId).state, 'succeeded'); assert.equal(f.engine.storageHold, null);
  } finally { f.close(); }
});
