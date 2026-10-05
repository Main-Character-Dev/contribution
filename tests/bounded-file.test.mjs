import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readStableFile, StableFileReader, stableFileDigest } from '../packages/engine/dist/bounded-file.js';

test('large artifact digests and range reads use finite buffers and retain binary identity', t => {
  const root = fs.mkdtempSync(join(tmpdir(), 'ct-artifact-read-')), path = join(root, 'bundle');
  const data = Buffer.alloc(3 * 1024 ** 2 + 17, 255); data.write('binary\0content', 0);
  const originalRead = fs.readSync; let calls = 0;
  try {
    fs.writeFileSync(path, data);
    t.mock.method(fs, 'readSync', (...args) => { calls++; assert(args[3] <= 1024 ** 2); return originalRead(...args); }); syncBuiltinESMExports();
    assert.deepEqual(stableFileDigest(path, data.length, 'CHANGED'), { bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
    const file = new StableFileReader(path, data.length, 'CHANGED');
    try {
      assert.deepEqual(file.read(1024 ** 2 - 5, 17), data.subarray(1024 ** 2 - 5, 1024 ** 2 + 12));
      for (const range of [[-1, 1], [0, 1024 ** 2 + 1], [data.length, 1], [0.5, 1]]) assert.throws(() => file.read(...range), { code: 'CHANGED' });
    } finally { file.close(); }
    assert.equal(calls, 5);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); fs.rmSync(root, { recursive: true }); }
});

test('retained artifact readers reject changes between asynchronous transfer chunks', async () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'ct-artifact-change-'));
  try {
    for (const mutation of ['grow', 'rewrite', 'replace', 'parent', 'link']) {
      const directory = join(root, mutation); fs.mkdirSync(directory); const path = join(directory, 'bundle'); fs.writeFileSync(path, 'original');
      const file = new StableFileReader(path, 64, 'CHANGED');
      try {
        assert.equal(file.read(0, 3).toString(), 'ori'); await new Promise(resolve => setImmediate(resolve));
        if (mutation === 'grow') fs.appendFileSync(path, 'more');
        if (mutation === 'rewrite') fs.writeFileSync(path, 'mutated!');
        if (mutation === 'replace') { fs.renameSync(path, path + '-original'); fs.writeFileSync(path, 'original'); }
        if (mutation === 'parent') { fs.renameSync(directory, directory + '-original'); fs.mkdirSync(directory); fs.writeFileSync(path, 'original'); }
        if (mutation === 'link') fs.linkSync(path, path + '-shared');
        assert.throws(() => file.read(3, 3), { code: 'CHANGED' }, mutation);
        assert.throws(() => file.digest(), { code: 'CHANGED' }, mutation);
      } finally { file.close(); }
    }
  } finally { fs.rmSync(root, { recursive: true }); }
});

test('bounded descriptor reads reject growth, replacement and same-size rewriting during inspection', t => {
  const root = fs.mkdtempSync(join(tmpdir(), 'ct-bounded-read-'));
  const originalRead = fs.readSync;
  try {
    for (const mutation of ['grow', 'rewrite', 'replace', 'parent']) {
      const directory = join(root, mutation); fs.mkdirSync(directory); const path = join(directory, 'output'); fs.writeFileSync(path, 'original'); let calls = 0;
      const mock = t.mock.method(fs, 'readSync', (...args) => {
        if (++calls === 1) {
          if (mutation === 'grow') fs.appendFileSync(path, Buffer.alloc(1024 * 1024));
          if (mutation === 'rewrite') fs.writeFileSync(path, 'mutated!');
          if (mutation === 'replace') { fs.renameSync(path, path + '-original'); fs.writeFileSync(path, 'original'); }
          if (mutation === 'parent') { fs.renameSync(directory, directory + '-original'); fs.mkdirSync(directory); fs.writeFileSync(path, 'original'); }
        }
        // The real file may grow by a MiB, but this reader never requests more
        // than its original eight bytes plus the overflow sentinel.
        assert(args[3] <= 9); return originalRead(...args);
      });
      syncBuiltinESMExports();
      assert.throws(() => readStableFile(path, 16, 'CHANGED'), { code: 'CHANGED' }, mutation);
      mock.mock.restore(); syncBuiltinESMExports();
    }
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); fs.rmSync(root, { recursive: true }); }
});

test('bounded reads preserve exact bytes and refuse linked, shared or oversized files', () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'ct-bounded-types-')), path = join(root, 'output');
  try {
    fs.writeFileSync(path, Buffer.from([0, 1, 2, 255])); assert.deepEqual(readStableFile(path, 4, 'INVALID'), Buffer.from([0, 1, 2, 255]));
    assert.throws(() => readStableFile(path, 3, 'INVALID'), { code: 'INVALID' });
    fs.symlinkSync(path, join(root, 'link')); assert.throws(() => readStableFile(join(root, 'link'), 10, 'INVALID'), { code: 'INVALID' });
    fs.linkSync(path, join(root, 'shared')); assert.throws(() => readStableFile(path, 10, 'INVALID'), { code: 'INVALID' });
    fs.writeFileSync(join(root, 'empty'), ''); assert.equal(readStableFile(join(root, 'empty'), 0, 'INVALID').length, 0);
  } finally { fs.rmSync(root, { recursive: true }); }
});
