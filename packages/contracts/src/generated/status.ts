/* Generated from canonical JSON Schema. Runtime validation remains required. */

export type Status = ContributionResponseEnvelopeV1 & {
  requestStatus?: "completed";
  operationId?: null;
  operationState?: null;
  result?: {
    repositoryId: string;
    canonicalHostId: string;
    canonicalBranch: string;
    canonicalTip: string | null;
    publication: {
      remote: string | null;
      branch: string | null;
      remoteTip: string | null;
      relation: "equal" | "ahead" | "behind" | "diverged" | "unpublished" | "unconfigured" | "unknown";
      ahead: number | null;
      behind: number | null;
      observedAt: string | null;
      freshness: "fresh" | "stale" | "unknown";
      action: "none" | "push" | "publish" | "configure" | "reconcile" | "refresh";
      enabled: boolean;
      blockedReason: string | null;
      [k: string]: unknown;
    };
    pending: {
      localSubmissions: number;
      landingJobs: number;
      dirtyWorktrees: number;
      [k: string]: unknown;
    };
    [k: string]: unknown;
  };
  error?: null;
  [k: string]: unknown;
};
export type ContributionResponseEnvelopeV1 = {
  [k: string]: unknown;
} & {
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
};
