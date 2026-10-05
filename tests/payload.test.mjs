import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, truncateSync, linkSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { verifyPayload } from '../packages/engine/dist/payload.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ct-payload-bounds-'));
  mkdirSync(join(root, 'runtime'));
  const files = {};
  for (const key of ['runtime/node', 'cli.js', 'service.js']) {
    writeFileSync(join(root, key), key);
    files[key] = createHash('sha256').update(key).digest('hex');
  }
  const manifest = { schemaVersion: 1, distribution: 'unsigned-development', files, entrypoints: { cli: 'cli.js', service: 'service.js' } };
  writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest));
  return { root, manifest };
}

test('payload verifies bounded independent files and retains manifest identity', () => {
  const { root } = fixture();
  try { assert.equal(verifyPayload(root).manifestDigest, createHash('sha256').update(readFileSync(join(root, 'manifest.json'))).digest('hex')); }
  finally { rmSync(root, { recursive: true }); }
});

for (const variant of ['manifest size', 'file size', 'fifo', 'hard link', 'symlink', 'depth', 'entrypoint escape']) {
  test(`payload rejects ${variant} without executing payload files`, { timeout: 5000 }, () => {
    const { root, manifest } = fixture();
    try {
      if (variant === 'manifest size') truncateSync(join(root, 'manifest.json'), 4 * 1024 * 1024 + 1);
      if (variant === 'file size') truncateSync(join(root, 'cli.js'), 512 * 1024 * 1024 + 1);
      if (variant === 'fifo') assert.equal(spawnSync('mkfifo', [join(root, 'pipe')]).status, 0);
      if (variant === 'hard link') linkSync(join(root, 'cli.js'), join(root, 'shared'));
      if (variant === 'symlink') symlinkSync('cli.js', join(root, 'linked'));
      if (variant === 'depth') mkdirSync(join(root, ...Array(34).fill('deep')), { recursive: true });
      if (variant === 'entrypoint escape') { manifest.entrypoints.cli = '../cli.js'; writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest)); }
      assert.throws(() => verifyPayload(root));
    } finally { rmSync(root, { recursive: true }); }
  });
}
