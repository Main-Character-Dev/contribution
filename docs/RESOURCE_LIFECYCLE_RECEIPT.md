# Resource lifecycle implementation receipt

October 6, 2026. Source implementation was authorized; installation, live
enrollment, provider/Simulator/physical-device actions, OS changes, remote pushes
and deployment were not performed. The historical input documents were reviewed
against the current checkout before changes.

## Source and integration

Development checkout: `/Users/gabe/.codex/worktrees/a9ea/contribution`, branch
`codex/resource-lifecycle`, clean baseline
`2cd26894b19f084a30ef8e19077537081e01b743`. Primary integration target is
`/Users/gabe/Sites/contribution`, `main`; other chats' worktrees are preserved.

The core implementation is retained in
`0a82a62bf16d55afc5de8e1f181098d9e196b9d4`. The subsequent process-observation,
deadline, boot-identity and native host/version repairs are retained in
`ab5ba2206904613b7dee23a1fb1cf0c15ff6f678`. The receipt is a
separate documentation commit. Local integration is a guarded fast-forward;
the final handoff records its exact resulting SHA. No remote delivery is claimed.

## Implemented behavior

- The existing journal retains resource intents before allocation and execution
  grants, exact context, lifetimes, immutable requests, dependencies, bounded
  retries, unresolved states and cleanup continuation. Existing admissions,
  writer leases, storage and maintenance owners enforce resource fences.
- Workflow processes use a waiting-worker grant barrier, retained deadlines,
  bounded descendant cleanup and independent operation/release results. Late
  unknown group members are observation-only and must disappear before release.
  The version-2 adapter cannot grant them signal authority. Boot fencing uses the
  kernel boot-session UUID on macOS.
- Exact Simulator/admission adapters preserve borrowed initial boots, shared
  users and retained visual sessions. Named provider/server/service interfaces
  use reserve/grant/observe/close and supported owner APIs. Family bridges require
  exact qualification; the existing repository helpers remain active.
- Utility worktree removal requires independent full/shallow history copies,
  integrity/object/boundary verification and independent restore, capacity
  reservation and final revalidation. Native Codex closeout requires its owning
  tool or an exact owning-chat instruction.
- The existing native installer retains versioned host-bound registration and
  retirement receipts, exact payload/plist identity and bounded unload results.
  The existing plist remains `KeepAlive=false`. Private diagnostics and honest
  timestamped health observations do not confer cleanup authority.

The [R1–R12 gap matrix](RESOURCE_LIFECYCLE.md#current-requirement-gap-matrix)
distinguishes implemented source, fixture proof, missing capability/source work
and retention policy decisions. No new scheduler, ownership database or cleanup
daemon was introduced.

## Verification

| Command / proof | Result |
| --- | --- |
| `bash scripts/dev.sh check` | 384 Node tests passed; zero failed/cancelled/skipped; generated drift, strict builds, contract types and foundation checks passed |
| `bash scripts/dev.sh contracts:check` | 30 contract/projection tests passed at the implementation checkpoint; those tests also pass in the final cumulative run |
| `bash scripts/native-test.sh` | 24 Swift tests passed, including foreign-host and unsupported-version receipt refusals |
| `bash scripts/native-build.sh` | Unsigned arm64/macOS 14 development app build and pinned-runtime/license verification passed; no installation |
| Focused lifecycle proof | 48 resource/history/owner/privacy/peer tests, 28 process/maintenance/session tests and 31 process/lifecycle/build-output/device-build tests passed; these groups overlap |
| Disposable immutable-payload pilot | Real IPC, one temporary repository, SIGKILL/restart, observation of retained orphan ownership, immutable replay and reviewed cleanup continuation passed; included in the final Node suite |
| Preservation | MIT, all 26 original JSON imports byte-identical, 63 PRD/40 RDEV requirements, original 83 acceptance IDs and additive 21 partial lifecycle IDs retained |

The unbounded initial harness run and a subsequent bounded run exposed fixture
load and intermittent helper release uncertainty. The harness now declares four
file workers; process grant/close handling and unknown-member observations were
repaired without widening cleanup authority. A sandbox-denied run was stopped
only after verifying its exact task-owned launcher. The successful final checks
used local host access for process/boot observations and Xcode caches.

Logs remain private and are preserved outside the completed worktree under
`/Users/gabe/.codex/visualizations/2026/10/06/01a112c0-cee0-73e2-aaa5-37967afa2197/resource-lifecycle-evidence/`.
They are not payload content or committed raw host evidence.

## Remaining acceptance and rollout

**AT-LC01–AT-LC21 all remain `partial_fixture`.** No actual installed acceptance
was promoted. Remaining work includes real provider/native capability wiring,
long-lived server workflow wiring, stronger platform process birth/escaped-daemon
proof, every crash-boundary variant, large resource census pagination,
partial/promisor remote history hydration, actual Simulator data continuity,
native update/retirement, and real two-host resource capability/recovery proof.
The matrix and shared ledger retain the responsible deferred owners. Retention
reasons, renewal and expiry policy remain explicit product decisions; expiry
alone never authorizes disposal.

The [rollout/rollback plan](RESOURCE_LIFECYCLE.md#rollout-and-rollback) starts with
one separately authorized installed disposable repository/Mac pilot. Record its
exact payload/host and cancellation, crash, boot-state/data, preview-drift,
storage and retirement results before wiring one MainCharacter or Roboty
workflow. Preserve Mathy's visual lifetime; require exact-device coordination
before Glass Alpha adoption. Qualify providers, native Codex and paired hosts
separately. Keep the landed interim helpers until equivalent proof and rehearsed
rollback pass.

Rollback drains or visibly fences accepted resource grants before changing
routing, retains all intents/history/evidence, and uses a journal-version-2 and
process-adapter-version-2 compatible payload. Never run two finalizers or restore
a database backup to pretend external effects were undone. Completed development
worktree archival uses Codex's supported owning operation only after local
integration and preservation of needed ignored evidence.
