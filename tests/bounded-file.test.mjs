import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readStableFile } from '../packages/engine/dist/bounded-file.js';

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
