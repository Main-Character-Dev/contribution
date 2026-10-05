import { mkdirSync, cpSync, readdirSync, readFileSync, writeFileSync, chmodSync, lstatSync, realpathSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '..');
const allowlist = JSON.parse(readFileSync(join(root, 'config/payload-allowlist.json'), 'utf8')).developmentEngine;
assert.deepEqual(allowlist.workspacePackages, ['contracts', 'adapters', 'engine', 'cli']);
assert.deepEqual(allowlist.runtimeDependencies, ['ajv', 'ajv-formats']);
assert.equal(allowlist.runtimeBinary, '.tools/node/bin/node');
assert.equal(allowlist.runtimeLicense, '.tools/node/LICENSE');
assert.deepEqual(allowlist.rootFiles, ['LICENSE', 'version.json']);
const output = resolve(process.argv[2] ?? join(root, '.build', 'payload'));
// Never merge a release with stale files. The caller selects a fresh directory.
mkdirSync(output, { recursive: false, mode: 0o700 });
const require = createRequire(join(root, 'packages/contracts/package.json'));
const copy = (from, to) => { mkdirSync(dirname(to), { recursive: true }); cpSync(from, to, { recursive: true, dereference: true }); };
copy(join(root, allowlist.runtimeBinary), join(output, 'runtime/node'));
copy(join(root, allowlist.runtimeLicense), join(output, 'runtime/LICENSE'));
for (const file of allowlist.rootFiles) copy(join(root, file), join(output, file));
for (const name of allowlist.workspacePackages) {
  const source = join(root, 'packages', name), dest = join(output, 'node_modules/@contribution', name);
  copy(join(source, 'package.json'), join(dest, 'package.json'));
  const visit = (directory) => { for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) visit(path);
    else if (entry.isFile() && entry.name.endsWith('.js')) {
      // TypeScript does not remove obsolete outputs. Never ship a removed
      // worker simply because a prior build left its JavaScript in dist.
      const sourcePath = join(source, 'src', relative(join(source, 'dist'), path).replace(/\.js$/, '.ts'));
      assert(lstatSync(sourcePath).isFile(), 'Stale compiled output has no current source');
      copy(path, join(dest, relative(source, path)));
    }
  } }; visit(join(source, 'dist'));
  if (name === 'contracts') copy(join(source, 'schemas'), join(dest, 'schemas'));
}
const dependencies = new Set();
function dependency(name, resolver) {
  if (dependencies.has(name)) return; dependencies.add(name);
  const packagePath = resolver.resolve(`${name}/package.json`), source = dirname(packagePath);
  const metadata = JSON.parse(readFileSync(packagePath, 'utf8'));
  copy(source, join(output, 'node_modules', name));
  const nested = createRequire(packagePath);
  for (const child of Object.keys(metadata.dependencies ?? {})) dependency(child, nested);
}
for (const name of allowlist.runtimeDependencies) dependency(name, require);
const files = {};
function inventory(directory) { for (const entry of readdirSync(directory, { withFileTypes: true })) {
  const path = join(directory, entry.name);
  assert(!lstatSync(path).isSymbolicLink(), 'Payload cannot contain symlinks');
  if (entry.isDirectory()) inventory(path);
  else files[relative(output, path)] = createHash('sha256').update(readFileSync(path)).digest('hex');
} }
inventory(output);
const manifest = { schemaVersion: 1, distribution: 'unsigned-development', version: JSON.parse(readFileSync(join(root, 'version.json'), 'utf8')),
  runtimeVersion: process.version, entrypoints: { service: 'node_modules/@contribution/engine/dist/service-main.js', cli: 'node_modules/@contribution/cli/dist/main.js' }, files };
writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
chmodSync(join(output, 'runtime/node'), 0o755);
console.log(JSON.stringify({ payload: realpathSync(output), files: Object.keys(files).length, distribution: manifest.distribution }));
