import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { compile } from 'json-schema-to-typescript';
import { projectForTypes } from '../scripts/schema-projection.mjs';

test('structural allOf keeps ordinary sibling properties, nullable arrays and enum refinements', async () => {
  const schema = { type: 'object', properties: { entry: {
    type: 'object', properties: {
      mode: { enum: ['ready', 'waiting'] },
      readbacks: { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
    }, required: ['mode', 'readbacks'], additionalProperties: false,
    allOf: [{ properties: { mode: { const: 'ready' } }, required: ['mode'] },
      { if: { properties: { mode: { const: 'ready' } } }, then: { properties: { readbacks: { minItems: 1 } } } }],
  } }, required: ['entry'], additionalProperties: false };
  const original = JSON.stringify(schema);
  const projected = projectForTypes(schema, new Map());
  assert.equal(JSON.stringify(schema), original, 'Canonical input must remain untouched');
  const output = await compile(projected, 'Fixture', { unknownAny: true });
  const dir = mkdtempSync(join(tmpdir(), 'contribution-projection-'));
  const file = join(dir, 'fixture.ts');
  try {
    writeFileSync(file, output + `
const valid: Fixture = { entry: { mode: 'ready', readbacks: ['fixture', null] } };
const readbacks: (string | null)[] = valid.entry.readbacks;
// @ts-expect-error ordinary sibling requiredness survives the intersection
const missing: Fixture = { entry: { mode: 'ready' } };
// @ts-expect-error the unconditional allOf branch still refines the enum
const mode: Fixture = { entry: { mode: 'waiting', readbacks: [] } };
// @ts-expect-error nullable array elements still reject numeric entries
const item: Fixture = { entry: { mode: 'ready', readbacks: [42] } };
// @ts-expect-error a nullable array element does not make the array nullable
const array: Fixture = { entry: { mode: 'ready', readbacks: null } };
void [valid, readbacks, missing, mode, item, array];
`);
    const program = ts.createProgram([file], { strict: true, noEmit: true, types: [], target: ts.ScriptTarget.ES2023 });
    const diagnostics = ts.getPreEmitDiagnostics(program);
    assert.equal(diagnostics.length, 0, ts.formatDiagnostics(diagnostics, {
      getCanonicalFileName: name => name, getCurrentDirectory: () => dir, getNewLine: () => '\n',
    }));
  } finally { rmSync(dir, { recursive: true }); } // Only the test-created compiler fixture.
});

test('mixed conditional/structural branches fail rather than lose unsupported fields', () => {
  assert.throws(() => projectForTypes({ allOf: [{ if: {}, then: {}, properties: { requiredField: { type: 'string' } } }] },
    new Map()), /Unsupported mixed conditional projection/);
});

test('projection retains local URN resolution and rejects unknown references', () => {
  assert.deepEqual(projectForTypes({ $ref: 'urn:fixture#/$defs/entry' }, new Map([['urn:fixture', '/fixture/schema.json']])),
    { $ref: '/fixture/schema.json#/$defs/entry' });
  assert.throws(() => projectForTypes({ $ref: 'urn:unknown' }, new Map()), /Unknown schema URN/);
});
