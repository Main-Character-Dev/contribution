import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertContract } from '../packages/contracts/dist/index.js';
import { invoke } from './integration/cli.mjs';

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
