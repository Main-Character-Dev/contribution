# S0 setup status

Date: 2026-10-04, America/New_York. Scope: repository foundation only. The independent source/build foundation checks passed on the task checkout and an isolated clean staged-source snapshot. Visual window/menu smoke remains pending where automation lacks existing GUI capture permission. M0 is not complete.

## Checkout and reconciliation

The chosen checkout is `/Users/gabe/.codex/worktrees/0e4e/contribution`, branch `codex/s0-foundation`, based on `4a23aaebfbf51dbf33eba30b479a0a8fea4c76ca`. Primary `/Users/gabe/Sites/contribution` was inspected on clean `main` at that same SHA before edits; it had only README and LICENSE tracked and no implementation. This task uses the existing worktree. Primary is not modified or fast-forwarded by setup.

The reviewed docs and corresponding README were reconciled from the uncommitted handoff in `/Users/gabe/.codex/worktrees/3f07/contribution`; those originals remain intact. Only relative contract links changed in the eight detailed requirements. Their full text, all 63 PRD and 40 RDEV requirements, and the byte-identical 83-case acceptance ledger remain retained. The MIT license is unchanged. All twelve schemas/fourteen examples moved into one canonical contracts package with original SHA-256 provenance checked. No archive or private reference content was imported.

## Foundation

The checked Xcode project/shared scheme builds an unsigned Apple Silicon SwiftUI window and menu bar at macOS 14.0. A local Swift package provides a thin client/platform boundary and checked response projection. The strict pnpm workspace builds contracts, adapters, engine and CLI in that dependency order. There is no workflow scheduler, IPC transport, SQLite binding, repository enrollment or device backend.

`version.json` owns version 0.1.0, build 1, channel `development`, schema v1. Generated Swift, TypeScript and Xcode configuration share it. Help/version work; product calls return `SERVICE_NOT_INSTALLED`, exit 3, without accepting an operation. The development CLI invokes compiled checkout code only and is not globally installed. [STORAGE_BOUNDARY.md](STORAGE_BOUNDARY.md) records the deferred service/journal contract. The development payload allowlist explicitly disables release packaging.

## Exact pins and provenance

| Tool | Pin | Provenance/compatibility |
|---|---|---|
| Node | 24.21.0 | [Official LTS release](https://nodejs.org/en/blog/release/v24.21.0), latest 24.x checksum index observed on this date; scoped Darwin arm64 archive SHA-256 in `toolchain.json` |
| pnpm | 11.23.0 | Exact npm registry tarball, pinned SHA-512, Node requirement >=22.13; scoped installation |
| TypeScript | 5.9.3 | Exact npm release; Node >=14.17; strict project references |
| Ajv / formats | 8.17.1 / 3.0.1 | Exact npm releases; draft 2020-12 local registry; all keywords retained |
| Type generator | json-schema-to-typescript 15.0.4 | Exact npm release; Node >=16; [upstream documented projection limits](https://github.com/bcherny/json-schema-to-typescript#not-expressible-in-typescript) |
| Node type declarations | 24.10.1 | Exact npm release for runtime major 24 |
| Xcode / Swift | 27.0 build 27A266a / 6.4 | Installed Apple toolchain observed locally; Swift 6 language mode |
| SDK / target | macOS 27.0 / macOS 14.0, arm64 | Checked project settings and built binary; macOS 14 physical/runtime proof remains separate |

Ambient Node was 24.19.0. The scoped runtime uses the newer official 24.21.0 LTS patch without changing the global environment. There is no departure from the documented Node 24, Swift 6, Apple Silicon or macOS 14.0 product foundation. The minimum app OS is not an inventory assertion about either real product host. [D0_INVENTORY.md](D0_INVENTORY.md) records observations and unknowns.

## Verification commands and outcomes

The table and clean-snapshot receipt below describe initial S0 delivery `627c637`. The later S0 projection repair restores ordinary nested intent/effect/availability structure that the initial generated TypeScript lost beside conditional `allOf`. Canonical schemas/examples, runtime validation and native/version outputs remain unchanged. [The separate repair evidence](verification/s0-projection-repair.json) records regeneration, compile-time regression, package/contract checks and source preservation; it does not repeat or extend application/native qualification.

| Exact command | Outcome |
|---|---|
| `python3 scripts/bootstrap.py` | Official Node checksum manifest and downloaded SHA-256 verified; pnpm SHA-512 verified; scoped versions match pins |
| `bash scripts/setup.sh` | Frozen lockfile setup passed on the task checkout |
| `bash scripts/dev.sh generate` | 15 generated schema/client/identity files written |
| `bash scripts/dev.sh check:generated` | Generated outputs match source; no stale generated TypeScript file |
| `bash scripts/dev.sh check` | Passed: 31 tests, all schemas/examples, 23 negative shapes, format checks, generated drift, strict package build, privacy/provenance/pins/requirements and local documentation links (197 in the clean snapshot; 200 after final evidence links) |
| `bash scripts/dev.sh native:test` | Two XCTest methods passed; nine positive/eleven negative envelope fixtures and both engine/client responses checked |
| `bash scripts/dev.sh native:build` | Passed: unsigned `.app`, arm64 executable, minimum OS 14.0, shared version, exactly three allowlisted bundle files |
| Direct development executable launch | Ordinary launch passed: process remained running for three seconds and was then terminated by the smoke check. Sandboxed attempt aborted. Visual window/menu inspection pending; no Screen Recording permission requested |
| Clean staged source snapshot: setup/check/native tests/native build | All passed with independently downloaded tools/dependencies and empty build outputs |
| `git diff --check` and `git diff --cached --check` | Passed |

The clean source snapshot was copied with `git checkout-index --all --prefix=/private/tmp/contribution-s0-clean-v4_2fqwd/` from staged tree `a623a3d444bf45740d0e8889b26452415bb45776`. In that directory, `bash scripts/setup.sh`, `bash scripts/dev.sh check`, `bash scripts/dev.sh native:test`, and `bash scripts/dev.sh native:build` each exited zero. Source/configuration was unchanged after that proof; only the final evidence records were completed. The [machine-readable S0 record](verification/s0-setup.json) retains the outcomes. This checkout's final commit is reported by `git rev-parse HEAD` and the task completion report, avoiding a self-referential commit field.

The first native build was blocked by the sandbox's access to SwiftPM's normal manifest diagnostics cache. The required build passed with normal Xcode cache access. Xcode's optional debug/preview dylibs were then disabled to match the minimal app bundle allowlist. Ignored logs stay in `.build`; no raw diagnostic captures enter Git.

## Remaining prerequisites and next task

Visual native window/menu, keyboard and accessibility proof needs an available GUI inspection route with existing permissions. The app build and Swift fixtures do not substitute for that proof. Python 3.11+ and the exact installed Xcode are fresh-checkout prerequisites; native builds need Xcode's normal cache access. No release identity or phone is required for S0.

For later implementation: define the immutable installed app/helper/engine/CLI/runtime payload and discovery identity in the remaining M0 slice, then select/qualify the SQLite binding, migrations, bounded IPC and one-writer durable admission in M1. These are the next bounded tasks, not authorized continuations of this setup request. Continue read-only D0 inventory for both actual Macs, the approved phone, independent pairing/signing, travel caller, backend revision/privileges and owner-assisted network proof. No live access was tested.

All 54 original core, five robustness and 24 physical cases remain `not_started` / `not_run`. Core release, fixture contract proof, one-Mac development build, two-Mac proof and each physical operation remain distinct. No service registration, global CLI install, other-repository/hook changes, signing import, physical operation, push, publication or deployment was performed.
