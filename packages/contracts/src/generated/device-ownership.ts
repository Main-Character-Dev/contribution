/* Generated from canonical JSON Schema. Runtime validation remains required. */

export type DeviceOwnership = {
  [k: string]: unknown;
} & {
  schemaVersion: 1;
  recordMode: "observed" | "fixture";
  ownershipId: string;
  deviceId: string;
  ownerHostId: string | null;
  selectedHostId: string;
  previousHostId: string | null;
  state: "unowned" | "owned" | "transfer_pending" | "previous_owner_unconfirmed" | "busy_external" | "blocked";
  mutationsPermitted: boolean;
  revision: string;
  activeOperationIds: string[];
  leaseExpiresAt: string | null;
  priorSession: "none" | "released" | "active" | "unknown";
  releaseReceiptRef: string | null;
  recoveryEvidenceRefs: string[];
  externalSession: "absent" | "present" | "unknown";
  observedAt: string | null;
  reasonCodes: string[];
};
