import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { compile } from 'json-schema-to-typescript';
import { projectForTypes } from './schema-projection.mjs';

const root = new URL('../', import.meta.url);
const readJSON = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const version = await readJSON('version.json');
assert.match(version.version, /^\d+\.\d+\.\d+$/);
assert.match(version.build, /^\d+$/);
assert.equal(version.channel, 'development');
assert.equal(version.schemaVersion, 1);
const schemaDir = new URL('packages/contracts/schemas/', root);
const names = (await readdir(schemaDir)).filter(n => n.endsWith('.schema.json')).sort();
assert.equal(names.length, 18, 'Reconcile the contract census before adding schemas');
const local = new Map();
for (const name of names) {
  const schema = JSON.parse(await readFile(new URL(name, schemaDir), 'utf8'));
  local.set(schema.$id, fileURLToPath(new URL(name, schemaDir)));
}
// The same compiler-input projection applies to referenced files. HTTP fetching
// is disabled, and canonical JSON is never written by generation.
const resolver = { order: 1, canRead: true, read: async file =>
  JSON.stringify(projectForTypes(JSON.parse(await readFile(file.url, 'utf8')), local)) };
const outputs = new Map();
for (const name of names) {
  const schema = projectForTypes(JSON.parse(await readFile(new URL(name, schemaDir), 'utf8')), local);
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
const connectivity = await readJSON('packages/contracts/schemas/connectivity.schema.json');
outputs.set('apps/macos/Packages/ContributionPlatform/Sources/ContributionPlatform/ConnectivityContract.swift',
  '// Generated from connectivity.schema.json.\n' + ['state', 'stage', 'helper', 'freshness'].map(key =>
    `public enum Connectivity${key[0].toUpperCase() + key.slice(1)}: String, Codable, Sendable {\n${connectivity.properties[key].enum.map(value => `    case \`${value}\``).join('\n')}\n}\n`).join(''));
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
