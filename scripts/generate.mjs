import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { compile } from 'json-schema-to-typescript';

const root = new URL('../', import.meta.url);
const readJSON = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const version = await readJSON('version.json');
assert.match(version.version, /^\d+\.\d+\.\d+$/);
assert.match(version.build, /^\d+$/);
assert.equal(version.channel, 'development');
assert.equal(version.schemaVersion, 1);
const schemaDir = new URL('packages/contracts/schemas/', root);
const names = (await readdir(schemaDir)).filter(n => n.endsWith('.schema.json')).sort();
assert.equal(names.length, 12, 'Reconcile the contract census before adding schemas');
const local = new Map();
for (const name of names) {
  const schema = JSON.parse(await readFile(new URL(name, schemaDir), 'utf8'));
  local.set(schema.$id, fileURLToPath(new URL(name, schemaDir)));
}
// Generator-only ref rewriting. Canonical JSON remains byte-identical.
// Resolution is local and HTTP fetching is disabled.
function transform(value) {
  if (Array.isArray(value)) return value.map(transform);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, val]) => {
    if (key === '$ref' && typeof val === 'string' && val.startsWith('urn:')) {
      const [id, fragment] = val.split('#');
      assert(local.has(id), `Unknown schema URN ${id}`);
      return [key, local.get(id) + (fragment ? '#' + fragment : '')];
    }
    return [key, transform(val)];
  }));
  return value;
}
// A custom resolver also rewrites nested files before the tested generator sees them.
const resolver = { order: 1, canRead: true, read: async file => JSON.stringify(transform(JSON.parse(await readFile(file.url, 'utf8')))) };
const outputs = new Map();
for (const name of names) {
  const schema = transform(JSON.parse(await readFile(new URL(name, schemaDir), 'utf8')));
  delete schema.title; delete schema.$id;
  const type = name.replace('.schema.json', '').split('-').map(s => s[0].toUpperCase() + s.slice(1)).join('');
  outputs.set(`packages/contracts/src/generated/${name.replace('.schema.json', '.ts')}`,
    await compile(schema, type, { cwd: fileURLToPath(schemaDir), unknownAny: true,
      bannerComment: '/* Generated from canonical JSON Schema. Runtime validation remains required. */',
      $refOptions: { resolve: { http: false, file: resolver } } }));
}
outputs.set('packages/contracts/src/generated/version.ts', '// Generated from version.json.\nexport const buildIdentity = ' + JSON.stringify(version, null, 2) + ' as const;\n');
outputs.set('apps/macos/Config/Version.xcconfig', `// Generated from version.json.\nMARKETING_VERSION = ${version.version}\nCURRENT_PROJECT_VERSION = ${version.build}\n`);
const response = await readJSON('packages/contracts/schemas/response.schema.json');
const statuses = response.properties.requestStatus.enum;
const states = response.properties.operationState.anyOf[0].enum;
outputs.set('apps/macos/Packages/ContributionPlatform/Sources/ContributionPlatform/BuildIdentity.swift',
`// Generated from version.json and response.schema.json.\npublic enum BuildIdentity {\n    public static let version = "${version.version}"\n    public static let build = "${version.build}"\n    public static let channel = "${version.channel}"\n    public static let schemaVersion = ${version.schemaVersion}\n}\npublic enum RequestStatus: String, Codable, Sendable {\n${statuses.map(s => `    case ${s}`).join('\n')}\n}\npublic enum OperationState: String, Codable, Sendable {\n${states.map(s => `    case ${s}`).join('\n')}\n}\n`);
for (const [path, content] of outputs) {
  const url = new URL(path, root);
  if (process.argv.includes('--check')) {
    assert.equal(await readFile(url, 'utf8'), content, `Generated output drift: ${path}`);
  } else {
    await mkdir(new URL('.', url), { recursive: true }); await writeFile(url, content);
  }
}
const generated = await readdir(new URL('packages/contracts/src/generated/', root));
assert.deepEqual(generated.filter(n => n.endsWith('.ts')).sort(), [...outputs.keys()]
  .filter(n => n.startsWith('packages/contracts/')).map(n => n.split('/').at(-1)).sort(), 'Unexpected generated type files');
console.log(`${process.argv.includes('--check') ? 'Checked' : 'Generated'} ${outputs.size} client/identity files.`);
