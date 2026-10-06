import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, chmodSync, rmSync, statSync, realpathSync, truncateSync, linkSync, unlinkSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'ct-native-payload-')));
const contents = join(root, 'Fixture.app/Contents'), source = join(contents, 'Resources/Engine'), support = join(root, 'state');
const launcher = join(contents, 'Library/ContributionService');
let running;
try {
  mkdirSync(join(contents, 'Library'), { recursive: true }); mkdirSync(join(source, 'runtime'), { recursive: true });
  copyFileSync(process.argv[2], launcher); copyFileSync(process.execPath, join(source, 'runtime/node'));
  const writeVersion = version => {
    writeFileSync(join(source, 'cli.cjs'), `console.log(JSON.stringify({version:${version},path:__dirname,args:process.argv.slice(2)}));`);
    writeFileSync(join(source, 'service.cjs'), 'console.log(__dirname);process.stdin.on("data",bytes=>{require("node:fs").writeFileSync(process.env.CONTRIBUTION_TEST_SUPPORT_ROOT+"/native-hint.json",bytes)});setInterval(()=>{},1000);');
    const files = Object.fromEntries(['runtime/node', 'cli.cjs', 'service.cjs'].map(file => [file, createHash('sha256').update(readFileSync(join(source, file))).digest('hex')]));
    writeFileSync(join(source, 'manifest.json'), JSON.stringify({ schemaVersion: 1, distribution: 'unsigned-development', files, entrypoints: { cli: 'cli.cjs', service: 'service.cjs' } }));
  };
  const env = { ...process.env, CONTRIBUTION_TEST_SUPPORT_ROOT: support };
  writeVersion(1);
  running = spawn(launcher, [], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = ''; running.stderr.on('data', bytes => { errors += bytes; });
  const oldPath = String((await Promise.race([once(running.stdout, 'data'), once(running, 'exit').then(([code]) => { throw new Error(`Launcher exited ${code}: ${errors}`); })]))[0]).trim();
  const hintPath = join(support, 'native-hint.json');
  for (let attempt = 0; attempt < 40; attempt++) { try { readFileSync(hintPath); break; } catch { await new Promise(resolve => setTimeout(resolve, 50)); } }
  assert.deepEqual(JSON.parse(readFileSync(hintPath, 'utf8')), { event: 'launch' }, 'The UI-closed launcher relays a categorical hint to its one engine child');
  assert(oldPath.startsWith(join(support, 'Payloads/'))); assert.equal(statSync(oldPath).mode & 0o777, 0o500);
  const call = () => spawnSync(launcher, ['--cli', 'version', '--json'], { env, encoding: 'utf8', timeout: 20000 });
  assert.equal(JSON.parse(call().stdout).path, oldPath);
  writeVersion(2);
  const next = call(); assert.equal(next.status, 0, next.stderr); const updated = JSON.parse(next.stdout);
  assert.equal(updated.version, 2); assert.notEqual(updated.path, oldPath); assert.equal(running.exitCode, null);
  assert.match(readFileSync(join(oldPath, 'cli.cjs'), 'utf8'), /version:1/);
  assert.deepEqual(updated.args, ['version', '--json']);
  const altered = join(updated.path, 'cli.cjs'); chmodSync(altered, 0o600); writeFileSync(altered, 'tampered');
  assert.equal(call().status, 3); assert.equal(readFileSync(altered, 'utf8'), 'tampered', 'A damaged retained payload is not silently overwritten');
  writeVersion(3);
  const manifestBytes = readFileSync(join(source, 'manifest.json'));
  truncateSync(join(source, 'manifest.json'), 4_194_305);
  assert.equal(call().status, 3, 'Oversized manifest is refused before allocation');
  writeFileSync(join(source, 'manifest.json'), manifestBytes);
  truncateSync(join(source, 'cli.cjs'), 536_870_913);
  assert.equal(call().status, 3, 'Oversized file is refused before allocation');
  writeVersion(3);
  for (const kind of ['fifo', 'hardlink', 'symlink']) {
    const extra = join(source, 'extra');
    if (kind === 'fifo') assert.equal(spawnSync('mkfifo', [extra]).status, 0);
    if (kind === 'hardlink') linkSync(join(source, 'cli.cjs'), extra);
    if (kind === 'symlink') symlinkSync('cli.cjs', extra);
    const refused = call(); assert.equal(refused.status, 3, `${kind}: ${refused.stderr}`);
    unlinkSync(extra);
  }
  assert.equal(call().status, 0, 'Valid payload still launches after malformed source is corrected');
  console.log('Native launch retains immutable payloads across bundle replacement and rejects retained tampering.');
} finally {
  if (running && running.exitCode === null) { running.kill(); await once(running, 'exit'); }
  const writable = path => { chmodSync(path, 0o700); for (const entry of readdirSync(path, { withFileTypes: true })) if (entry.isDirectory()) writable(join(path, entry.name)); };
  writable(root); rmSync(root, { recursive: true });
}
