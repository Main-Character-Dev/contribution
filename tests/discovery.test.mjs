import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverReport } from '../packages/engine/dist/git.js';
import { repository, commit, git } from './integration/service.mjs';
import { Journal } from '../packages/engine/dist/journal.js';
import { Engine } from '../packages/engine/dist/service.js';

test('repository discovery reports unborn and detached histories without enrollment or hook/configuration changes', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'ct-discover-'))), store = new Journal(join(root, 'state'));
  try {
    const unborn = repository(root, 'unborn'), committed = repository(root, 'committed'); commit(committed, 'source.txt', 'original');
    git(committed, 'checkout', '--detach'); fs.mkdirSync(join(root, 'node_modules')); repository(join(root, 'node_modules'), 'ignored');
    const outside = repository(root, 'outside'), scan = join(root, 'scan'); fs.mkdirSync(scan); fs.symlinkSync(outside, join(scan, 'link'));
    assert.equal((await discoverReport(scan)).repositories.length, 0);
    const engine = new Engine(store, { identity: 'fixture', node: process.execPath, cli: join(root, 'fixture.js') });
    const result = await engine.dispatch({ schemaVersion: 1, command: 'repos.discover', args: { root }, cwd: root });
    assert.equal(result.error, null); assert.equal(result.result.repositories.length, 3); assert.equal(result.result.limits.timeoutMs, 10000);
    const found = result.result.repositories;
    assert.equal(found.find(repo => repo.path === unborn).tip, null);
    assert.equal(found.find(repo => repo.path === committed).branch, null);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM repositories').get().count, 0);
    for (const path of [unborn, committed]) assert.equal(fs.existsSync(join(path, 'contribution.json')), false);
  } finally { store.close(); fs.rmSync(root, { recursive: true }); }
});
test('discovery retains partial results and names depth, directory, entry and unreadable boundaries', async t => {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'ct-discover-limits-'))), original = fs.opendirSync;
  try {
    repository(root, 'found'); fs.mkdirSync(join(root, 'private')); fs.mkdirSync(join(root, 'deeper')); repository(join(root, 'deeper'), 'nested');
    const mock = t.mock.method(fs, 'opendirSync', (...args) => { if (args[0] === join(root, 'private')) throw Object.assign(Error('denied'), { code: 'EACCES' }); return original(...args); }); syncBuiltinESMExports();
    const partial = await discoverReport(root); assert.equal(partial.repositories.length, 2); assert.deepEqual(partial.scan.unreadableDirectories, [join(root, 'private')]);
    mock.mock.restore(); syncBuiltinESMExports();
    assert((await discoverReport(root, 0)).scan.limitsReached.includes('depth'));
    const directories = await discoverReport(root, 3, 1); assert.equal(directories.scan.directoriesVisited, 1); assert(directories.scan.limitsReached.includes('directories'));
    const entries = await discoverReport(root, 3, 250, 10000, 1); assert.equal(entries.scan.entriesInspected, 1); assert(entries.scan.limitsReached.includes('entries'));
    fs.mkdirSync(join(root, 'broken')); fs.writeFileSync(join(root, 'broken', '.git'), 'invalid');
    assert((await discoverReport(root)).scan.invalidRepositories.includes(join(root, 'broken')));
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); fs.rmSync(root, { recursive: true }); }
});
test('a blocked Git identity probe stops at the scan deadline and returns an explicit incomplete result', async t => {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'ct-discover-deadline-'))), original = cp.spawn;
  try {
    fs.mkdirSync(join(root, '.git'));
    t.mock.method(cp, 'spawn', (executable, args, options) => args.includes('--show-toplevel') ? original(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], options) : original(executable, args, options)); syncBuiltinESMExports();
    const started = Date.now(), result = await discoverReport(root, 3, 250, 40);
    assert(result.scan.limitsReached.includes('deadline')); assert.deepEqual(result.repositories, []); assert.deepEqual(result.scan.invalidRepositories, []); assert(Date.now() - started < 4000);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); fs.rmSync(root, { recursive: true }); }
});
