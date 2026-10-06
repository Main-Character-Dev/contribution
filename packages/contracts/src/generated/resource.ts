/* Generated from canonical JSON Schema. Runtime validation remains required. */

export interface Resource {
  schemaVersion: 1;
  resourceId: string;
  requestId: string;
  operationId: string;
  attemptId: string;
  repositoryId: string;
  hostId: string;
  bootId: string;
  clone: string;
  enrollmentRevision: string;
  parentId: string | null;
  /**
   * @maxItems 64
   */
  dependencies: string[];
  kind: "process" | "server" | "provider" | "simulator" | "service";
  owner: "utility" | "borrowed" | "native" | "user" | "unknown";
  lifetime: "ephemeral" | "borrowed" | "interactive" | "persistent";
  adapter: string;
  adapterVersion: number;
  scope: string;
  token: string;
  generation: number;
  state: "intent" | "allocated" | "active" | "stopping" | "stopped" | "retained" | "unresolved";
  identity: {
    type: "process" | "simulator" | "provider" | "service";
    value: {
      [k: string]: string | number | boolean;
    };
  } | null;
  reason: string;
  stopAction: string;
  deadlineAt: string | null;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  retries: number;
  retryAfter: string | null;
  outcome: {
    [k: string]: unknown;
  } | null;
}
