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
}
export interface App {
  bundleId: string;
  teamId: string;
  applicationIdentifier: string;
  marketingVersion: string;
  buildVersion: string;
}
