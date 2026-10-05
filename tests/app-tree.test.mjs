import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appTreeDigest, inspectSignedApp } from '../packages/engine/dist/device-artifacts.js';
import { digest } from '../packages/engine/dist/core.js';

function fixture() {
  const root = fs.mkdtempSync(join(tmpdir(), 'ct-app-tree-')), app = join(root, 'Fixture.app'); fs.mkdirSync(app);
  fs.mkdirSync(join(app, 'Assets')); fs.writeFileSync(join(app, 'Assets', 'data'), Buffer.from([0, 255, 3]));
  fs.writeFileSync(join(app, 'program'), Buffer.alloc(3 * 1024 ** 2 + 7, 13), { mode: 0o755 });
  return { root, app, cleanup: () => fs.rmSync(root, { recursive: true }) };
}
test('app tree hashes preserve prior receipt identity with bounded buffers for large files', t => {
  const f = fixture(), originalRead = fs.readSync;
  try {
    const expected = digest(['Assets/data', 'program'].map(path => [path, fs.statSync(join(f.app, path)).mode & 0o777, digest(fs.readFileSync(join(f.app, path)))]));
    let calls = 0;
    t.mock.method(fs, 'readSync', (...args) => { calls++; assert(args[3] <= 1024 ** 2); return originalRead(...args); }); syncBuiltinESMExports();
    assert.equal(appTreeDigest(f.app), expected); assert.equal(calls, 5);
    fs.chmodSync(join(f.app, 'program'), 0o644); assert.notEqual(appTreeDigest(f.app), expected);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); f.cleanup(); }
});

test('app verification rejects changed siblings, added files and replaced directories during hashing', t => {
  const originalRead = fs.readSync;
  for (const kind of ['sibling', 'added', 'replace', 'root', 'growth']) {
    const f = fixture(); let reads = 0;
    try {
      const mocked = t.mock.method(fs, 'readSync', (...args) => {
        if (++reads === 2) {
          if (kind === 'sibling') fs.writeFileSync(join(f.app, 'Assets', 'data'), Buffer.from([1, 2, 3]));
          if (kind === 'added') fs.writeFileSync(join(f.app, 'new-file'), 'concurrent data');
          if (kind === 'replace') { fs.renameSync(join(f.app, 'Assets'), join(f.app, 'Assets-old')); fs.mkdirSync(join(f.app, 'Assets')); fs.writeFileSync(join(f.app, 'Assets', 'data'), Buffer.from([0, 255, 3])); }
          if (kind === 'root') { fs.renameSync(f.app, f.app + '-old'); fs.cpSync(f.app + '-old', f.app, { recursive: true }); }
          if (kind === 'growth') fs.appendFileSync(join(f.app, 'program'), Buffer.alloc(1024));
        }
        return originalRead(...args);
      }); syncBuiltinESMExports();
      assert.throws(() => appTreeDigest(f.app), { code: 'ARTIFACT_CHANGED' }, kind);
      mocked.mock.restore(); syncBuiltinESMExports();
    } finally { t.mock.restoreAll(); syncBuiltinESMExports(); f.cleanup(); }
  }
});

test('app roots, hardlinks, symlinks, excessive depth and bytes cannot enter verification', () => {
  for (const kind of ['root', 'hardlink', 'symlink', 'depth', 'size']) {
    const f = fixture(); try {
      if (kind === 'hardlink') fs.linkSync(join(f.app, 'program'), join(f.root, 'shared'));
      if (kind === 'symlink') fs.symlinkSync(join(f.root, 'outside'), join(f.app, 'link'));
      if (kind === 'depth') { let path = f.app; for (let i = 0; i < 33; i++) { path = join(path, 'nested'); fs.mkdirSync(path); } }
      if (kind === 'size') fs.truncateSync(join(f.app, 'program'), 4 * 1024 ** 3 + 1);
      assert.throws(() => appTreeDigest(kind === 'root' ? join(f.app, 'program') : f.app), { code: kind === 'hardlink' ? 'ARTIFACT_CHANGED' : kind === 'symlink' ? 'ARTIFACT_LINK_UNSUPPORTED' : kind === 'root' ? 'ARTIFACT_INVALID' : 'ARTIFACT_TOO_LARGE' });
    } finally { f.cleanup(); }
  }
});

test('provisioning decoding consumes the same bounded bytes retained in the signed receipt', async () => {
  const expected = { bundleId: 'dev.example.fixture', teamId: 'FIXTURETEAM', marketingVersion: '1.0', buildVersion: '1', applicationIdentifier: 'FIXTURETEAM.dev.example.fixture' };
  const entitlements = { 'application-identifier': expected.applicationIdentifier, 'com.apple.developer.team-identifier': expected.teamId, 'get-task-allow': true };
  const xml = '<?xml version="1.0"?><plist version="1.0"><dict><key>ExpirationDate</key><date>2030-10-05T12:00:00Z</date><key>ProvisionedDevices</key><array><string>fixture-phone</string></array><key>TeamIdentifier</key><array><string>FIXTURETEAM</string></array></dict></plist>';
  for (const change of ['none', 'profile', 'program']) {
    const f = fixture(); try {
      const original = Buffer.from('synthetic CMS input, not a signing credential');
      fs.writeFileSync(join(f.app, 'embedded.mobileprovision'), original);
      fs.writeFileSync(join(f.app, 'Info.plist'), JSON.stringify({ CFBundleIdentifier: expected.bundleId, CFBundleVersion: '1', CFBundleShortVersionString: '1.0' }));
      const invoke = async (exe, argv, options) => {
        let stdout = '';
        if (exe === '/usr/bin/security') { assert.deepEqual(argv, ['cms', '-D']); assert.deepEqual(options.input, original); stdout = xml; }
        else if (exe === '/usr/bin/codesign' && argv.includes('--display')) {
          stdout = JSON.stringify(entitlements);
          if (change === 'profile') fs.writeFileSync(join(f.app, 'embedded.mobileprovision'), 'changed input');
          if (change === 'program') fs.appendFileSync(join(f.app, 'program'), 'changed signed bytes');
        } else if (exe === '/usr/bin/plutil') stdout = argv.includes('-convert') ? options.input.toString() : JSON.stringify(entitlements);
        return { code: 0, actualExitCode: 0, signal: null, stdout, stderr: '', timedOut: false, cancelled: false };
      };
      const result = inspectSignedApp(f.app, expected, 'development', [{ deviceId: 'fixture-device', udid: 'fixture-phone' }], invoke);
      if (change === 'none') assert.equal((await result).provisioningProfileDigest, digest(original));
      else await assert.rejects(result, { code: change === 'profile' ? 'PROVISIONING_CHANGED' : 'ARTIFACT_CHANGED' });
    } finally { f.cleanup(); }
  }
});
