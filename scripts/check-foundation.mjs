import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, resolve, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const read = path => readFileSync(resolve(root, path), 'utf8');
const json = path => JSON.parse(read(path));
const hash = path => createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex');
assert.equal(hash('LICENSE'), 'db03345b62f3cffc0972ba8544bd5e9f6a73482d08537e2323fc92284f88a414');
const imports = json('docs/source-imports.json');
const canonical = imports.imports.filter(v => v.destination.endsWith('.json'));
assert.equal(canonical.length, 26);
for (const item of canonical) assert.equal(hash('docs/' + item.destination), item.sourceSha256, item.destination);
assert(!existsSync(resolve(root, 'docs/schemas')) && !existsSync(resolve(root, 'docs/examples')));
const baseline = json('docs/verification/s0-retained-baseline.json');
for (const [path, digest] of Object.entries(baseline.maintainedSha256)) assert.equal(hash(path), digest, path);
assert.equal(new Set(read('docs/requirements/01-PRODUCT_REQUIREMENTS.md').match(/PRD-[A-Z]+-\d+(?=:)/g)).size, 63);
assert.equal(new Set(read('docs/requirements/08-REMOTE_IPHONE_DEVELOPMENT.md').match(/RDEV-\d+(?= —)/g)).size, 40);
const ledger = json('docs/verification/acceptance-status.json');
assert.equal(ledger.cases.filter(c => c.track === 'core' && !c.id.startsWith('AT-R')).length, 54);
assert.equal(ledger.cases.filter(c => c.track === 'core' && c.id.startsWith('AT-R')).length, 5);
assert.equal(ledger.cases.filter(c => c.track === 'remote-device').length, 24);
assert.equal(new Set(ledger.cases.map(c => c.id)).size, 83);
for (const c of ledger.cases) {
  assert.equal(c.outcome, 'not_run'); assert.equal(c.implementation, 'not_started');
  assert.equal(c.evidence.length, 0);
}
const pins = json('toolchain.json'), pkg = json('package.json');
assert.equal(pkg.engines.node, pins.node); assert.equal(read('.node-version').trim(), pins.node);
assert.equal(pkg.packageManager, 'pnpm@' + pins.pnpm);
assert.equal(pkg.engines.pnpm, pins.pnpm); assert.equal(pkg.devDependencies.typescript, pins.typescript);
const allowlist = json('config/payload-allowlist.json');
assert.equal(allowlist.releasePackaging, 'unavailable'); assert.deepEqual(allowlist.releaseInputs, []);
for (const input of [...allowlist.developmentAppInputs, ...allowlist.developmentCLIInputs]) {
  assert(!input.includes('..') && /^(apps\/macos\/|packages\/)/.test(input), input);
  assert(!/(private|docs|\.env|signing|pairing)/.test(input), input);
}
const excluded = new Set(['.git','.tools','.cache','.build','.pnpm-store','node_modules','dist','.swiftpm','xcuserdata']);
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (excluded.has(entry.name)) return [];
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}
let links = 0;
for (const file of files(root)) {
  const name = relative(root, file);
  assert(!/\.(zip|p12|p8|pem|key|mobileprovision|provisionprofile)$/.test(name), `Private input: ${name}`);
  if (!['.md','.json','.ts','.swift','.mjs','.py','.sh','.yaml','.plist','.pbxproj','.xcscheme','.xcconfig',''].includes(extname(file))) continue;
  const content = readFileSync(file, 'utf8');
  assert(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content), name);
  if (extname(file) !== '.md') continue;
  for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1];
    if (/^[a-z]+:/i.test(target)) continue;
    const [path, anchor] = target.split('#');
    const destination = path ? resolve(dirname(file), decodeURIComponent(path)) : file;
    assert(existsSync(destination), `Missing ${name} -> ${target}`);
    if (anchor) {
      const headings = readFileSync(destination, 'utf8').split('\n').filter(l => /^#+ /.test(l))
        .map(l => l.replace(/^#+ /,'').toLowerCase().replace(/[^\w\s-]/g,'').replace(/\s/g,'-'));
      assert(headings.includes(anchor), `Missing anchor ${name} -> ${target}`);
    }
    links++;
  }
}
console.log(`Foundation checked: MIT, 26 byte-identical JSON imports, 63 PRD/40 RDEV requirements, 83 unrun cases (54 original core + 5 robustness + 24 device), pins, payload boundary, privacy and ${links} local links.`);
