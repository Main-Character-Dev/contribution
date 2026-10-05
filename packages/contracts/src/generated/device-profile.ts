/* Generated from canonical JSON Schema. Runtime validation remains required. */

export interface DeviceProfile {
  schemaVersion: 1;
  repositoryId: string;
  adapterId: "xcode-ios-v1";
  app: App;
  permitsForeground: boolean;
  /**
   * @minItems 1
   * @maxItems 32
   */
  eligibleDeviceRefs: [string, ...string[]];
  /**
   * @minItems 1
   * @maxItems 10
   */
  builds:
    | [
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        }
      ]
    | [
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        },
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        }
      ]
    | [
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        },
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        },
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        }
      ]
    | [
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        },
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        },
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        },
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        }
      ]
    | [
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        },
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        },
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        },
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        },
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        }
      ]
    | [
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        },
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        },
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        },
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        },
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        },
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        }
      ]
    | [
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        },
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        },
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        },
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        },
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        },
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        },
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        }
      ]
    | [
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        },
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        },
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        },
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        },
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        },
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        },
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        },
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        }
      ]
    | [
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        },
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        },
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        },
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        },
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        },
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        },
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        },
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        },
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        }
      ]
    | [
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        },
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        },
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        },
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        },
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        },
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        },
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        },
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        },
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        },
        {
          id: string;
          containerKind: "project" | "workspace";
          containerPath: string;
          scheme: string;
          configuration: string;
          appName: string;
          developerDirectory: string;
          xcodeVersion: string;
          xcodeBuild: string;
          signingMode: "development" | "ad_hoc";
          provisioningProfileSpecifier: string;
          timeoutSeconds: number;
        }
      ];
  /**
   * @maxItems 32
   */
  qualificationPlans?: {
    id: string;
    operation:
      | "connect"
      | "install"
      | "launch"
      | "logs"
      | "test"
      | "ui"
      | "debug"
      | "screenshot"
      | "screen_capture"
      | "native_xcode_destination";
    fixtureId: string;
    acceptanceId: string;
    expectedContext: Context;
    maxAttempts: number;
    maxDurationSeconds: number;
  }[];
}
export interface App {
  bundleId: string;
  teamId: string;
  applicationIdentifier: string;
  marketingVersion: string;
  buildVersion: string;
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
