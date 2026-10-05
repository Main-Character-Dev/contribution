import { readFileSync, readdirSync, lstatSync, realpathSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { requireValue, digest } from './core.js';

export interface Payload { root: string; identity: string; manifestDigest?: string; node: string; cli: string; service: string; distribution: string }
export function verifyPayload(root: string): Payload {
  root = realpathSync(root);
  const raw = readFileSync(join(root, 'manifest.json'), 'utf8');
  const manifest = JSON.parse(raw) as { schemaVersion: number; distribution: string; files: Record<string, string>; entrypoints: { cli: string; service: string } };
  requireValue(manifest.schemaVersion === 1 && ['unsigned-development', 'signed-release'].includes(manifest.distribution), 'PAYLOAD_INVALID', 'Unsupported installed payload manifest.', 3);
  const observed = new Set<string>();
  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name), key = relative(root, path);
      requireValue(!lstatSync(path).isSymbolicLink(), 'PAYLOAD_INVALID', 'Payload contains a mutable symlink.', 3);
      if (entry.isDirectory()) visit(path);
      else if (key !== 'manifest.json') {
        requireValue(manifest.files[key] === createHash('sha256').update(readFileSync(path)).digest('hex'), 'PAYLOAD_DIGEST_MISMATCH', 'Installed payload files changed or were added.', 3); observed.add(key);
      }
    }
  }
  visit(root);
  requireValue(observed.size === Object.keys(manifest.files).length, 'PAYLOAD_INVALID', 'Installed payload is incomplete.', 3);
  const node = join(root, 'runtime/node'), cli = resolve(root, manifest.entrypoints.cli), service = resolve(root, manifest.entrypoints.service);
  for (const path of [node, cli, service]) requireValue(observed.has(relative(root, path)), 'PAYLOAD_INVALID', 'Payload entry point is outside its verified manifest.', 3);
  return { root, identity: digest(manifest), manifestDigest: createHash('sha256').update(raw).digest('hex'), node, cli, service, distribution: manifest.distribution };
}
