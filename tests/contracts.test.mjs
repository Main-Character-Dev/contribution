import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { schemaNames, validateContract, validateContractFormat } from '../packages/contracts/dist/index.js';
import { example, exampleSchemas, negativeCases } from './fixtures/contracts.mjs';

test('all twelve schemas compile with local references', () => {
  assert.equal(schemaNames.length, 12);
});
test('all fourteen examples are covered by schema validation', () => {
  const files = readdirSync(new URL('../packages/contracts/examples/', import.meta.url)).filter(n => n.endsWith('.json'));
  assert.deepEqual(files.sort(), Object.keys(exampleSchemas).map(n => n + '.json').sort());
  assert.equal(files.length, 14);
  for (const [name, schema] of Object.entries(exampleSchemas)) {
    const result = validateContract(schema, example(name));
    assert.equal(result.valid, true, `${name}: ${result.errors.join('; ')}`);
  }
});
for (const { name, schema, value } of negativeCases()) {
  test(`reject ${name}`, () => {
    assert.equal(validateContract(schema, value).valid, false, `${schema} accepted unsafe shape`);
  });
}
test('unknown schema cannot fall back to permissive validation', () => {
  assert.throws(() => validateContract('remote-external-schema', {}), /Unknown local contract/);
});
test('format checking covers URI, UUID and real calendar dates', () => {
  for (const [format, valid, invalid] of [
    ['uri', 'https://example.invalid/artifact', 'not a uri'],
    ['uuid', '33a1b940-f11d-4d6b-a1a6-4019d7536c68', 'not-a-uuid'],
    ['date-time', '2026-10-04T23:00:00Z', '2026-02-30T00:00:00Z'],
  ]) {
    assert.equal(validateContractFormat(format, valid), true);
    assert.equal(validateContractFormat(format, invalid), false);
  }
});
