/* Generated from canonical JSON Schema. Runtime validation remains required. */

export interface Machine {
  schemaVersion: 1;
  hostId: string;
  label: string;
  role: "primary" | "companion" | "standalone";
  primaryHostId: string;
  primarySshAlias: string | null;
  projectRoots: string[];
  repositories: {
    repositoryId: string;
    path: string;
    availability: "this-mac" | "both-macs";
  }[];
  notifications: {
    preferredHostId: string;
    success: boolean;
    failure: boolean;
  };
  retention: {
    rawLogDays: number;
    summaryDays: number;
    maxLogBytes: number;
  };
  /**
   * Optional private local source checkout registration. Never a runtime executable source.
   */
  contributionSourcePath?: string | null;
  /**
   * Optional private per-host module settings. Absence disables Remote Devices. Neither setting grants a device operation.
   */
  remoteDevices?: {
    enabled: boolean;
    maintainSession: boolean;
  };
}
