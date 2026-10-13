import { assertContract, buildIdentity } from '@contribution/contracts';
import type { Response } from '@contribution/contracts';

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
