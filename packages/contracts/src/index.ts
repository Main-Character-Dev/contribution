import { readFileSync, readdirSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { AnySchema, ValidateFunction } from 'ajv';

export type { Response } from './generated/response.js';
export type { Repository } from './generated/repository.js';
export type { Machine } from './generated/machine.js';
export type { DeviceCapability, Context as DeviceContext } from './generated/device-capability.js';
export type { DeviceOwnership } from './generated/device-ownership.js';
export type { DeviceOperation } from './generated/device-operation.js';
export type { DeviceTestEvidence } from './generated/device-test-evidence.js';
export type { ArtifactProvenance } from './generated/artifact-provenance.js';
export { buildIdentity } from './generated/version.js';

const directory = new URL('../schemas/', import.meta.url);
// Conditionals use properties without type/required locally; the enclosing schema
// supplies those. These lint options do not disable any validation keywords.
const ajv = new Ajv2020.default({ strict: true, strictTypes: false, strictRequired: false, allErrors: true });
addFormats.default(ajv);
const schemas = readdirSync(directory).filter(name => name.endsWith('.schema.json')).sort();
for (const name of schemas) {
  ajv.addSchema(JSON.parse(readFileSync(new URL(name, directory), 'utf8')) as AnySchema);
}
const validators = new Map<string, ValidateFunction>();
for (const name of schemas) {
  const schema = JSON.parse(readFileSync(new URL(name, directory), 'utf8')) as { $id: string };
  const validate = ajv.getSchema(schema.$id);
  if (!validate) throw new Error(`Missing local schema: ${schema.$id}`);
  validators.set(name.replace('.schema.json', ''), validate);
}
export const schemaNames: readonly string[] = [...validators.keys()];

const formatValidators = new Map(['date-time', 'uuid', 'uri'].map(format =>
  [format, ajv.compile({ type: 'string', format })] as const));
export function validateContractFormat(format: 'date-time' | 'uuid' | 'uri', value: unknown): boolean {
  const validate = formatValidators.get(format);
  if (!validate) throw new Error(`Unknown contract format: ${format}`);
  return validate(value);
}

export function validateContract(name: string, value: unknown): { valid: boolean; errors: string[] } {
  const validate = validators.get(name);
  if (!validate) throw new Error(`Unknown local contract: ${name}`);
  const valid = validate(value);
  return { valid, errors: (validate.errors ?? []).map(error => `${error.instancePath}: ${error.message}`) };
}

export function assertContract(name: string, value: unknown): void {
  const result = validateContract(name, value);
  if (!result.valid) throw new Error(`Invalid ${name}: ${result.errors.join('; ')}`);
}
