/* Generated from canonical JSON Schema. Runtime validation remains required. */

export interface DeviceOperation {
  schemaVersion: 1;
  recordMode: "observed" | "fixture";
  operationId: string;
  requestId: string;
  repositoryId: string;
  executionHostId: string;
  deviceId: string;
  intent: {
    operation:
      | "connect"
      | "prepare"
      | "install"
      | "install_and_launch"
      | "launch"
      | "logs"
      | "test"
      | "ui"
      | "debug"
      | "screenshot"
      | "screen_capture"
      | "disconnect"
      | "transfer_host";
    app: {
      bundleId: string;
      teamId: string;
      applicationIdentifier: string;
      marketingVersion: string;
      buildVersion: string;
    };
    artifactRef: {
      artifactId: string;
      sha256: string;
    } | null;
    installedAppRef: string | null;
    sourceCommit: string | null;
    configurationId: string | null;
    adapterId: string;
    policyRevision: string;
    /**
     * @minItems 1
     */
    authorizedOperations: [string, ...string[]];
    mode: "routine" | "qualification";
    qualification: {
      acceptanceId: string;
      planId: string;
      fixtureId: string;
      expectedContextDigest: string;
      /**
       * @minItems 1
       */
      authorizedOperations: [string, ...string[]];
      maxAttempts: number;
      maxDurationSeconds: number;
    } | null;
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
      effectId: string;
      operation:
        | "prepare"
        | "install"
        | "launch"
        | "logs"
        | "test"
        | "ui"
        | "debug"
        | "screenshot"
        | "screen_capture"
        | "connect"
        | "disconnect"
        | "transfer_host";
      state:
        | "not_requested"
        | "queued"
        | "running"
        | "succeeded"
        | "failed"
        | "cancelled"
        | "outcome_unknown"
        | "needs_attention";
      certainty: "not_observed" | "confirmed" | "uncertain";
      startedAt: string | null;
      completedAt: string | null;
      installReadback: {
        deviceId: string;
        bundleId: string;
        teamId: string | null;
        marketingVersion: string;
        buildVersion: string;
        observedAt: string;
        method: string;
      } | null;
      launchReadback: {
        deviceId: string;
        bundleId: string;
        processState: "running" | "foreground" | "not_running" | "unknown";
        processId: number | null;
        observedAt: string;
        method: string;
      } | null;
      evidenceRefs: string[];
      reasonCodes: string[];
      missingProof: string[];
    },
    ...{
      effectId: string;
      operation:
        | "prepare"
        | "install"
        | "launch"
        | "logs"
        | "test"
        | "ui"
        | "debug"
        | "screenshot"
        | "screen_capture"
        | "connect"
        | "disconnect"
        | "transfer_host";
      state:
        | "not_requested"
        | "queued"
        | "running"
        | "succeeded"
        | "failed"
        | "cancelled"
        | "outcome_unknown"
        | "needs_attention";
      certainty: "not_observed" | "confirmed" | "uncertain";
      startedAt: string | null;
      completedAt: string | null;
      installReadback: {
        deviceId: string;
        bundleId: string;
        teamId: string | null;
        marketingVersion: string;
        buildVersion: string;
        observedAt: string;
        method: string;
      } | null;
      launchReadback: {
        deviceId: string;
        bundleId: string;
        processState: "running" | "foreground" | "not_running" | "unknown";
        processId: number | null;
        observedAt: string;
        method: string;
      } | null;
      evidenceRefs: string[];
      reasonCodes: string[];
      missingProof: string[];
    }[]
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
