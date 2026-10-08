# Local development

Contribution targets Apple Silicon and macOS 14.0 using Xcode 27.0 build 27A266a, Swift 6.4 in Swift 6 language mode, and the macOS 27.0 SDK. The proof host runs macOS 27.0.1; runtime behavior on macOS 14 is not independently exercised. The app uses APIs available at its deployment target and its binary records `minos 14.0`.

`toolchain.json` pins Contribution's tools; `version.json` is the only application version source. Enrolled projects retain their own runtime selection through the adapter boundary. This workspace does not read or alter their pins.

## Setup

```sh
bash scripts/setup.sh
```

Prerequisites are the exact Xcode above (installed separately), Python 3.11 or newer with safe `tarfile` extraction support, and network access to the official Node distribution, npm registry and pinned Sparkle GitHub release. Native commands seed a checksum-verified repository-local SwiftPM artifact cache. The bootstrap downloads Node 24.21.0 and pnpm 11.23.0 under `.tools`, compares Node's pinned SHA-256 to the official checksum manifest, verifies downloaded bytes, and verifies pnpm's pinned registry SHA-512. Dependencies use the committed pnpm lockfile with frozen installation. No global runtime selection, package-manager installation, shell profile, Git hooks, login item or service registration is changed.

If Xcode is elsewhere, set `DEVELOPER_DIR` for the command. Do not change global `xcode-select` as a setup side effect. Toolchain mismatches fail with a reason. The root TypeScript workspace is portable in principle, but this bootstrap and native build are qualified only on Apple Silicon macOS.

## Commands

| Command | Result |
|---|---|
| `bash scripts/dev.sh generate` | Regenerate checked TypeScript types and shared TypeScript/Swift/Xcode identity |
| `bash scripts/dev.sh check:generated` | Fail on missing, changed, or extra generated TypeScript outputs |
| `bash scripts/dev.sh build` | Drift check and strict compilation of contracts, adapters, engine, CLI |
| `bash scripts/dev.sh typecheck` | Strict TypeScript project-reference compilation |
| `bash scripts/dev.sh contracts:types` | Compile-time structure proof for generated clients, including thirteen expected errors |
| `bash scripts/dev.sh contracts:check` | Generation/package build, client type proof, the current 18-schema registry, 14 preserved examples, runtime negative shapes, formats and projection tests |
| `bash scripts/dev.sh check` | Package build, boundary tests, privacy/provenance/requirements/docs checks |
| `bash scripts/dev.sh native:test` | Compile/test the Swift platform package against canonical envelope fixtures and engine responses |
| `bash scripts/dev.sh native:build` | Build/inspect an unsigned development `.app` with the shared Xcode scheme |
| `bash scripts/dev.sh cli help` | Supported development command surface |
| `bash scripts/dev.sh cli version --json` | One response envelope reporting shared development identity |
| `bash scripts/dev.sh cli service status --json` | Inspect the user service, or report its absence with exit 3 |
| `bash scripts/package-app.sh /absolute/new/Contribution.app` | Assemble a fresh unsigned app with immutable engine/runtime, service launcher and CLI |
| `bash scripts/check-native-client.sh` | Compile the real Swift IPC client and exercise a disposable service |
| `bash scripts/check-native-payload.sh` | Compile an isolated native helper; test immutable payloads and the real verified worker/event bridge |

For pure JSON stdout without the pnpm script-runner prefix, invoke the compiled entry point directly:

```sh
.tools/node/bin/node packages/cli/dist/main.js version --json
```

The development CLI is not globally installed. Help and version work without the service. Product commands use authenticated private IPC and report missing service readiness truthfully. Operation admission, retained results, logs and exit semantics are implemented by the shared engine; see [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for the partial acceptance boundary.

## Native application

The shared Xcode scheme builds an unsigned SwiftUI window and menu bar. It includes repositories, retained activity and logs, publication preview, GitHub activity, notification settings, explicit service/CLI setup actions, and the release updater boundary. Registration and CLI linking are user actions; builds do neither automatically. The development bundle identifier remains `dev.contribution.foundation`.

The native package owns the authenticated IPC client and platform integration. Workflow authority remains in the separate engine service. Build outputs, dependency stores and logs stay under ignored `.build`, `.cache`, `.tools` and `node_modules` directories. The artifact checker allows the app executable/plists, license notice and the exact checksum-pinned Sparkle runtime. Bundled engine assembly independently inventories hashes and rejects stale JavaScript without current source. Node's upstream license travels with its binary. [The payload allowlist](../config/payload-allowlist.json) constrains inputs; the checkout is never packaged wholesale.

[UPDATE_LIFECYCLE.md](UPDATE_LIFECYCLE.md) describes durable maintenance, backups and the unqualified signing/notarization candidate pipeline. Actual registration, signed updates and physical restart behavior require the deferred installation setup. Opening a development UI is not installation or release qualification.

## Evidence limits

Builds and disposable fixtures prove only their recorded boundaries. They do not replace installed-service, two-Mac, signing, update-path or physical-device acceptance. See [VERIFICATION.md](VERIFICATION.md) and [D0_INVENTORY.md](D0_INVENTORY.md).

## Free secret protection

Run `brew install gitleaks` and install the repository hooks with `git config core.hooksPath .githooks`. The hooks scan staged changes before commits and outgoing commit history before pushes; deleted refs skip scanning. Missing tools or unresolved history block the operation.

The standalone `Secret scanning` GitHub workflow runs the checksum-verified Gitleaks 8.30.1 CLI on Linux with read-only permissions and a five-minute timeout. Pull requests and pushes scan introduced commits; manual runs scan reachable history. New local branches scan commits not already known on the destination remote; new hosted branches scan against the default branch when available. It does not execute project code, use the separately licensed Action wrapper, upload reports, or enable paid GitHub security. Actions minutes may apply. Local and hosted output redacts detected values. Real exposed credentials must be rotated; test values require exact, reviewed exceptions.
