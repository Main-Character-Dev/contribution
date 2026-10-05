# Retained output and cleanup

The service retains immutable request identities, operation results, artifact provenance and transfer receipts even after their generated output expires. A repeated request can report its original outcome; it does not repeat an install or transfer to regenerate expired bytes.

Peer evidence stays protected through the separate [completion receipt
exchange](PEER_PROTOCOL.md). Imported operations are associated with their
original sender at admission; older imported rows also preserve that authority
through `senderHostId`. A receiver needs the sender's exact completed-result
acknowledgment, and a sender needs confirmation of its retained acknowledgment
outbox. Missing, stale or uncertain receipts preserve evidence. These checks
apply to raw logs, owned checkout/output cleanup and old backup retirement.
Acknowledgment itself removes no files and does not release Git source refs.

Raw attempt logs use the configured `rawLogDays` (30 by default) and `maxLogBytes` admission cap. Completed, unpinned logs may expire automatically; uncertain, interrupted, active and unacknowledged peer work remains protected. `doctor` reports protected usage and blocked admission. Individual running logs are bounded as well. A full protected cap still permits one retention-only settings request that matches the current revision and raises the cap above observed usage. That control request can complete while ordinary processing is paused; repository jobs remain paused. Other settings changes, stale revisions and a second pending recovery cannot use this exception. New project creation and source/history capture check storage pressure before creating repository or outbox state.

Generated signed artifacts and accepted incoming artifacts are eligible after 30 days. Original project gate output and its sealed private snapshots use `rawLogDays`. Cleanup requires an explicit review:

```sh
contribution service storage --preview --json
contribution service storage --scope-token PREVIEW_UUID --request-id REQUEST_UUID --json
```

The preview lists candidates, bytes, policy and protected entries without removing output. Execution rechecks the exact scope, file identities, operation state, pins and dependent queued or unresolved requests. Only positively owned generated directories are eligible. Unknown files, shared hardlinks and changed output are preserved. Artifact and gate-output symlinks remain protected; completed build intermediates have the separately recorded link handling below. Source worktrees, Git bundles and refs, installed payloads, exports and the live database are outside this cleanup boundary. Completed update backups have their separate conservative rule below.

Removal retains its intent before deleting each reviewed path and keeps a tombstone for every output. A crash can leave a partial directory; resume with the same scope and request UUID. New files or dependencies stop recovery without removing them. A different request cannot take over the retained cleanup. A completed request returns its original result. Cleanup does not run during an update maintenance hold.

Contribution-owned build, generic candidate and adopted captured-source checkouts have a separate review:

```sh
contribution service storage --worktrees --preview --json
contribution service storage --worktrees --scope-token PREVIEW_UUID --request-id REQUEST_UUID --json
```

Only new checkouts with a complete creation record are eligible. The record binds their attempt, repository, retained commit ref, filesystem identities and Git administration directory. Native Codex worktrees, unknown directories and older unrecorded checkouts are excluded. Eligibility uses `rawLogDays` and requires a settled, unpinned, acknowledged attempt, no unresolved clone work, no potentially live retained process, detached retained history and a clean checkout. Untracked files, ignored files, locks, submodules, replaced paths and changed registration remain protected.

Execution rechecks the review and persists its cleanup intent before invoking `git worktree remove` without force. It never resets or cleans a source checkout. New jobs in affected clones wait while removal is unresolved; duplicate requests still return their original operations. After an interruption, resume the same cleanup request. An already absent checkout and administration directory complete the retained removal receipt; partial or replaced state requires inspection. New user files are preserved. Git retention refs and bundles remain available, and original operation receipts expose the checkout expiration. Build products outside the source checkout are not removed by this command.

Successful offline builds now retain a separate creation identity and completion
snapshot for their generated app, DerivedData, result bundle and intermediate
files. The source checkout is excluded from that snapshot. After its owned Git
checkout has been removed through the workflow above, the regular output
preview can include the remaining build directory once `rawLogDays` expires.
Every filename and filesystem identity must still match the completion
snapshot. New or modified files, replaced directories, unacknowledged work,
unresolved clone jobs, potentially live workers and pinned associated artifact
evidence keep the output protected. Older builds without these records and
failed/unsealable build directories do not acquire inferred cleanup authority.

Recorded build cache symlinks are inspected without traversing their targets.
Cleanup unlinks only the unchanged recorded link; its target is untouched.
Shared hardlinks remain ineligible. Interrupted build-output cleanup resumes
the exact original file subset and refuses new or changed entries. Operation
results expose the removal receipt, while artifact provenance, retained signed
archives, request replay and Git retention references remain independent.

The native Settings → Storage view exposes both cleanup categories and raw-log policy/usage. Errors after retained partial removal carry `requestRetained: true`, the original request identity and a concrete resume action. The client keeps that request through early maintenance refusals as well as file/dependency failures; it clears it only after confirmed completion. This does not label every error an uncertain effect: the response still explains the actual blocking condition.

Accepted incoming transfer reservations are released only after a confirmed removal tombstone. Missing archive files alone never release quota. Historical begin/finish replies still return the completion receipt after expiration; a new install or transfer using unavailable output returns `ARTIFACT_EXPIRED`. Artifact listings and operation output metadata make expiration visible without rewriting the original evidence.

