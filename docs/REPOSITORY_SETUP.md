# S0: repository foundation

Set up the repository so the product can be implemented in small verified increments. This task builds a foundation only. The [setup prompt](SETUP_PROMPT.md) is the next-chat assignment; the full package's implementation starter is not this task.

## Allowed work

Inspect repository instructions, current branch/HEAD, existing files and license before editing. Reconcile this documentation baseline into the chosen Contribution checkout and preserve concurrent work. Use a `codex/` branch and the existing suitable worktree when possible. Record the chosen checkout and base SHA. Do not assume primary still matches the review snapshot.

Create source targets, package/build configuration, local dependency installation, synthetic fixtures, focused checks, and development artifacts. A minimal app that opens to an honest empty state and a CLI that reports version/help are appropriate scaffolding. Do not add fake successful workflows or advertise unimplemented commands as supported.

## Proposed layout

```text
apps/macos/                 Native app project, shared schemes, platform shell
packages/contracts/        Single schema source, examples, validation, client projections
packages/engine/           Typed engine boundary and shared build/version identity
packages/cli/              Thin executable; help/version and truthful availability
packages/adapters/         Narrow generic/project/device interfaces, no live migration
tests/fixtures/            Synthetic inputs and disposable-repository helpers
tests/integration/         Public-boundary smoke checks; later workflow acceptance
scripts/                   Reproducible build and verification entry points
docs/                      Maintained requirements, decisions and evidence summaries
```

Use the chosen [architecture](ARCHITECTURE.md). Equivalent structure is acceptable only where it preserves these responsibilities and is documented. Avoid adding a web frontend framework, database service, container stack, hosted control plane, or general plugin infrastructure.

## Deliverables

1. **Repository guidance and privacy.** Add a short root `AGENTS.md` that points to canonical docs and preserves user file-deletion safety, owned-work commits, existing policies, native worktree ownership, precise evidence, and installed/source isolation. Add focused ignore rules for raw reference material, local secrets/configuration, device evidence, signing/pairing files, dependencies, and generated build output. Do not ignore source schemas or legitimate tests. Retain the existing MIT license. Define later release packaging as an explicit allowlist; ignores alone are insufficient.
2. **Exact toolchain and workspace.** Inspect the local macOS, CPU, Xcode/Swift, Node and package-manager availability without modifying global selections. Pin exact compatible Contribution versions, record provenance, commit one pnpm lockfile, and make frozen-lockfile setup reproducible. Start from Swift 6 and Node 24 LTS as documented. Do not copy runtime versions from private project snapshots. Keep downloaded tools in a scoped development location and verify official runtime checksums. No global Homebrew or shell-profile edits are required by this task.
3. **Buildable native shell.** Check in a real macOS app project and shared build scheme, minimal SwiftUI window and menu-bar surface, and one generated/shared application version. Build for Apple Silicon using the selected macOS 14.0 deployment target, or document an evidenced compatibility change. Configure the documented direct-distribution permissions model rather than inheriting an App Store sandbox template. Local unsigned/ad hoc development builds must not need a paid signing identity. Do not register login items, request notifications, enable updates, grant Full Disk Access, or install a service just to test the shell.
4. **Engine and CLI packages.** Use strict TypeScript, explicit package boundaries and dependency direction. The CLI only presents/dispatches shared contracts. Implement the small help/version surface and clear unavailable/service-not-installed results where needed. A private development artifact may invoke built engine code; do not wire installed user commands to this mutable checkout. Leave scheduling, Git effects, SQLite operation storage and device dispatch to M1 and later. A schema/migration design note or directory is sufficient here.
5. **Contract baseline.** Move the twelve schema JSON files and fourteen example JSON files from `docs` into `packages/contracts` once, updating links and the import record. Preserve the original URNs, versions, enums and fixture semantics. Add local schema resolution and date/UUID/URI format validation, with no network schema fetch. Use a draft 2020-12 validator such as a pinned compatible Ajv release. Generate TypeScript types and establish a faithful Swift Codable projection for the envelope/version slice. Account explicitly for nullable fields, unknown/additive payload data and conditional validation. Do not attempt a new generic schema compiler; use tested tooling or a small checked projection with documented limits. The engine remains the runtime validation authority.
6. **Focused proof.** Add checks that validate all schemas/examples, reject a small set of meaningful invalid/unsafe contract shapes, and prove the app/CLI share one version identity. Verify generated outputs do not drift and CLI JSON contains no progress prose. Build the native shell and all package targets. Provide documented local commands for setup, build, type checking, contract verification and tests. Use existing conventions if found; otherwise expose concise root scripts, with native builds explicitly macOS-only. Do not install Git hooks or hosted CI merely to scaffold the project.
7. **Read-only D0 preparation.** Record actual local tooling facts and unknown peer/phone/signing facts. Document the intended architecture/dependency review for native tooling and go-ios; do not install or start a device backend. Keep real UDIDs, account identifiers, tailnet addresses, credentials and evidence outside Git. Note the phone-only initiation decision and exact future hardware prerequisites. No network changes, pairing, signing import, SSH enrollment, app installation, trust reset, device reboot, or data mutation is part of S0.
8. **Setup record.** Add `docs/SETUP_STATUS.md` with exact pins, selected paths/targets, commands run and results, known limits, deferred decisions and the next bounded implementation task. Update the roadmap honestly. Keep all application acceptance cases `not_run` unless their actual behavior has been implemented and independently exercised; schema/build success alone does not pass them.

If tools or dependencies are unavailable, complete independent source/configuration work and retain precise blocked checks. Do not claim a clean build or S0 completion without the required proof. A missing physical phone or release-signing identity does not block S0.

## S0 exit criteria

| Check | Required result |
|---|---|
| Clean setup | A fresh checkout can install pinned development dependencies with the committed lockfile and documented native prerequisites |
| Native build | The minimal `.app` builds; launch/menu-bar smoke is recorded when a GUI session is available, otherwise explicitly pending |
| Package build | Engine, CLI, contract and adapter targets compile with strict type checks |
| Shared identity | App and CLI derive the same version from one source and report development status |
| Contracts | All 12 schemas and 14 examples validate; relevant negative cases reject; no duplicate editable schema copy remains |
| Capability honesty | Help/version work; unavailable product operations do not report success or touch real repositories/devices |
| Privacy | Git changes contain no archive, raw audit, real device evidence or secret material; generated payload inputs are allowlisted |
| Documentation | Commands, pins, architecture choices, verification and remaining environment prerequisites are explicit |
| Delivery | Only owned setup files are committed when allowed by repository policy; report commit, checkout and branch without pushing or installing |

Stop after this foundation. The recommended next task is the remaining M0 installed-payload boundary and M1 durable operation foundation, with D0 inventory continued and D1 ready to start once scoped journal/dispatch exists. Do not claim M0 complete just because S0 builds.
