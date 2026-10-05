# Sources and decisions

This is the sanitized source register for the maintained requirements. The original private audit and migration details remain outside Git. See [provenance](../SOURCE_PACKAGE.md), the [review amendments](../REQUIREMENTS_REVIEW.md), and the [architecture decisions](../ARCHITECTURE.md).

## Settled product decisions

Contribution is a native SwiftUI Mac app with menu-bar access, a stable CLI, one managed user service, and a bundled versioned engine/runtime. Preserve proven JavaScript mechanics behind typed adapters. UI and agents share operations, evidence and reason codes.

Paired repositories have one Mini canonical owner; standalone/local-only repositories use their local owner. Intentionally submitted commits transfer durably through SSH over Tailscale. Uncommitted directories and private state do not sync. Push remains explicit and bound to source, destination and policy. Gate outcome, transport, CI and merge readiness remain distinct.

New projects use Local development. Existing profiles, activation, hook ownership, attribution, checks and runtime pins remain intact. Registry synchronization uses stable project identity and host-local paths. Native Codex owns its chat and worktree lifecycle. Opening a workspace does not establish persistent saved-project registration; an unsupported integration gets an accurate manual fallback.

Installed releases are independent of source changes. Updates preserve queued work and compatibility while active attempts keep their immutable payload. The existing MIT license remains; third-party obligations and code provenance remain separately owned. Source publication and distribution are not implicit actions.

Remote Devices uses the same service and journal. Either independently approved Mac can build or operate the phone without changing Git authority. Native Apple tooling is the baseline; pinned go-ios is the first remote prototype candidate. No permanent custom iOS client is required by default. Cold cellular, restart recovery, installation, launch, logs, tests, UI and debugging require distinct evidence. OTA is separately qualified and cannot close unproven developer-session requirements.

## Platform source index

| Primary source | Use and qualification boundary |
|---|---|
| [Git bundle](https://git-scm.com/docs/git-bundle) | Committed-object transfer, prerequisite verification and fetch; no working-directory sync |
| [Git hooks](https://git-scm.com/docs/githooks) | Preserve ref stdin and pre-push exits; hooks alone do not prove final delivery |
| [Git worktree](https://git-scm.com/docs/git-worktree) | Repository/worktree identity and supported lifecycle |
| [SSH over Tailscale](https://tailscale.com/docs/reference/ssh-over-tailscale) | Private network route for normal authenticated SSH; do not assume Tailscale SSH server mode |
| [SMAppService](https://developer.apple.com/documentation/servicemanagement/smappservice) | App-owned registration; actual login/session behavior needs Mac evidence |
| [Apple background items](https://developer.apple.com/videos/play/wwdc2022/10096/) | Platform lifecycle design and user-visible controls |
| [SQLite WAL](https://www.sqlite.org/wal.html) | Local-host journal storage and durability choices |
| [Sparkle documentation](https://sparkle-project.org/documentation/) and [updater delegate](https://sparkle-project.org/documentation/api-reference/Protocols/SPUUpdaterDelegate.html) | Signed release integration and every enabled install-path maintenance window |
| [Node releases](https://nodejs.org/en/about/previous-releases) | Select supported LTS and pin the exact bundled runtime |
| [GitHub required checks](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks) | Required policy and current commit associations |
| [GitHub workflow jobs](https://docs.github.com/en/rest/actions/workflow-jobs) | Structured job observations and available logs; no invented live log stream |
| [go-ios](https://github.com/danielpaulus/go-ios) and [license](https://github.com/danielpaulus/go-ios/blob/main/LICENSE) | Candidate operations and dependency review; prove actual transport and privilege requirements before adoption |
| [Tailscale mDNS issue](https://github.com/tailscale/tailscale/issues/1013) | Discovery gap; IP reachability alone is insufficient |
| [Apple Device Hub](https://developer.apple.com/documentation/xcode/managing-your-simulated-and-physical-devices-in-device-hub) | Native baseline; verify installed-version documentation before assuming newer pairing features |
| [Apple ad hoc profiles](https://developer.apple.com/help/account/provisioning-profiles/create-an-ad-hoc-provisioning-profile/) | Candidate authorized signing mode; does not activate distribution |
| [Apple OTA export](https://help.apple.com/xcode/mac/current/en.lproj/devde46df08a.html) | Manifest/package candidate; qualify installer access, identity, retention and readback |
| [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve) | Private HTTPS candidate; browser access does not prove system-installer access |
| [pymobiledevice3](https://github.com/doronz88/pymobiledevice3) | Separate research candidate; pinned dependency/license/privilege review before any inclusion |

The review rechecked selected primary-source pages; it did not qualify the hardware or independently verify every claim in the original package. Apple page content could not be fully retrieved by the review browser. Exact dependency revisions, licenses, native JSON fields and tool compatibility must be rechecked at adoption. Handoff-reported third-party demonstrations remain leads, never acceptance evidence.

## Codex integrations

Inspect installed, documented capabilities before choosing an integration. Preserve native lifecycle and project registration boundaries. The presence of a Codex app version or a tool available to this development chat does not establish an API callable by the released Contribution app. Maintain a manual folder-opening/Add Project fallback and avoid private database writes or UI automation.

Use official installed help and current official OpenAI documentation for the chosen public integration. Record exact availability during setup/D0; do not hard-code historical bundle names, undocumented URL schemes, an invented registration endpoint, or a host-handoff API that is unavailable to the application.
