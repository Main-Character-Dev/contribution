import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Journal } from '../packages/engine/dist/journal.js';
import { createBoundedBundle } from '../packages/engine/dist/git-bundle.js';
import { repository, commit, git } from './integration/service.mjs';

function fixture(bytes = 100000) {
  const root = fs.mkdtempSync(join(tmpdir(), 'ct-bundle-producer-')), source = repository(root), tip = commit(source, 'data.bin', randomBytes(bytes));
  const state = join(root, 'state'), store = new Journal(state), requestId = randomUUID(), ref = 'refs/contribution/outbox/' + 'a'.repeat(64), path = join(state, 'transfers', 'selected.bundle');
  git(source, 'update-ref', ref, tip);
  return { root, source, tip, state, store, requestId, ref, path, args: [requestId, source, ref, tip, path] };
}

test('bounded Git producer retains exact binary history and serializes duplicate creation', async () => {
  const f = fixture(); try {
    await Promise.all([createBoundedBundle(f.store, ...f.args), createBoundedBundle(f.store, ...f.args)]);
    assert.equal(git(f.source, 'bundle', 'list-heads', f.path), `${f.tip} ${f.ref}`);
    const record = f.store.record('bundleProduction', f.requestId); assert.equal(record.state, 'completed');
    assert.equal(fs.existsSync(record.partial), false); assert.equal(fs.lstatSync(f.path).nlink, 1); assert.equal(f.store.records('bundleProductionAttempt').length, 1);
    assert.equal(git(f.source, 'rev-parse', 'HEAD'), f.tip);
    await assert.rejects(createBoundedBundle(f.store, ...f.args.slice(0, 3), '0'.repeat(40), f.path), { code: 'REQUEST_ID_CONFLICT' });
  } finally { f.store.close(); fs.rmSync(f.root, { recursive: true }); }
});

test('oversized bundle production leaves only bounded partials and never changes source history', async () => {
  const f = fixture(); try {
    for (let attempt = 0; attempt < 2; attempt++) await assert.rejects(createBoundedBundle(f.store, ...f.args, 32768), { code: 'BUNDLE_SIZE_LIMIT' });
    const records = f.store.records('bundleProductionAttempt'); assert.equal(records.length, 2); assert.equal(new Set(records.map(record => record.partial)).size, 2);
    for (const record of records) { assert.equal(record.state, 'interrupted'); assert(fs.statSync(record.partial).size <= 32768); }
    assert.equal(fs.existsSync(f.path), false); assert.equal(git(f.source, 'rev-parse', f.ref), f.tip); assert.equal(git(f.source, 'rev-parse', 'HEAD'), f.tip);
  } finally { f.store.close(); fs.rmSync(f.root, { recursive: true }); }
});

test('bundle publication resumes either side of its link and unlink boundaries after journal reopen', async t => {
  for (const boundary of ['before-link', 'after-link', 'after-unlink']) {
    const f = fixture(); let reopened;
    try {
      const method = boundary === 'after-unlink' ? 'unlinkSync' : 'linkSync', original = fs[method];
      const mock = t.mock.method(fs, method, (...args) => {
        if (boundary !== 'before-link') original(...args);
        throw new Error('fixture interrupted ' + boundary);
      }); syncBuiltinESMExports();
      await assert.rejects(createBoundedBundle(f.store, ...f.args), /fixture interrupted/); mock.mock.restore(); syncBuiltinESMExports();
      const retained = f.store.record('bundleProduction', f.requestId); assert.equal(retained.state, 'publishing');
      f.store.close(); reopened = new Journal(f.state);
      await createBoundedBundle(reopened, ...f.args);
      assert.equal(reopened.record('bundleProduction', f.requestId).id, retained.id);
      assert.equal(reopened.record('bundleProduction', f.requestId).state, 'completed');
      assert.equal(git(f.source, 'bundle', 'list-heads', f.path), `${f.tip} ${f.ref}`); assert.equal(fs.lstatSync(f.path).nlink, 1); assert.equal(fs.existsSync(retained.partial), false);
    } finally { t.mock.restoreAll(); syncBuiltinESMExports(); if (reopened) reopened.close(); else if (f.store.db.isOpen) f.store.close(); fs.rmSync(f.root, { recursive: true }); }
  }
});

test('a foreign publication destination is never replaced or removed during bundle recovery', async t => {
  const f = fixture(); try {
    const original = fs.linkSync;
    const mock = t.mock.method(fs, 'linkSync', (...args) => { fs.writeFileSync(f.path, 'preserve foreign output'); return original(...args); }); syncBuiltinESMExports();
    await assert.rejects(createBoundedBundle(f.store, ...f.args), { code: 'EEXIST' }); mock.mock.restore(); syncBuiltinESMExports();
    const retained = f.store.record('bundleProduction', f.requestId);
    await assert.rejects(createBoundedBundle(f.store, ...f.args), { code: 'BUNDLE_RECOVERY_REQUIRED' });
    assert.equal(fs.readFileSync(f.path, 'utf8'), 'preserve foreign output'); assert.equal(fs.existsSync(retained.partial), true);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); f.store.close(); fs.rmSync(f.root, { recursive: true }); }
});

test('failed output retention stops the producer and a same-source retry keeps the first partial', async t => {
  const f = fixture(); try {
    const original = fs.writeSync; let called = false;
    const mock = t.mock.method(fs, 'writeSync', (...args) => {
      const result = original(...args); if (!called) { called = true; throw new Error('fixture disk failure'); } return result;
    }); syncBuiltinESMExports();
    await assert.rejects(createBoundedBundle(f.store, ...f.args), { code: 'OUTPUT_SINK_FAILED' }); mock.mock.restore(); syncBuiltinESMExports();
    const interrupted = f.store.record('bundleProduction', f.requestId); assert.equal(interrupted.state, 'interrupted'); const bytes = fs.readFileSync(interrupted.partial);
    await createBoundedBundle(f.store, ...f.args);
    assert.deepEqual(fs.readFileSync(interrupted.partial), bytes); assert.equal(f.store.records('bundleProductionAttempt').length, 2);
    assert.equal(git(f.source, 'bundle', 'list-heads', f.path), `${f.tip} ${f.ref}`);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); f.store.close(); fs.rmSync(f.root, { recursive: true }); }
});
