/* Generated from canonical JSON Schema. Runtime validation remains required. */

export interface Event {
  schemaVersion: 1;
  eventId: string;
  originHostId: string;
  sequence: number;
  operationId: string;
  repositoryId: string;
  occurredAt: string;
  type: string;
  payload: {
    [k: string]: unknown;
  };
  [k: string]: unknown;
}