Current limits: the generated-output census handles at most 10,000 operations, 50,000 entries per directory, 32 directory levels and 4 GiB per candidate. Checkout cleanup also requires a complete dependency census of at most 10,000 operations. Larger or uncertain output stays protected. Summary compaction, unconfirmed build output, Git retention release and payload cleanup remain separate unfinished work. Cleanup does not imply that all retained sources can expire; managed-data accounting below separately limits new admission and dispatch.

`tests/storage.test.mjs`, `tests/retention.test.mjs`, `tests/owned-worktrees.test.mjs`, `tests/build-output.test.mjs` and `tests/device-transfer.test.mjs` cover terminal/pinned/unresolved decisions, stale selections, links, partial recovery, receipt replay and quota release in disposable fixtures. They do not provide physical device evidence.

## Completed update backups

New online SQLite backups retain directory ownership before creation and seal
their exact files after integrity verification. SQLite finalizes each owned
copy in standalone journal mode before hashing, so reading it does not require
WAL/SHM sidecars. The live journal remains in WAL mode. The digest is streamed
with bounded memory, and the receipt remains in the active journal.

The regular reviewed cleanup can remove an old sealed backup only after its
maintenance window completed and `summaryDays` elapsed (365 days by default).
Two newer complete backups from the same host and schema must remain, with
event/operation coverage at least as recent as the selected copy. Both retained
copies are independently rehashed before accepting cleanup. Generation ordering
comes from the journal, not the wall clock. Pinned, unfinished, interrupted,
unacknowledged peer work, potentially live retained processes and held
maintenance block backup cleanup. No automatic backup eviction or restoration
occurs.

Unknown older backups, unfinished creation, modified files, links, replacements
and incomplete update receipts stay protected. A stale review, changed policy
or damaged newer backup stops removal. Partial cleanup uses the same retained
request and unchanged remaining file subset; new files are preserved. Backup
receipts and explicit removal tombstones remain readable after bytes expire.
The census allows at most 1,000 backup creation records; larger inventories
require a future paged implementation. `tests/backup-retention.test.mjs` and
the existing maintenance fixtures verify these rules using disposable SQLite
data, without installing or updating the application.

## Managed-data accounting and admission

The separate private [storage-policy contract](../packages/contracts/schemas/storage-policy.schema.json) adds a managed-data limit without changing the original machine schema or `maxLogBytes` semantics. Its initial limit is 10 GiB. Read the policy and current usage, then apply an explicit revision-bound change:

```sh
contribution service storage-policy --json
contribution service storage-policy --file reviewed-storage-policy.json --expected-revision REVISION --request-id REQUEST_UUID --json
```

The policy file contains `schemaVersion: 1` and `maxStateBytes`, an exact integer from 1 MiB through the maximum safe JSON integer. A repeated request returns its original result; a changed request or stale revision is rejected. The settings write and receipt share one SQLite transaction. Raising this limit remains available when managed data is full. An update maintenance hold permits policy reads but prevents changes.

The read-only census counts logical sizes under Contribution’s private support directory: the journal and WAL, logs, retained payloads, backups, Git bundles, generated build/checkouts and unknown files. Hard-linked paths each count their logical size, and directories and symlink entries count their own sizes. Symbolic-link targets are not traversed. This is conservative logical accounting, not APFS allocated-space measurement. Source repositories and their Git object stores, external link targets, external application bundles and user-selected external exports remain outside this boundary.

A census is bounded to 200,000 entries, 32 directory levels and two seconds. Missing/replaced directories, inaccessible state or an exceeded bound produce an explicit incomplete observation and block new admissions. An incomplete observation never means zero usage, and raising the limit does not override an incomplete census. Unknown retained files count toward the cap but do not thereby become eligible for deletion.

The shared journal checks this limit before new operations. New project creation, committed-source capture and incoming Git/artifact reservations check before creating their corresponding state. The scheduler also holds already queued repository/device work while storage pressure persists, preserving its identity and position. Settings controls can reconcile the limit while normal processing is paused; cleanup and a policy increase recheck the queue. A held queue also rechecks at a bounded 30-second interval. The main view explains that storage needs attention.

This is an admission and dispatch limit, not an OS filesystem quota. Already running effects, already accepted bounded transfers and durable recovery/lifecycle records can add output beyond it. Their evidence remains protected. Eligible removal still uses the reviewed cleanup commands; the cap never authorizes deletion of unknown, pinned or unresolved state. Bounding remaining producers and summary/retention-reference compaction remain separate implementation work.

Native Settings → Storage shows the managed-data policy and categorized usage separately from raw-log retention. Storage setting requests have a separate restricted native continuation slot, so a cap increase can be retained and reconciled while the original operation’s reply remains unresolved. Neither request overwrites the other. The slot accepts only the storage-policy and machine-settings control commands; repository and device operations cannot use it. The current controls change retention fields only.

`tests/managed-storage.test.mjs` proves category accounting, external-link isolation, unknown/shared-file treatment, incomplete observations, strict policy/revision semantics, pressure recovery, immutable replay and queued dispatch. The original twelve schema imports remain unchanged; the maintained contract registry now contains fourteen schemas including the earlier device-profile extension.
