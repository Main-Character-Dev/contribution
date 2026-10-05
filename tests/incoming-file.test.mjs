import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { incomingFileIdentity, incomingFileSize, retainIncomingChunk } from '../packages/engine/dist/incoming-file.js';

function fixture() {
  const root = fs.mkdtempSync(join(tmpdir(), 'ct-incoming-')), path = join(root, 'bytes'); fs.writeFileSync(path, '', { mode: 0o600 });
  return { root, path, identity: incomingFileIdentity(path), remove: () => fs.rmSync(root, { recursive: true }) };
}
test('incoming chunks retain exact replay and recover a partial write without overwriting the retained prefix', t => {
  const f = fixture(), bytes = Buffer.from('selected immutable bytes'), write = fs.writeSync; let first = true;
  try {
    const mock = t.mock.method(fs, 'writeSync', (fd, buffer, offset, length, position) => {
      if (!first) throw Error('fixture disk interruption'); first = false; return write(fd, buffer, offset, 5, position);
    }); syncBuiltinESMExports();
    assert.throws(() => retainIncomingChunk(f.path, 128, f.identity, 0, bytes), /disk interruption/);
    mock.mock.restore(); syncBuiltinESMExports(); assert.equal(incomingFileSize(f.path, 128, f.identity), 5);
    assert.equal(retainIncomingChunk(f.path, 128, f.identity, 0, bytes), bytes.length);
    assert.equal(retainIncomingChunk(f.path, 128, f.identity, 0, bytes), bytes.length);
    assert.throws(() => retainIncomingChunk(f.path, 128, f.identity, 0, Buffer.from('wrong')), { code: 'CHUNK_CONFLICT' });
    assert.throws(() => retainIncomingChunk(f.path, 128, f.identity, bytes.length + 1, Buffer.from('x')), { code: 'CHUNK_OFFSET' });
    assert.deepEqual(fs.readFileSync(f.path), bytes);
    fs.chmodSync(f.path, 0o400); assert.equal(incomingFileSize(f.path, 128, f.identity), bytes.length);
    assert.throws(() => retainIncomingChunk(f.path, 128, f.identity, 0, bytes), { code: 'TRANSFER_ALREADY_SEALED' });
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); f.remove(); }
});
test('incoming file ownership rejects replacements, links, changed parents and missing legacy identity before writing', () => {
  for (const change of ['replace', 'symbolic', 'hardlink', 'parent', 'permissions', 'legacy']) {
    const f = fixture(); try {
      const other = join(f.root, 'other'); fs.writeFileSync(other, 'foreign', { mode: 0o600 });
      if (change === 'replace') { fs.renameSync(f.path, f.path + '-retained'); fs.writeFileSync(f.path, 'foreign', { mode: 0o600 }); }
      if (change === 'symbolic') { fs.renameSync(f.path, f.path + '-retained'); fs.symlinkSync(other, f.path); }
      if (change === 'hardlink') fs.linkSync(f.path, f.path + '-shared');
      if (change === 'parent') f.identity.parentInode = '0';
      if (change === 'permissions') fs.chmodSync(f.path, 0o644);
      const selected = change === 'legacy' ? undefined : f.identity, before = fs.readFileSync(f.path);
      assert.throws(() => retainIncomingChunk(f.path, 128, selected, before.length, Buffer.from('append')), { code: change === 'legacy' ? 'TRANSFER_RECOVERY_REQUIRED' : 'TRANSFER_FILE_CHANGED' }, change);
      assert.deepEqual(fs.readFileSync(f.path), before); assert.equal(fs.readFileSync(other, 'utf8'), 'foreign');
    } finally { f.remove(); }
  }
});
test('incoming descriptor writes reject replacement between open and write without touching the foreign pathname', t => {
  const f = fixture(), open = fs.openSync; let changed = false;
  try {
    t.mock.method(fs, 'openSync', (...args) => {
      const fd = open(...args);
      if (args[0] === f.path && !changed) { changed = true; fs.renameSync(f.path, f.path + '-original'); fs.writeFileSync(f.path, 'foreign', { mode: 0o600 }); }
      return fd;
    }); syncBuiltinESMExports();
    assert.throws(() => retainIncomingChunk(f.path, 128, f.identity, 0, Buffer.from('selected')), { code: 'TRANSFER_FILE_CHANGED' });
    assert.equal(fs.readFileSync(f.path, 'utf8'), 'foreign'); assert.equal(fs.readFileSync(f.path + '-original').length, 0);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); f.remove(); }
});
