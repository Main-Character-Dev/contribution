import { createHash, randomUUID } from 'node:crypto';
import { assertContract } from '@contribution/contracts';
import type { Response } from '@contribution/contracts';

export type ObjectValue = Record<string, unknown>;
export type State = NonNullable<Response['operationState']>;
export const terminal = new Set<State>(['succeeded', 'failed', 'cancelled', 'interrupted', 'outcome_unknown', 'needs_attention']);
export const isGitJob = (kind: string): boolean => !['device', 'remote.device', 'artifact_transfer', 'device_transfer'].includes(kind);
export class Fault extends Error {
  constructor(readonly code: string, message: string, readonly exit = 4, readonly details: ObjectValue = {}, readonly retryable = false) { super(message); }
}
export function requireValue(condition: unknown, code: string, message: string, exit = 4): asserts condition {
  if (!condition) throw new Fault(code, message, exit);
}
export function object(value: unknown): ObjectValue {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), 'INVALID_REQUEST', 'Expected a JSON object.', 2);
  return value as ObjectValue;
}
export function string(value: unknown, name: string): string {
  requireValue(typeof value === 'string' && value.length > 0 && value.length <= 8192 && !value.includes('\0'), 'INVALID_REQUEST', `${name} must be a nonempty bounded string.`, 2);
  return value;
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  return JSON.stringify(value) ?? 'null';
}
export const digest = (value: unknown): string => createHash('sha256').update(value instanceof Uint8Array ? value : canonical(value)).digest('hex');
export const now = (): string => new Date().toISOString();
export const id = (): string => randomUUID();
export function completed(result: ObjectValue = {}): Response {
  const response: Response = { schemaVersion: 1, requestStatus: 'completed', operationId: null, operationState: null, result, error: null };
  assertContract('response', response); return response;
}
export function rejected(error: unknown): Response {
  const fault = error instanceof Fault ? error : new Fault('INTERNAL_ERROR', 'The operation could not complete. Inspect the retained service diagnostics.', 5);
  return { schemaVersion: 1, requestStatus: 'rejected', operationId: null, operationState: null,
    result: { ...fault.details, exitCode: fault.exit }, error: { code: fault.code, message: fault.message, retryable: fault.retryable,
      nextActions: [{ id: 'doctor', label: 'Inspect readiness', argv: ['contribution', 'doctor', '--json'] }] } };
}
export function redact(text: string): string {
  return text.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/g, '[redacted]')
    .replace(/(authorization\s*[:=]\s*(?:bearer|token)\s+)\S+/gi, '$1[redacted]')
    .replace(/((?:password|access_token|auth_token|secret)\s*[=:]\s*)[^\s&]+/gi, '$1[redacted]');
}
