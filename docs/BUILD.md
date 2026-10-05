# Local development

S0 targets Apple Silicon and macOS 14.0 using Xcode 27.0 build 27A266a, Swift 6.4 in Swift 6 language mode, and the macOS 27.0 SDK. The proof host runs macOS 27.0.1; runtime behavior on macOS 14 is not independently exercised. The app uses APIs available at its deployment target and its binary records `minos 14.0`.

`toolchain.json` pins Contribution's tools; `version.json` is the only application version source. Enrolled projects retain their own runtime selection through the adapter boundary. This workspace does not read or alter their pins.

## Setup

```sh
bash scripts/setup.sh
```

Prerequisites are the exact Xcode above (installed separately), Python 3.11 or newer with safe `tarfile` extraction support, and network access to the official Node distribution and npm registry. The bootstrap downloads Node 24.21.0 and pnpm 11.23.0 under `.tools`, compares Node's pinned SHA-256 to the official checksum manifest, verifies downloaded bytes, and verifies pnpm's pinned registry SHA-512. Dependencies use the committed pnpm lockfile with frozen installation. No global runtime selection, package-manager installation, shell profile, Git hooks, login item or service registration is changed.

If Xcode is elsewhere, set `DEVELOPER_DIR` for the command. Do not change global `xcode-select` as a setup side effect. Toolchain mismatches fail with a reason. The root TypeScript workspace is portable in principle, but this S0 bootstrap and native build are qualified only on Apple Silicon macOS.

## Commands

| Command | Result |
|---|---|
| `bash scripts/dev.sh generate` | Regenerate checked TypeScript types and shared TypeScript/Swift/Xcode identity |
| `bash scripts/dev.sh check:generated` | Fail on missing, changed, or extra generated TypeScript outputs |
| `bash scripts/dev.sh build` | Drift check and strict compilation of contracts, adapters, engine, CLI |
| `bash scripts/dev.sh typecheck` | Strict TypeScript project-reference compilation |
| `bash scripts/dev.sh contracts:types` | Compile-time structure proof for generated clients, including thirteen expected errors |
| `bash scripts/dev.sh contracts:check` | Generation/package build, client type proof, all 12 schemas/14 examples, 23 runtime negative shapes, formats and projection tests |
| `bash scripts/dev.sh check` | Package build, boundary tests, privacy/provenance/requirements/docs checks |
| `bash scripts/dev.sh native:test` | Compile/test the Swift platform package against canonical envelope fixtures and engine responses |
| `bash scripts/dev.sh native:build` | Build/inspect an unsigned development `.app` with the shared Xcode scheme |
| `bash scripts/dev.sh cli help` | Supported development command surface |
| `bash scripts/dev.sh cli version --json` | One response envelope reporting shared development identity |
| `bash scripts/dev.sh cli service status --json` | Rejected response, `SERVICE_NOT_INSTALLED`, exit 3 |

For pure JSON stdout without the pnpm script-runner prefix, invoke the compiled entry point directly:

```sh
.tools/node/bin/node packages/cli/dist/main.js version --json
```

The CLI is a private checkout artifact. It is not placed in a global command directory. Help and version work independently of a service. Known product commands fail with exit 3 and no operation identity; unknown usage fails with exit 2. `--jsonl` is unavailable. No command accepts a job, executes Git/device/update effects, or writes operation state.

## Native shell

```sh
open .build/native/Build/Products/Debug/Contribution.app
```

Or open `apps/macos/Contribution.xcodeproj`, select the shared Contribution scheme and Run. The window and menu bar report service unavailability. “Open Contribution” opens the window; “Quit Contribution” quits this shell. There are no permissions, registration, pairing or updater actions.

The local Swift package owns checked client representations and a minimal `ContributionClient` boundary. Its development implementation has no IPC transport. Scheduling and workflow authority remain with the future engine/service. Debug and Release project configurations disable App Sandbox and paid signing; hardened runtime is a future release qualification, not established by this unsigned build. The development bundle ID `dev.contribution.foundation` is provisional. Packaging an installed payload, bundled engine/CLI/runtime, helper registration, Developer ID/notarization and updates are deferred to M0/M6.

Build outputs, dependency stores and logs stay under ignored `.build`, `.cache`, `.tools` and `node_modules` directories. The app contains only its executable, Info.plist and PkgInfo; the artifact checker rejects additional resources. [The explicit payload allowlist](../config/payload-allowlist.json) defines development inputs and disables release packaging pending M0. Never package the checkout wholesale.

## Evidence limits

These commands prove the S0 build and contract boundaries. They do not satisfy application acceptance, installed-service lifecycle, repository admission, durability, two-Mac behavior, signing, updates or physical device capability. See [VERIFICATION.md](VERIFICATION.md) and [D0_INVENTORY.md](D0_INVENTORY.md).
