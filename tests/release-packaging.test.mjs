import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

test('release planning never signs or creates output and execution rejects an unreviewed development channel', () => {
  const root = mkdtempSync(join(tmpdir(), 'ct-release-plan-'));
  try {
    const output = join(root, 'candidate'), args = ['scripts/prepare-release.py', '--output', output,
      '--identity', 'Developer ID Application: Fixture', '--notary-profile', 'fixture', '--sparkle-account', 'fixture',
      '--public-key', Buffer.alloc(32).toString('base64'), '--feed-url', 'https://example.invalid/appcast.xml', '--download-url', 'https://example.invalid/app.zip'];
    const planned = spawnSync('python3', args, { encoding: 'utf8' });
    assert.equal(planned.status, 0, planned.stderr); assert.equal(JSON.parse(planned.stdout).execution, false); assert.equal(existsSync(output), false);
    const executed = spawnSync('python3', [...args, '--execute'], { encoding: 'utf8' });
    assert.notEqual(executed.status, 0); assert.match(executed.stderr, /release version\/channel/); assert.equal(existsSync(output), false);
  } finally { rmSync(root, { recursive: true }); }
});

test('release verification binds the archive signature to the key embedded in the app', () => {
  const root = mkdtempSync(join(tmpdir(), 'ct-release-signature-'));
  try {
    const archive = join(root, 'fixture.zip'), data = Buffer.from('disposable archive fixture'), pair = generateKeyPairSync('ed25519');
    writeFileSync(archive, data);
    const publicKey = pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
    const signature = sign(null, data, pair.privateKey).toString('base64');
    const verify = key => spawnSync(process.execPath, [resolve('scripts/verify-update-signature.mjs'), archive, key, signature], { encoding: 'utf8' });
    assert.equal(verify(publicKey).status, 0);
    assert.notEqual(verify(Buffer.alloc(32).toString('base64')).status, 0);
    writeFileSync(archive, 'changed archive'); assert.notEqual(verify(publicKey).status, 0);
  } finally { rmSync(root, { recursive: true }); }
});
