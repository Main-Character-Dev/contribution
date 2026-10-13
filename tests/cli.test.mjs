import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertContract } from '../packages/contracts/dist/index.js';
import { invoke } from './integration/cli.mjs';
import { randomUUID } from 'node:crypto';
import { Journal } from '../packages/engine/dist/journal.js';
import { Engine } from '../packages/engine/dist/service.js';
import { ResourceLifecycle } from '../packages/engine/dist/resource-lifecycle.js';
import { listen } from '../packages/engine/dist/ipc.js';
import { runCommand } from '../packages/cli/dist/client.js';
import { drainEngines } from './fixtures/lifecycle.mjs';

test('CLI preserves resource UUID cursors across authenticated IPC and keeps event cursors numeric', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ct-cli-cursor-')), store = new Journal(root), lifecycle = new ResourceLifecycle(store, undefined, () => 'fixture-boot');
  const owner = lifecycle.beginHost({ requestId: randomUUID(), kind: 'process', owner: 'utility', lifetime: 'ephemeral', adapter: 'fixture', adapterVersion: 1, scope: 'fixture', reason: 'fixture', stopAction: 'fixture' });
  const stopped = lifecycle.finish(owner, {}, true);
  store.transaction(() => { for (let i = 0; i < 201; i++) { const resourceId = randomUUID(); store.put('resource', resourceId, { ...stopped, resourceId, requestId: randomUUID() }); } });
  const engine = new Engine(store, { identity: 'fixture', node: process.execPath, cli: 'unused' }), server = await listen(engine);
  const call = async argv => { let output = ''; const code = await runCommand(['--json', ...argv, '--state-dir', root], text => { output += text; }); return { code, response: JSON.parse(output) }; };
  try {
    const first = await call(['service','resources']); assert.equal(first.code, 0); assert.equal(first.response.result.resources.length, 200);
    const next = await call(['service','resources','--after',first.response.result.nextCursor]); assert.equal(next.code, 0); assert.equal(next.response.result.resources.length, 2);
    assert(!next.response.result.resources.some(row => first.response.result.resources.some(previous => previous.resourceId === row.resourceId)));
    assert.equal((await call(['service','resources','--after','bad-cursor'])).response.error.code, 'INVALID_CURSOR');
    assert.equal((await call(['runs','events','--after','0'])).code, 0);
  } finally { await drainEngines(engine); await new Promise(resolve => server.close(resolve)); store.close(); rmSync(root, { recursive: true }); }
});

test('CLI version reports the canonical development identity as one JSON document', () => {
  const result = invoke(['version', '--json']);
  assert.equal(result.status, 0); assert.equal(result.stderr, '');
  const value = JSON.parse(result.stdout); assertContract('response', value);
  const identity = JSON.parse(readFileSync(new URL('../version.json', import.meta.url)));
  for (const [key, expected] of Object.entries(identity)) assert.equal(value.result[key], expected);
  assert.equal(value.result.compatibility, 'development_only');
});
test('help is honest about implemented commands and unavailability', () => {
  const result = invoke(['--help']); assert.equal(result.status, 0);
  assert.match(result.stdout, /service status/); assert.match(result.stdout, /qualification/);
  const json = invoke(['help', '--json']); assertContract('response', JSON.parse(json.stdout));
});
test('unavailable commands cannot mutate a caller directory or accept work', () => {
  const dir = mkdtempSync(join(tmpdir(), 'contribution-s0-'));
  writeFileSync(join(dir, 'sentinel.txt'), 'owned fixture');
  try {
    for (const args of [['service','status'], ['service','install'], ['submit','--request-id','fixture'],
      ['push','--preview'], ['repos','create', join(dir,'repo')], ['devices','install'], ['update','apply']]) {
      const result = invoke([...args, '--json'], dir);
      assert.equal(result.status, 3); assert.equal(result.stderr, '');
      const response = JSON.parse(result.stdout); assertContract('response', response);
      assert.equal(response.requestStatus, 'rejected'); assert.equal(response.operationId, null);
      assert.equal(response.error.code, 'SERVICE_NOT_INSTALLED');
    }
    assert.deepEqual(readdirSync(dir), ['sentinel.txt']);
    assert.equal(readFileSync(join(dir, 'sentinel.txt'), 'utf8'), 'owned fixture');
  } finally { rmSync(dir, { recursive: true }); } // Only this test's reproducible fixture.
});
test('unknown or malformed commands return structured usage failure', () => {
  for (const args of [['unknown'], ['version','unexpected'], ['--jsonl']]) {
    const result = invoke([...args, '--json']); assert.equal(result.status, 2);
    const response = JSON.parse(result.stdout); assertContract('response', response);
    assert.equal(response.error.code, 'INVALID_USAGE');
  }
});
