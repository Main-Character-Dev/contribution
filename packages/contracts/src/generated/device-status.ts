/* Generated from canonical JSON Schema. Runtime validation remains required. */

export type DeviceStatus = ContributionResponseEnvelopeV1 & {
  requestStatus?: "completed";
  operationId?: null;
  operationState?: null;
  result?: {
    recordMode: "observed" | "fixture";
    repositoryId: string;
    executionHostId: string;
    canonicalHostId: string;
    deviceId: string;
    observedAt: string | null;
    freshness: "fresh" | "stale" | "unknown";
    network: Network;
    host: {
      state: "online" | "offline" | "unavailable" | "unknown";
      tailnet: "ready" | "route_unavailable" | "access_denied" | "offline" | "unknown";
      reasonCodes: string[];
    };
    trust: {
      state: "trusted" | "unpaired" | "verification_failed" | "revoked" | "unknown";
      observedAt: string | null;
      reasonCodes: string[];
    };
    developerService: {
      state:
        "ready" | "unavailable" | "unlock_required" | "developer_mode_required" | "incompatible" | "busy" | "unknown";
      session: "owned" | "external" | "none" | "unknown";
      sessionRef: string | null;
      reasonCodes: string[];
    };
    capabilities: ContributionOperationCapabilityQualificationV1[];
    availability: {
      [k: string]: unknown;
    }[];
    ownership: ContributionPrivateDeviceOwnershipRecordV1;
    unresolvedOperationIds: string[];
    nextActions: {
      id: string;
      label: string;
      /**
       * @minItems 1
       */
      argv: [string, ...string[]];
    }[];
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
export type ContributionOperationCapabilityQualificationV1 = {
  [k: string]: unknown;
} & {
  schemaVersion: 1;
  recordMode: "observed" | "fixture";
  capabilityId: string;
  operation:
    | "connect"
    | "prepare"
    | "install"
    | "launch"
    | "logs"
    | "test"
    | "ui"
    | "debug"
    | "screenshot"
    | "screen_capture"
    | "native_xcode_destination";
  support: "unverified" | "supported" | "unsupported" | "requires_action";
  context: Context;
  qualifiedAt: string | null;
  evidenceIds: string[];
  limitations: string[];
  reasonCodes: string[];
};
export type ContributionPrivateDeviceOwnershipRecordV1 = {
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

export interface Network {
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
}
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
