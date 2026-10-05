/* Generated from canonical JSON Schema. Runtime validation remains required. */

export interface Response {
  schemaVersion: 1;
  requestStatus: "completed" | "accepted" | "rejected";
  operationId: string | null;
  operationState:
    | (
        | "queued_local"
        | "queued"
        | "waiting"
        | "running"
        | "succeeded"
        | "failed"
        | "cancelled"
        | "interrupted"
        | "outcome_unknown"
        | "needs_attention"
      )
    | null;
  result: {
    [k: string]: unknown;
  } | null;
  error: {
    code: string;
    message: string;
    retryable: boolean;
    nextActions: {
      id: string;
      label: string;
      /**
       * @minItems 1
       */
      argv: [string, ...string[]];
      [k: string]: unknown;
    }[];
    [k: string]: unknown;
  } | null;
  [k: string]: unknown;
}
