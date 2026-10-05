/* Generated from canonical JSON Schema. Runtime validation remains required. */

export type DeviceOperation = {
  [k: string]: unknown;
} & {
  schemaVersion: 1;
  recordMode: "observed" | "fixture";
  operationId: string;
  requestId: string;
  repositoryId: string;
  executionHostId: string;
  deviceId: string;
  intent: {
    [k: string]: unknown;
  };
  context: Context;
  capabilityIds: string[];
  ownershipId: string;
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  operationState:
    | "queued_local"
    | "queued"
    | "waiting"
    | "running"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "interrupted"
    | "outcome_unknown"
    | "needs_attention";
  stage: string;
  resultCertainty: "not_observed" | "confirmed" | "uncertain";
  /**
   * @minItems 1
   */
  effects: [
    {
      [k: string]: unknown;
    } & {
      [k: string]: unknown;
    } & {
      [k: string]: unknown;
    },
    ...({
      [k: string]: unknown;
    } & {
      [k: string]: unknown;
    } & {
      [k: string]: unknown;
    })[]
  ];
  reconciliation: {
    status: "not_required" | "required" | "in_progress" | "resolved" | "blocked";
    attempts: number;
    lastObservedAt: string | null;
    nextObservation: string | null;
  };
  logRefs: string[];
  reasonCodes: string[];
  missingProof: string[];
};

export interface Context {
  host: {
    hostId: string;
    model: string | null;
    architecture: "arm64" | "x86_64" | "unknown";
    macOSVersion: string | null;
    macOSBuild: string | null;
    xcodeVersion: string | null;
    xcodeBuild: string | null;
  };
  device: {
    deviceId: string;
    model: string | null;
    iOSVersion: string | null;
    iOSBuild: string | null;
  };
  tailscale: {
    hostVersion: string | null;
    deviceVersion: string | null;
  };
  backend: {
    id: "coredevice" | "go-ios" | "pymobiledevice3-research" | "private-ota" | "bridge-research";
    version: string | null;
    revision: string | null;
  };
  engineVersion: string | null;
  network: {
    scenario:
      | "same_lan_wifi"
      | "remote_wifi"
      | "isolated_guest_wifi"
      | "warm_cellular"
      | "cold_cellular"
      | "tethered"
      | "mixed"
      | "unknown";
    hostUnderlay: "ethernet" | "wifi" | "cellular_tether" | "unknown";
    phoneUnderlay: "wifi" | "cellular" | "unknown";
    tailnetPath: "direct" | "relay" | "unknown";
    developerSession: "fresh" | "existing" | "none" | "unknown";
    internetState: "ready" | "captive_portal" | "offline" | "unknown";
  };
  signingMode: "development" | "ad_hoc" | "not_applicable" | "unknown";
  bootstrapMethod: "existing" | "wireless" | "usb" | "unknown";
}
