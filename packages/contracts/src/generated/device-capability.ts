/* Generated from canonical JSON Schema. Runtime validation remains required. */

export type DeviceCapability = {
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
