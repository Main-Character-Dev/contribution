import { assertContract, buildIdentity } from '@contribution/contracts';
import type { Response } from '@contribution/contracts';
import { foundationAvailability } from '@contribution/adapters';

function checked(value: Response): Response {
  assertContract('response', value);
  return value;
}
export function versionResponse(): Response {
  return checked({ schemaVersion: 1, requestStatus: 'completed', operationId: null,
    operationState: null, result: { ...buildIdentity, interfaceVersion: buildIdentity.version,
      engineVersion: buildIdentity.version, supportedSchemaVersions: [1],
      compatibility: 'development_only', service: 'not_installed' }, error: null });
}
export function unavailableResponse(): Response {
  return checked({ schemaVersion: 1, requestStatus: 'rejected', operationId: null,
    operationState: null, result: { availability: foundationAvailability }, error: {
      code: 'SERVICE_NOT_INSTALLED', message: 'The S0 development shell has no installed service. Product operations are unavailable.',
      retryable: false, nextActions: [{ id: 'help', label: 'Show available development commands', argv: ['contribution', 'help'] }],
    } });
}
export function usageResponse(message: string): Response {
  return checked({ schemaVersion: 1, requestStatus: 'rejected', operationId: null,
    operationState: null, result: null, error: { code: 'INVALID_USAGE', message,
      retryable: false, nextActions: [{ id: 'help', label: 'Show help', argv: ['contribution', 'help'] }] } });
}
export function helpResponse(): Response {
  return checked({ schemaVersion: 1, requestStatus: 'completed', operationId: null,
    operationState: null, error: null, result: {
      commands: ['help [--json]', 'version [--json]', 'service status [--json]'],
      availability: 'S0 development only. Repository, service installation, device and update operations are unavailable.',
    } });
}
