/* Generated from canonical JSON Schema. Runtime validation remains required. */

export interface Connectivity {
  schemaVersion: 1;
  targetKind: "contribution-peer" | "git-remote";
  targetId: string;
  endpointRevision: string;
  generation: number;
  state: "unknown" | "checking" | "ready" | "unavailable" | "requires_action";
  freshness: "fresh" | "stale" | "unknown";
  observedAt: string | null;
  lastSuccessAt: string | null;
  reasonCode: string;
  stage:
    | "configuration"
    | "resolution"
    | "connection"
    | "trust"
    | "authentication"
    | "helper"
    | "protocol"
    | "identity"
    | "operation"
    | "none";
  retryable: boolean;
  confidence: "observed" | "inferred" | "unknown";
  source: "ssh" | "helper" | "git" | "service";
  helper: "unknown" | "available" | "unavailable" | "incompatible" | "not_applicable";
  failures: number;
  nextRetryAt: string | null;
  /**
   * @maxItems 4
   */
  actions:
    | []
    | ["retry" | "diagnostics" | "connection_settings" | "verify_host" | "update_peer" | "reconcile"]
    | [
        "retry" | "diagnostics" | "connection_settings" | "verify_host" | "update_peer" | "reconcile",
        "retry" | "diagnostics" | "connection_settings" | "verify_host" | "update_peer" | "reconcile"
      ]
    | [
        "retry" | "diagnostics" | "connection_settings" | "verify_host" | "update_peer" | "reconcile",
        "retry" | "diagnostics" | "connection_settings" | "verify_host" | "update_peer" | "reconcile",
        "retry" | "diagnostics" | "connection_settings" | "verify_host" | "update_peer" | "reconcile"
      ]
    | [
        "retry" | "diagnostics" | "connection_settings" | "verify_host" | "update_peer" | "reconcile",
        "retry" | "diagnostics" | "connection_settings" | "verify_host" | "update_peer" | "reconcile",
        "retry" | "diagnostics" | "connection_settings" | "verify_host" | "update_peer" | "reconcile",
        "retry" | "diagnostics" | "connection_settings" | "verify_host" | "update_peer" | "reconcile"
      ];
  /**
   * @maxItems 16
   */
  capabilities:
    | []
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string]
    | [string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string, string, string]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ];
  provider: {
    status: "unknown" | "unavailable" | "skipped" | "not_applicable" | "observed";
    client: "unknown" | "running" | "stopped" | "login_required";
    target: "unknown" | "visible" | "absent" | "reachable";
    path: "unknown" | "direct" | "relay";
  };
}
