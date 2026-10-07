# Read-only D0 preparation

Historical setup scope or dated inventory. Retained for provenance; this is not the current assignment or proof of installed acceptance. See [current implementation](IMPLEMENTATION_STATUS.md), [storage retention](STORAGE_RETENTION.md), and [journal compatibility](UPDATE_LIFECYCLE.md#journal-compatibility-and-rollback).

Observed on 2026-10-04, America/New_York. This is the current local development host, not an assumed identity for either canonical product host. No pairing, host enrollment, credential import, network change, phone operation or backend installation was performed.

| Observation | Method | Result |
|---|---|---|
| CPU | `uname -m` | arm64 |
| OS | `sw_vers` | macOS 27.0.1, build 26A434 |
| Model | `sysctl -n hw.model` | Unavailable in the execution sandbox; unknown |
| Selected developer directory | `xcode-select -p` | `/Applications/Xcode.app/Contents/Developer` |
| Xcode | `xcodebuild -version` | 27.0, build 27A266a |
| Swift | `swift --version` | 6.4, swiftlang-6.4.0.34.1, clang-2100.3.34.1 |
| SDKs | `xcodebuild -showsdks` | macOS/iOS/iOS Simulator/tvOS/watchOS/visionOS/DriverKit 27.0; availability only |
| Native device tools | `xcrun --find devicectl`, `xcrun --find xctrace` | Both resolve in selected Xcode; neither was dispatched |
| Ambient Node/pnpm | `node --version`, `pnpm --version` | 24.19.0 / 11.23.0; no global changes |
| Contribution scoped Node/pnpm | Bootstrap and executable version checks | 24.21.0 / 11.23.0 |
| Git | `git --version` | 2.56.0 |
| SSH | `ssh -V` | OpenSSH 10.3p1, LibreSSL 3.3.6; no connections attempted |
| Python | `python3 --version` | 3.14.8 |
| Tailscale/go-ios command availability | PATH lookup only | `tailscale`, `ios`, `go-ios` absent on PATH; app or other installations not inventoried |
| Screen capture | `CGPreflightScreenCaptureAccess`, no request | False; no screenshots or new permissions requested |
| Service | S0 code boundary | No Contribution service exists or is registered by setup |

## Dependency and privilege decision

Keep native Xcode/CoreDevice as the local baseline. Inspect and pin a go-ios revision before any future prototype or packaging. The [upstream README](https://github.com/danielpaulus/go-ios) and [MIT license](https://github.com/danielpaulus/go-ios/blob/main/LICENSE) were reviewed as candidate information on this date. Its quick-start includes a privileged tunnel daemon. It does not prove Contribution's remote route or remove the need to review an exact revision, transitive licenses, userspace versus kernel path, remoted coexistence, endpoint authentication, resource ownership and removal boundary. No global npm install or tunnel command was run. No backend enters this workspace's dependency graph in S0.

The native Swift boundary remains a client/platform boundary. It must not become an alternate scheduler or a generic root executor. Backend candidate APIs stay private behind future scoped service dispatch. App deployment at macOS 14.0 does not qualify an Xcode/iOS/backend combination.

## Exact remaining prerequisites

Before dependent D0/D1 proof, obtain the owner's approved inventory for both actual Macs: models, OS/builds, selected Xcode/SDKs, user sessions, independently provisioned signing/profile validity, awake/FileVault/Keychain state, approved SSH/Tailscale access and device operation ownership. Keep real IDs, addresses, account/team details and private evidence outside Git.

Obtain the approved iPhone model/OS/build and physical identity, Developer Mode/unlock/trust state, independent pairing on both hosts, existing sessions, and permitted bootstrap method. Select an approved meaningful fixture app with persisted records, draft/configuration and Keychain values, signed update authority, expected identity/version, and retention observations. Resolve the exact backend revision and bounded qualification plan before dispatch.

Resolve the actual phone-only travel caller. Prefer a supported remote agent route if one is available; otherwise retain the narrow authenticated browser endpoint in the same service for RDEV-26. No route is selected or tested in S0. Schedule owner-assisted network switching and separate remote Wi-Fi, warm cellular, fresh cellular, phone restart and host restart proofs only after M1 journal/authorization/dispatch prerequisites. Record install, launch, logs, native tests, UI and debugging separately.

Release prerequisites remain Developer ID/notarization/update signing and an approved immutable payload identity. These are unnecessary for the unsigned S0 build. Core release, fixture proof, one-Mac shell proof, two-Mac proof and operation-specific physical evidence remain separate.
