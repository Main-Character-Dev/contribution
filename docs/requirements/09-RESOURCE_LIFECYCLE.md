# Durable resource lifecycle amendment

Authorized October 6, 2026. This amendment extends the preserved requirements and acceptance baseline. The existing service, SQLite journal, storage owners and project admission remain the sole workflow authority. Physical actions, installation, enrollment, remote publication and deployment retain their separate authority.

## Requirements

| ID | Required behavior |
| --- | --- |
| R1 | Retain allocation intent before effects; retain exact host/boot/clone/enrollment/parent/token/adapter identity before granting execution. Borrowed/native/user/unknown resources never acquire cleanup authority through discovery. |
| R2 | Ephemeral, borrowed, explicitly retained interactive and installed persistent lifetimes survive handoff/restart with owner, reason, supported stop action and reviewed pin/deadline. Expiry triggers reconciliation rather than guessed disposal. |
| R3 | One dependency-ordered teardown path handles success, failure, cancellation, timeout and setup/shutdown errors. Preserve workflow outcome and release outcome independently; stop drivers before releasing admission. |
| R4 | Exact Simulator UDID/runtime and initial state are recorded under the repository's existing admission. Restore only a positively task-booted initially stopped device under the same lease. Preserve preexisting boots, retained visual sessions, data and unproved Xcode clones. Bound commands and cleanup. |
| R5 | Process grants precede execution; exact PID/start/ancestry/boot evidence scopes TERM/grace/KILL. Server ports are observations. Providers use supported named-session APIs, never global browser/system teardown. |
| R6 | Journal transitions, retries and scope fences survive every crash boundary. Recovery observes before resuming the same action; it never repeats starts from missing replies. Acknowledged transfer/fencing and monotonic host identity are independent of wall-clock expiry. |
| R7 | Utility worktree removal requires guarded ownership, recoverable retained history and independent restore/integrity proof appropriate to full/shallow/partial topology. Preserve local/ignored/shared/locked/valuable/live work. Native Codex worktrees use supported owning-tool operations or an actionable owning-chat instruction. |
| R8 | Exact previews retain evidence, reason, lifetime, dependencies, recoverability and bytes/unknown estimates. Revalidate after asynchronous inspection; journal stop/remove intent and tombstone. Partial cleanup resumes its same request without consuming replacements or new resources. |
| R9 | Utility service install/start and stop/uninstall form a retained paired lifecycle with exact domain/label/file identity. Validate inputs before startup/log creation; bound failed retries; verify unload before retiring data. |
| R10 | Resource accounting and declared host/project budgets extend existing admission/storage. Protect source/history/unique evidence/payloads/databases. Report timestamped CPU, process/device counts, memory pressure, swap and disk limits without summed-RSS or causality claims. |
| R11 | Platform identity adapters remain separate from generic policy. Unsupported capabilities fail clearly. Remote requests use authenticated enrolled hosts with host-local revalidation. Private bounded records/logs omit secrets, prompts, arbitrary environments and app containers from exports. |
| R12 | Thin MainCharacter/Mathy/Roboty/Glass Alpha adapters preserve each policy, native ownership and intentional lifetime. Keep interim helpers until equivalent fixtures, actual-host cancellation/crash proof and rollback pass; adopt one disposable repo/host before expansion. |

## Acceptance extension

These stable IDs complement the original 83 cases. Fixture results never qualify installation, native Codex, two actual hosts or physical devices. Every incomplete scenario remains in the canonical ledger.

