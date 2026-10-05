import { closeSync, constants, fstatSync, openSync, readSync, opendirSync, lstatSync, realpathSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { requireValue, digest } from './core.js';

export interface Payload { root: string; identity: string; manifestDigest?: string; node: string; cli: string; service: string; distribution: string }
// Bound allocations and reject special files before opening them (including FIFOs).
function readVerified(path: string, limit: number, consume: (bytes: Buffer) => void): number {
  const before = lstatSync(path, { bigint: true });
  const same = (after: typeof before) => ['dev', 'ino', 'mode', 'uid', 'size', 'nlink', 'mtimeNs', 'ctimeNs'].every(key => before[key as keyof typeof before] === after[key as keyof typeof before]);
  requireValue(before.isFile() && before.nlink === 1n && before.size <= BigInt(limit), 'PAYLOAD_INVALID', 'Payload file is not a bounded independent regular file.', 3);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    requireValue(same(fstatSync(fd, { bigint: true })), 'PAYLOAD_INVALID', 'Payload changed while opening.', 3);
    const size = Number(before.size), buffer = Buffer.alloc(Math.min(size, 1024 * 1024));
    let position = 0;
    while (position < size) {
      const count = readSync(fd, buffer, 0, Math.min(buffer.length, size - position), position);
      requireValue(count > 0, 'PAYLOAD_INVALID', 'Payload changed while reading.', 3);
      consume(buffer.subarray(0, count)); position += count;
    }
    requireValue(same(fstatSync(fd, { bigint: true })) && same(lstatSync(path, { bigint: true })), 'PAYLOAD_INVALID', 'Payload changed while reading.', 3);
    return size;
  } finally { closeSync(fd); }
}
export function verifyPayload(root: string): Payload {
  root = realpathSync(root);
  const chunks: Buffer[] = [];
  readVerified(join(root, 'manifest.json'), 4 * 1024 * 1024, bytes => chunks.push(Buffer.from(bytes)));
  const raw = Buffer.concat(chunks);
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)) as { schemaVersion: number; distribution: string; files: Record<string, string>; entrypoints: { cli: string; service: string } };
  requireValue(manifest.schemaVersion === 1 && ['unsigned-development', 'signed-release'].includes(manifest.distribution), 'PAYLOAD_INVALID', 'Unsupported installed payload manifest.', 3);
  requireValue(manifest.files && typeof manifest.files === 'object' && !Array.isArray(manifest.files) && manifest.entrypoints && typeof manifest.entrypoints === 'object', 'PAYLOAD_INVALID', 'Payload inventory is malformed.', 3);
  const keys = Object.keys(manifest.files);
  requireValue(keys.length > 0 && keys.length <= 100000 && keys.every(key => key.length <= 4096 && key !== 'manifest.json' && !/[\\\x00-\x1f\x7f]/.test(key) && key.split('/').every(part => part && part !== '.' && part !== '..') && /^[a-f0-9]{64}$/.test(manifest.files[key]!)), 'PAYLOAD_INVALID', 'Payload inventory is malformed.', 3);
  const observed = new Set<string>();
  let entries = 0, total = 0;
  function visit(directory: string, depth = 0): void {
    requireValue(depth <= 32, 'PAYLOAD_INVALID', 'Payload exceeds directory depth limit.', 3);
    const handle = opendirSync(directory);
    try { for (let entry = handle.readSync(); entry; entry = handle.readSync()) {
      requireValue(++entries <= 100000, 'PAYLOAD_INVALID', 'Payload exceeds entry limit.', 3);
      const path = join(directory, entry.name), key = relative(root, path);
      requireValue(!lstatSync(path).isSymbolicLink(), 'PAYLOAD_INVALID', 'Payload contains a mutable symlink.', 3);
      if (entry.isDirectory()) visit(path, depth + 1);
      else if (key !== 'manifest.json') {
        const hash = createHash('sha256');
        total += readVerified(path, Math.min(512 * 1024 * 1024, 4 * 1024 * 1024 * 1024 - total), bytes => { hash.update(bytes); });
        requireValue(manifest.files[key] === hash.digest('hex'), 'PAYLOAD_DIGEST_MISMATCH', 'Installed payload files changed or were added.', 3); observed.add(key);
      }
    } } finally { handle.closeSync(); }
  }
  visit(root);
  requireValue(observed.size === Object.keys(manifest.files).length, 'PAYLOAD_INVALID', 'Installed payload is incomplete.', 3);
  requireValue(typeof manifest.entrypoints.cli === 'string' && typeof manifest.entrypoints.service === 'string' && observed.has(manifest.entrypoints.cli) && observed.has(manifest.entrypoints.service), 'PAYLOAD_INVALID', 'Payload entry points are missing.', 3);
  const node = join(root, 'runtime/node'), cli = resolve(root, manifest.entrypoints.cli), service = resolve(root, manifest.entrypoints.service);
  for (const path of [node, cli, service]) requireValue(observed.has(relative(root, path)), 'PAYLOAD_INVALID', 'Payload entry point is outside its verified manifest.', 3);
  return { root, identity: digest(manifest), manifestDigest: createHash('sha256').update(raw).digest('hex'), node, cli, service, distribution: manifest.distribution };
}
