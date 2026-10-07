# Resource lifecycle implementation receipt

Dated checkpoint proof. Counts and version floors below describe that checkpoint; see [current implementation](IMPLEMENTATION_STATUS.md), [verification](VERIFICATION.md), and [current journal compatibility](UPDATE_LIFECYCLE.md#journal-compatibility-and-rollback).

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

## Cleanup restart repair checkpoint

The subsequent review reproduced a source defect: restart observation changed a
resource's generation without updating its accepted cleanup continuation. The
same request then failed with `RESOURCE_SELECTION_CHANGED` and kept admission
fenced, including after confirmed disappearance. The earlier pilot crashed
before its cleanup preview and did not cover this boundary.

Source repair: `d5f27a319abc899c3544f323e91a70db796b5efd`, based on locally
integrated `429b11622e7321cc2601f4fbba7845a4aed5b555`. Resource and expectation
updates now share one journal transaction, including reviewed admission, stop,
failure, release and same-context observation. Other-owner generation, token,
identity, pin, dependency, host, boot, clone or enrollment changes remain
protected. Retry/backoff is preserved. A review that never committed granted
no cleanup authority and requires a fresh preview after startup observation.
Existing unendorsed/torn records are not silently adopted.

| Check | Result |
| --- | --- |
| Final focused lifecycle/Simulator/owner/IPC group | 59 tests passed, zero failures/cancellations/skips |
| `bash scripts/dev.sh check` | 416 tests passed, zero failures/cancellations/skips; strict builds, generated drift, contract types and foundation passed |
| New interruption regressions | 31 tests: fifteen real SIGKILL persistence edges in a disposable synthetic-owner child, retained lifetimes, partial dependencies, new-resource preservation, drift refusal, retry/backoff, deferred/failed observation and a concurrent final-guard race |
| Packaged-service IPC pilot extension | Actual SIGKILL during reviewed process cleanup; same-request continuation, duplicate completion and successful subsequent new check proved in a temporary repository |
| `bash scripts/native-build.sh` | Unsigned development app build/artifact verification passed |
| `bash scripts/package-app.sh` with a fresh output | Unsigned app assembled with the repaired immutable engine/runtime; manifest verified and packaged lifecycle JavaScript byte-matched to the tested build |

The preserved app is `Contribution-d5f27a3.app` under
`/Users/gabe/.codex/visualizations/2026/10/06/01a112c0-cee0-73e2-aaa5-37967afa2197/resource-cleanup-recovery/`.
Its payload manifest digest is
`e476585982b00f91b22301fa1e4f1c3a6eddcb47c657a46e31af7c5905836d80`.
Fresh logs, packaged-payload identity and final integration evidence are retained
there. Packaging did not install, register, enroll or start a user service.
Native Swift source was unchanged; the earlier 24-test Swift result remains a
historical checkpoint, not a new rerun or installation proof.

This removes the reviewed blocker for selecting an isolated full clone of
Contribution as the first generic Git/process/storage pilot on one Mac. Keep the
primary and native Codex worktrees under the interim workflow. Use an explicit
meaningful validation check with enrolled-project pins; generic enrollment's
default empty check list cannot qualify a gate. Follow the existing rollout and
rollback sequence with separate installation/enrollment authority. Simulator,
provider, native attachment, update/signing and two-host qualification remain
open, and all AT-LC01–21 remain `partial_fixture`.
