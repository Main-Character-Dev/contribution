import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, realpathSync, readFileSync, renameSync, symlinkSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Journal } from '../packages/engine/dist/journal.js';
import { OwnedWorktrees } from '../packages/engine/dist/owned-worktrees.js';
import { Engine } from '../packages/engine/dist/service.js';
import { git, repository, commit } from './integration/service.mjs';

const old = '2020-01-01T00:00:00.000Z';
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ct-owned-worktrees-'))), primary = repository(root), tip = commit(primary);
  commit(primary, '.gitignore', 'ignored.txt\n');
  const repo = { id: randomUUID(), path: primary, commonDir: git(primary, 'rev-parse', '--path-format=absolute', '--git-common-dir') };
  const store = new Journal(join(root, 'state')), owned = new OwnedWorktrees(store);
  const add = async (kind = 'build') => {
    let op = store.admit(randomUUID(), 'checks', repo.id, { fixture: kind }, 'fixture');
    const directory = await owned.create(op, repo, kind, git(primary, 'rev-parse', 'HEAD'));
    op = store.update(op, { state: 'succeeded', result: { completedAt: old } });
    return { op, directory, owner: store.record('ownedWorktree', op.attemptId) };
  };
  return { root, primary, tip, repo, store, owned, add, close: () => { store.close(); rmSync(root, { recursive: true }); } };
}

test('reviewed Git removal handles all owned kinds while preserving native worktrees, committed retention and replay', async () => {
  const f = fixture(); try {
    const native = join(f.root, 'native'); git(f.primary, 'worktree', 'add', '--detach', native, f.tip);
    writeFileSync(join(native, 'user-work'), 'preserve');
    const rows = []; for (const kind of ['build', 'candidate', 'adopted']) rows.push(await f.add(kind));
    const preview = await f.owned.preview(); assert.equal(preview.candidates.length, 3);
    const request = randomUUID(), result = await f.owned.apply(preview.scopeToken, request);
    assert.equal(result.removed.length, 3); assert.deepEqual(await f.owned.apply(preview.scopeToken, request), result);
    for (const row of rows) {
      assert(!existsSync(row.directory)); assert(!existsSync(row.owner.gitDirectory));
      assert.equal(git(f.primary, 'rev-parse', row.owner.retention), row.owner.tip);
      assert.equal(f.store.admit(row.op.requestId, row.op.kind, row.op.repositoryId, row.op.input, 'next').operationId, row.op.operationId);
      assert.equal(f.store.response(row.op).result.outputRetention[0].head, row.owner.tip);
    }
    assert.equal(readFileSync(join(native, 'user-work'), 'utf8'), 'preserve'); assert(existsSync(join(native, '.git')));
    assert.equal((await f.owned.preview()).candidates.length, 0);
  } finally { f.close(); }
});

test('local, linked, locked, recent, pinned, live and unresolved checkout state remains protected', async () => {
  for (const change of ['dirty', 'untracked', 'ignored', 'branch', 'locked', 'root', 'gitfile', 'ref', 'detached-commit', 'recent', 'pin', 'unknown', 'peer', 'active', 'live-process']) {
    const f = fixture(); try {
      const row = await f.add();
      if (change === 'dirty') writeFileSync(join(row.directory, 'base.txt'), 'unrelated edit');
      if (change === 'untracked') writeFileSync(join(row.directory, 'user-notes'), 'preserve');
      if (change === 'ignored') writeFileSync(join(row.directory, 'ignored.txt'), 'preserve');
      if (change === 'branch') git(row.directory, 'switch', '-c', 'user-owned');
      if (change === 'locked') git(f.primary, 'worktree', 'lock', '--reason', 'User keeps this', row.directory);
      if (change === 'root') { renameSync(row.directory, `${row.directory}-original`); mkdirSync(row.directory); }
      if (change === 'gitfile') { renameSync(join(row.directory, '.git'), join(row.directory, '.git-original')); symlinkSync('.git-original', join(row.directory, '.git')); }
      if (change === 'ref') git(f.primary, 'update-ref', '-d', row.owner.retention);
      if (change === 'detached-commit') commit(row.directory, 'new-work', 'unretained work');
      if (change === 'recent') f.store.update(row.op, { result: { completedAt: new Date().toISOString() } });
      if (change === 'pin') f.store.update(row.op, { pinned: true });
      if (change === 'unknown') f.store.update(row.op, { state: 'outcome_unknown' });
      if (change === 'peer') f.store.put('peerOperation', row.op.operationId, { awaiting: true });
      if (change === 'active') f.store.admit(randomUUID(), 'checks', f.repo.id, {}, 'fixture');
      if (change === 'live-process') f.store.update(row.op, { result: { completedAt: old, processes: [{ pid: process.pid, start: null }] } });
      const preview = await f.owned.preview(); assert.equal(preview.candidates.length, 0, change); assert.equal(preview.protected.length, 1, change);
      assert(existsSync(row.directory), change);
    } finally { f.close(); }
  }
});

