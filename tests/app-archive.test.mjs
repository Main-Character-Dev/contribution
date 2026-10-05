import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { extractSignedAppArchive } from '../packages/engine/dist/app-archive.js';
import { appTreeDigest } from '../packages/engine/dist/device-artifacts.js';
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ct-zip-')), app = join(root, 'App.app'), zip = join(root, 'app.zip');
  mkdirSync(app); mkdirSync(join(app, 'Resources')); writeFileSync(join(app, 'program'), 'fixture executable'); chmodSync(join(app, 'program'), 0o755);
  writeFileSync(join(app, 'Resources/content.txt'), 'bounded fixture contents\n'.repeat(100));
  execFileSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', '--norsrc', app, zip]);
  return { root, app, zip, cleanup: () => rmSync(root, { recursive: true }) };
}
function entries(bytes) {
  const found = []; for (let i = 0; i + 46 < bytes.length; i++) if (bytes.readUInt32LE(i) === 0x02014b50) found.push({ position: i, name: bytes.subarray(i + 46, i + 46 + bytes.readUInt16LE(i + 28)).toString('utf8'), local: bytes.readUInt32LE(i + 42) }); return found;
}

test('a real ditto archive preserves exact app bytes and executable modes in a new owned directory', () => {
  const f = fixture(); try {
    const result = extractSignedAppArchive(f.zip, join(f.root, 'received'), 'App.app');
    assert.equal(result.files, 2); assert.equal(appTreeDigest(result.appPath), appTreeDigest(f.app));
    assert.equal(statSync(join(result.appPath, 'program')).mode & 0o777, 0o755);
    assert.throws(() => extractSignedAppArchive(f.zip, join(f.root, 'received'), 'App.app'), error => error.code === 'ARTIFACT_DESTINATION_EXISTS');
  } finally { f.cleanup(); }
});

test('archive traversal, links, encryption, unsupported compression and oversized entries refuse before writing', () => {
  for (const kind of ['traversal', 'symlink', 'encrypted', 'compression', 'oversized']) {
    const f = fixture(); try {
      const bytes = readFileSync(f.zip), entry = entries(bytes).find(entry => entry.name.endsWith('content.txt'));
      assert(entry);
      if (kind === 'traversal') { const name = 'App.app/../' + 'x'.repeat(Buffer.byteLength(entry.name) - 11); bytes.write(name, entry.position + 46); bytes.write(name, entry.local + 30); }
      if (kind === 'symlink') bytes.writeUInt32LE((0xa1ff << 16) >>> 0, entry.position + 38);
      if (kind === 'encrypted') bytes.writeUInt16LE(bytes.readUInt16LE(entry.position + 8) | 1, entry.position + 8);
      if (kind === 'compression') bytes.writeUInt16LE(99, entry.position + 10);
      if (kind === 'oversized') bytes.writeUInt32LE(0x7fffffff, entry.position + 24);
      writeFileSync(f.zip, bytes); const target = join(f.root, 'received');
      assert.throws(() => extractSignedAppArchive(f.zip, target, 'App.app'), error => error.code === 'INVALID_APP_ARCHIVE'); assert.equal(existsSync(target), false);
    } finally { f.cleanup(); }
  }
});

test('changed compressed data cannot become a verified app', () => {
  const f = fixture(); try {
    const bytes = readFileSync(f.zip), entry = entries(bytes).find(entry => entry.name.endsWith('content.txt'));
    const start = entry.local + 30 + bytes.readUInt16LE(entry.local + 26) + bytes.readUInt16LE(entry.local + 28); bytes[start + 5] ^= 0x80;
    writeFileSync(f.zip, bytes); assert.throws(() => extractSignedAppArchive(f.zip, join(f.root, 'received'), 'App.app'));
  } finally { f.cleanup(); }
});
