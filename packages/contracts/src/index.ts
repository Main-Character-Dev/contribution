import type { ValidateFunction } from 'ajv';
import * as generated from './validators.generated.js';

export type { Connectivity } from './generated/connectivity.js';
export type { Response } from './generated/response.js';
export type { Repository } from './generated/repository.js';
export type { Resource } from './generated/resource.js';
export type { ResourcePolicy } from './generated/resource-policy.js';
export type { StoragePolicy } from './generated/storage-policy.js';
export type { PowerPolicy } from './generated/power-policy.js';
export type { Machine } from './generated/machine.js';
export type { DeviceCapability, Context as DeviceContext } from './generated/device-capability.js';
export type { DeviceOwnership } from './generated/device-ownership.js';
export type { DeviceOperation } from './generated/device-operation.js';
export type { DeviceTestEvidence } from './generated/device-test-evidence.js';
export type { DeviceProfile as DeviceProfileConfiguration } from './generated/device-profile.js';
export type { ArtifactProvenance } from './generated/artifact-provenance.js';
export { buildIdentity } from './generated/version.js';

const functions = generated as unknown as Record<string, ValidateFunction>;
export const schemaNames: readonly string[] = generated.contractNames;
const validators = new Map(schemaNames.map((name, index) => [name, functions['contract' + index]!]));
const formatValidators = new Map(['date-time', 'uuid', 'uri'].map(format =>
  [format, functions['format_' + format.replace('-', '_')]!] as const));
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