| New ID | Required proof | Existing acceptance owner(s) | Requirement(s) |
| --- | --- | --- | --- |
| AT-LC01 | Success/failure/zero-exit cancellation/timeout; finite effective outcome, original exit retained, descendants stopped before release | AT-P07, AT-A02 | R3, R5 |
| AT-LC02 | Initially Shutdown versus Booted; only positively owned boot restored; exact UDID and data preserved | AT-H06 | R4 |
| AT-LC03 | Nested lease has one finalizer; borrowed and retained visual session survives with accountable stop action | AT-H06, AT-A05 | R2–R4 |
| AT-LC04 | Token/generation/UDID/PID/start/boot-context drift preserves the changed resource | AT-H06, AT-P07 | R1, R4–R6 |
| AT-LC05 | Drift during awaited observation is rejected by the final guard, including enrollment/pin/dependency changes | AT-P11, AT-A05 | R1, R8 |
| AT-LC06 | TERM-resistant descendant, redirected/closed stdio, stalled shutdown and failed inspection reach a finite unresolved result without false release | AT-P07, AT-U05 | R3–R5 |
| AT-LC07 | Setup/provider/control-close failure runs remaining safe cleanup; dependent Simulator shutdown waits for driver proof | AT-P07, AT-U02 | R3–R5 |
| AT-LC08 | Crash at every transition, SIGKILL, restart, sleep/wake, clock changes and reboot; no repeated start or guessed kill | AT-H05, AT-U02, AT-U05 | R1, R6 |
| AT-LC09 | Two repositories compete fairly across shared/exclusive slots; no lock cycle; foreign-host identities rejected | AT-H06, AT-R05, AT-U03 | R4, R6, R11 |
| AT-LC10 | Detached/shallow/partial/promisor history, misleading successful fetch, incomplete bundle and independent restore | AT-M04, AT-R01, AT-R03 | R7 |
| AT-LC11 | Dirty/staged/untracked/ignored valuable files, replaced paths, links, locks, submodules/embedded/shared checkouts and live dependencies remain intact | AT-M02, AT-M04, AT-R02 | R7–R8 |
| AT-LC12 | Native attachment API unavailable: exact owning-chat closeout instruction; no native directory/database mutation | AT-E02, AT-E03, AT-M04 | R7, R11 |
| AT-LC13 | Stale preview, changed request inputs, duplicate completion and crash during partial cleanup preserve new resources and replay the same receipt | AT-A03, AT-P11 | R6, R8 |
| AT-LC14 | Missing service executable/repo/config, registration drift and interrupted uninstall: bounded visible failure, no log resurrection or relaunch loop | AT-U01, AT-U02, AT-U05 | R9 |
| AT-LC15 | Unowned server/browser/system process, occupied port and unknown Simulator clone remain protected | AT-H06, AT-E03 | R4–R5, R10 |
| AT-LC16 | Storage pressure, failed/unsealable evidence and incomplete accounting block admission without deleting protected material | AT-O01, AT-U04 | R7, R10 |
| AT-LC17 | Utility unavailable and adoption rollback preserve original gates, source guards, shared sessions, history and one teardown owner | AT-V01, AT-V03, AT-E03, AT-R05 | R12 |
| AT-LC18 | Intent retained before allocation; dispatch impossible before identity/grant persistence; failed journal write cannot authorize effects | AT-A03, AT-H05 | R1, R6 |
| AT-LC19 | Lifetime/budget configuration revision, expiry/renewal and pin behavior; unknown usage remains protected | AT-A05, AT-H06 | R2, R10 |
| AT-LC20 | Lost transfer acknowledgement, revoked authority, unsupported adapter and private diagnostic export; no new owner until fenced release is proved | AT-H03, AT-R05, AT-O05, AT-U03 | R6, R11 |
| AT-LC21 | Resource-record version upgrade/downgrade and actual payload rollback cannot let an older reader ignore unresolved ownership | AT-U02, AT-U04 | R1, R6, R12 |

## Implementation and qualification

See [Resource lifecycle](../RESOURCE_LIFECYCLE.md), [implementation status](../IMPLEMENTATION_STATUS.md), [verification ledger](../verification/acceptance-status.json) and [roadmap](../ROADMAP.md). Raw host evidence and private historical archives remain external. Rollback must retain unresolved ownership and fence older readers; reverting source cannot erase actual effects.

## Implementation proof pointers

The [current implementation](../IMPLEMENTATION_STATUS.md) and [repair receipt](../verification/connectivity-repair.json) record software scope and proof. [Update lifecycle](../UPDATE_LIFECYCLE.md#journal-compatibility-and-rollback) owns the reader floor for host-scoped grants; all requirement/acceptance IDs and independent physical variants remain authoritative. Fixture evidence grants no live trust, network change, device capability or enrollment authority.
