# Durable resource lifecycle

The [October 6 amendment](requirements/09-RESOURCE_LIFECYCLE.md) owns R1–R12 and AT-LC01–21. Contribution's existing journal/service own resource intent, exact allocation identity, grants, explicit lifetimes, dependency-ordered release and unresolved recovery. Platform adapters do not create another scheduler or ownership database.

Ordinary workflow commands now run behind a private one-use execution barrier. The target inherits the waiting worker's retained PID/start and group identity through exec. Command stdin is independent of the grant pipe. A failed journal callback closes the barrier before target execution. Retained descendants are identity-checked individually before termination. Group census failure is uncertainty, not an empty group. Cancellation, timeout and original child exits remain distinct from cleanup; redirected child output cannot make its release disappear with the leader.

[Update lifecycle](UPDATE_LIFECYCLE.md#journal-compatibility-and-rollback) owns the current migration/rollback floor. Repository and host-scoped resources use the same journal and grant owner; host SSH/provider resources retain null repository/operation/attempt IDs and exact process identity before execution. Host reconciliation is observation-only; optional diagnostic ownership never vetoes a working helper connection, but blocks overlapping diagnostics and final maintenance until released.

The exact Simulator adapter records UDID/runtime, host/boot, admitted token and prior state before boot/driver execution. It restores only a confirmed task-owned initially stopped boot, stops drivers first and verifies Shutdown before releasing the original admission. Borrowed devices remain running. Nested operations delegate to the outer lease; retained visual sessions retain their owner and stop action. A lost boot reply or replaced lease remains unresolved. The macOS adapter exists, but no real Simulator was operated or qualified.

The supported CLI surface is:

```sh
contribution service resources --json
contribution service resources --reconcile --json
contribution service resources --preview --json
contribution service resources --scope-token TOKEN --request-id UUID --json
contribution service resource-policy --json
contribution service resource-policy --file POLICY --expected-revision REV --request-id UUID --json
```

Reconcile is observation-only. Stop requires an exact reviewed selection and a supported owning adapter. A preview reports identity, lifetime, reason, stop action, dependencies and unknown byte estimates. Interrupted cleanup keeps its original request. New resources are never added to that scope. Unknown, borrowed, native, user-owned, pinned, changed and uninspectable resources stay protected. Retry budgets are finite and a failed stop remains visible. Pending resources fence only the affected clone; the original writer lease remains retained when owned command release is uncertain. Maintenance/restart checks include retained resources.

Resource count limits are explicit host/project maps. Empty maps defer to existing project admission and the service/storage caps; they do not invent a global native-worktree cap. Interactive expiry is observation, not stop authority. Platform and provider integration must retain exact identities, use supported APIs and remain fail-closed when capability is unavailable.

Cleanup admission retains the original selection and its per-resource expectations
in one transaction. Stop, failure, confirmed release and unchanged-context restart
observation advance each resource and its continuation together. Untouched selected
resources can still resume after partial cleanup. External generation/identity,
pin, dependency, token, host, boot, clone and enrollment drift cannot be endorsed
as progress. Retry budgets and backoff survive observation. A review admission
that never committed needs a fresh preview after startup observation; it granted
no cleanup authority. Preexisting unendorsed or torn records remain protected for
exact-owner repair rather than being silently adopted.

Current proof is source, generated-contract/build checks and disposable fixture/subprocess/Git/IPC tests. Real registration, enrolled project adapters, Simulator boot/data preservation, native Codex integration, actual paired hosts, sleep/reboot and physical devices remain separate qualification. The original MainCharacter/Roboty helpers remain active and Mathy's borrowed visual behavior and Glass Alpha's name-based ownership limitation remain preserved.

Implementation proceeds through process/Simulator lifecycle, repository/session admission, independent Git recovery, persistent services/cross-host/budgets, a disposable one-host pilot and incremental adoption. The [canonical ledger](verification/acceptance-status.json) retains every unfinished case. Remove interim helpers only after equivalent fixtures, actual-host cancellation/crash recovery and rollback pass for that exact workflow.

## Current requirement gap matrix

| Requirement | Implemented source and focused proof | Remaining acceptance / deferred owner |
| --- | --- | --- |
| R1 | Existing journal retains worktree/process/session intents, exact grant identities and immutable requests; waiting-worker execution barrier and failed-grant fixtures | Lifecycle owner: every crash boundary, strong platform birth identity and fast escaping ancestry; AT-LC04/08/18/21 |
| R2 | Explicit borrowed/ephemeral/interactive/persistent lifetime, parent, reason, stop action, pin/deadline and budget revision; retained/borrowed fixtures | Product policy: owners select retention reasons, pins and expiry; expiry grants no cleanup authority. Renewals and installed handoff variants; AT-LC03/19 |
| R3 | Command timeout/cancel/failure and setup/cleanup results remain separate; bounded adapter cleanup and dependency ordering | Process/platform owner: actual-host sleep/reboot and detached daemon qualification; AT-LC01/06/07/08 |
| R4 | Exact Simulator admission bridge, prior boot state, same lease, shared-user fence and release after verified Shutdown; synthetic concurrency/borrow/retention/drift cases | Platform/adoption owners: wire each existing admission implementation after exact-host qualification; data/Xcode clones and actual transition failures; AT-LC02–09/15 |
| R5 | Journaled process group/membership, identity-scoped TERM/grace/KILL; server commands can use the same owner with server kind. Named provider/service reserve/grant/close adapter preserves user sessions | Session owners: real provider capability bridge and long-lived server workflow wiring are disabled until qualified. Ports are never authority. AT-LC06/07/15 |
| R6 | Observation-only restart, retry limits, retained writer leases, atomic generation-bound cleanup continuation, partial/dependent cleanup, affected-scope fences and authenticated existing peer authority fences. SIGKILL persistence edges and packaged-service crash during cleanup are fixture proved | Recovery/peer owners: remaining transition census, actual two-host lost acknowledgment, sleep/reboot and incompatible payload cycles; AT-LC08/09/13/20/21 |
| R7 | Existing worktree owner requires independent transport-copied archive, fsck, available-object/shallow-boundary match and separate restore; corrupted/shared/large/partial output is protected. Native closeout uses exact attachment API or exact owning-chat instruction | Git/native owners: remote hydration/partial-promisor support and actual Codex capability bridge. Current support refuses those topologies rather than destroying available history; AT-LC10–12 |
| R8 | Review tokens, exact evidence/reason/lifetime/dependency/unknown bytes, post-await revalidation, removal intent/tombstone and same-request recovery | Cleanup owner: extend interruption/failure variants and actual owning-tool acknowledgment recovery; AT-LC05/11/13 |
| R9 | Existing native installer retains domain/label/app/payload/plist intent before SMAppService registration; observed result and paired retirement receipt; five-second unload reply deadline, bounded attempts and no repeat while uncertain | Native installation owner: installed registration/approval, legacy receipt adoption, missing/moved app, signing and actual update/uninstall qualification; AT-LC14/21 |
| R10 | Explicit resource limits plus existing storage owner, archive capacity reservation, protected history, bounded private census and on-demand CPU/process/memory-pressure/swap/disk observations | Storage/health owners: actual pressure/large topology/snapshot qualification. Unknown usage is unavailable, not zero; AT-LC16/19 |
| R11 | Host/boot/clone/enrollment/token guards, authority/enrollment barriers, unsupported-capability errors, allowlisted private diagnostics and supported owning APIs | Peer/platform owners: resource RPC capability negotiation and actual paired-host lifecycle actions; no cross-host PID action is supported; AT-LC04/09/12/20 |
| R12 | Thin family bridges preserve Mathy's visual lifetime and gate all four families on exact host/clone/revision/admission/crash/rollback proof. Interim helpers remain intact | Adoption owner: live wiring and qualification one workflow at a time; Glass Alpha requires exact-device coordination first. AT-LC09/17/21 |

Adapter interfaces and fixture identities are not live authority. A named-owner
integration must reserve without execution, honor the final guard immediately
before its supported API, and report exact identity/release. No generic discovery
endpoint creates provider or native-worktree ownership. No live qualification
record was created. Repository family bridges are available source interfaces;
they have not replaced existing project scripts.

Independent history copies are private retained evidence under `worktree-history`,
counted by the existing storage owner. The qualified source bound is one GiB and
100,000 entries per copy, finite inspection/transfer time, no hardlinks/alternates
or promisor dependence. Both available object inventory and original shallow
boundaries must survive an independent restore. Capacity is reserved before
copying. Existing partial copies are inspected and never overwritten or silently
removed. An invalid copy needs exact-owner repair. These archives are protected
from generic generated-output eviction.

Process release proves the retained root/group and observed members. A platform
without reliable census preserves uncertainty. Stronger proof for an immediately
escaped/reparented daemon still needs platform qualification; a zero process exit
is not proof that every possible detached effect ended. Provider/OS integration
must not infer ownership from an executable name, port or apparently idle process.

The version-2 process adapter journals late unconfirmed group members separately
from owned descendants. It never signals them, and requires positive disappearance
before reporting release. Their continued existence, including outside the original
group, remains unresolved. The operation deadline is retained before allocation;
macOS boot fencing uses the kernel boot-session UUID rather than a wall-clock time.

Native service ownership uses the existing installer's private synchronized
`service-installation.json` receipt because that owner exists before the service
journal can run. It does not create a daemon or another scheduler. Missing or
replaced payloads and an already registered legacy installation without an owned
receipt are preserved with an actionable reconciliation error. The existing plist
keeps `KeepAlive=false`. Source tests inject registration APIs; no real registration
or unregister operation was executed.
The private receipt is versioned and bound to an opaque local host/user identity;
foreign-host and unsupported-version receipts cannot authorize retirement.

## Rollout and rollback

1. Keep all live repository helpers and configurations. Run the disposable
   packaged-service source pilot, full/shallow recovery and negative fixtures.
   This step is source proof on one host, not installed qualification.
2. With separate installation/enrollment authority, qualify one disposable
   repository on one installed Mac and immutable payload. Exercise actual
   cancellation/SIGKILL/restart, exact Simulator initial states/data continuity,
   retained visual session stop, preview drift, interrupted removal, storage
   pressure and native update/retirement. Record exact host/build and sealed
   results against AT-LC01–21. Stop expansion on any unresolved release.
3. Wire the verified existing admission owner for one MainCharacter or Roboty
   workflow; preserve the original helper and gate profile for immediate fallback.
   Compare effective outcomes and teardown before acquiring another owner.
4. Preserve Mathy's borrowed/interactive lifetime explicitly. Migrate Glass Alpha
   only after exact UDID/admission coordination is proved. Qualify actual providers,
   native Codex integration and two-host resource RPC separately.
5. Roll back routing to the original helper only after Contribution's accepted
   operation and resource grants drain or remain visibly fenced. Never run two
   finalizers. Preserve intents, logs, archives, restore copies and unresolved
   records. Use a version-2-capable payload; older readers must refuse the journal.
   A source revert or restored backup cannot undo external effects. Remove interim
   helpers only after equivalent exact-workflow fixtures, actual-host recovery
   and a rehearsed rollback pass.

All AT-LC01–21 remain `partial_fixture` in the additive acceptance ledger.
The original 83 cases and original imported definitions remain intact. No fixture,
unsigned app build or local subprocess pilot closes installed or physical proof.