test('a stale review cannot delete changed user files or new dependent jobs', async () => {
  for (const change of ['ignored', 'pin', 'dependency']) {
    const f = fixture(); try {
      const row = await f.add(), preview = await f.owned.preview();
      if (change === 'ignored') writeFileSync(join(row.directory, 'ignored.txt'), 'preserve');
      if (change === 'pin') f.store.update(row.op, { pinned: true });
      if (change === 'dependency') f.store.admit(randomUUID(), 'checks', f.repo.id, { sourcePath: row.directory }, 'fixture');
      await assert.rejects(() => f.owned.apply(preview.scopeToken, randomUUID())); assert(existsSync(row.directory));
      assert.equal(f.store.records('worktreeCleanup').length, 0);
    } finally { f.close(); }
  }
});

test('lost cleanup completion resumes its exact identity and fences new jobs without repeating removal', async () => {
  const f = fixture(); try {
    const one = await f.add('candidate'), two = await f.add('build'), preview = await f.owned.preview(), request = randomUUID();
    f.store.put('worktreeCleanup', request, { requestId: request, preview: f.store.record('worktreeCleanupPreview', preview.scopeToken), completed: [], state: 'removing' });
    git(f.primary, 'worktree', 'remove', one.directory); // Crash after Git removed the selected checkout.
    assert.throws(() => f.store.admit(randomUUID(), 'checks', f.repo.id, {}, 'fixture'), { code: 'STORAGE_CLEANUP_PENDING' });
    assert.equal(f.store.admit(one.op.requestId, one.op.kind, f.repo.id, one.op.input, 'new').operationId, one.op.operationId);
    writeFileSync(join(two.directory, 'user-work'), 'preserve');
    await assert.rejects(() => f.owned.apply(preview.scopeToken, request)); assert.equal(readFileSync(join(two.directory, 'user-work'), 'utf8'), 'preserve');
    const engine = new Engine(f.store, { identity: 'fixture', node: process.execPath, cli: 'unused' });
    const pending = await engine.dispatch({ schemaVersion: 1, command: 'service.storage', args: { worktrees: true, scopeToken: preview.scopeToken, requestId: request }, cwd: f.root });
    assert.equal(pending.result.requestRetained, true); assert.equal(pending.result.requestId, request);
    assert.deepEqual(pending.error.nextActions[0].argv.slice(-3), ['--request-id', request, '--json']);
    f.store.setMeta('maintenance', true);
    const maintenance = await engine.dispatch({ schemaVersion: 1, command: 'service.storage', args: { worktrees: true, scopeToken: preview.scopeToken, requestId: request }, cwd: f.root });
    assert.equal(maintenance.error.code, 'SERVICE_MAINTENANCE'); assert.equal(maintenance.result.requestRetained, true);
    f.store.setMeta('maintenance', false);
    await assert.rejects(() => f.owned.apply(preview.scopeToken, randomUUID()), { code: 'STORAGE_CLEANUP_PENDING' });
    unlinkSync(join(two.directory, 'user-work')); // Fixture represents explicit owner reconciliation.
    const result = await f.owned.apply(preview.scopeToken, request); assert.equal(result.removed.length, 2);
    assert.equal(f.store.admit(randomUUID(), 'checks', f.repo.id, {}, 'fixture').state, 'queued');
    await assert.rejects(() => f.owned.apply(randomUUID(), request), { code: 'REQUEST_ID_CONFLICT' });
  } finally { f.close(); }
});

test('unrecorded output and incomplete creation are never inferred as disposable ownership', async () => {
  const f = fixture(); try {
    const row = await f.add(), foreign = join(f.store.directory, 'candidates', randomUUID()); mkdirSync(foreign, { recursive: true }); writeFileSync(join(foreign, 'notes'), 'preserve');
    f.store.put('ownedWorktree', row.op.attemptId, { ...row.owner, phase: 'creating', identities: undefined });
    const preview = await f.owned.preview(); assert.equal(preview.candidates.length, 0); assert.equal(preview.protected.length, 1);
    assert.equal(readFileSync(join(foreign, 'notes'), 'utf8'), 'preserve');
  } finally { f.close(); }
});

test('service exposes a separate reviewed checkout scope, serializes removal and honors maintenance', async () => {
  const f = fixture(); try {
    await f.add(); const engine = new Engine(f.store, { identity: 'fixture', node: process.execPath, cli: 'unused' });
    const call = args => engine.dispatch({ schemaVersion: 1, command: 'service.storage', args, cwd: f.root });
    const preview = await call({ worktrees: true, preview: true }); assert.equal(preview.error, null); assert.equal(preview.result.candidates.length, 1);
    assert.equal((await call({ worktrees: 'yes', preview: true })).error.code, 'INVALID_USAGE');
    f.store.setMeta('maintenance', true); assert.equal((await call({ worktrees: true, scopeToken: preview.result.scopeToken, requestId: randomUUID() })).error.code, 'SERVICE_MAINTENANCE'); f.store.setMeta('maintenance', false);
    const results = await Promise.all([call({ worktrees: true, scopeToken: preview.result.scopeToken, requestId: randomUUID() }), call({ worktrees: true, scopeToken: preview.result.scopeToken, requestId: randomUUID() })]);
    assert.equal(results.filter(result => result.error === null).length, 1); assert.equal(results.find(result => result.error)?.error.code, 'STORAGE_CLEANUP_BUSY');
  } finally { f.close(); }
});
