# Retained output and cleanup

The service retains immutable request identities, operation results, artifact provenance and transfer receipts even after their generated output expires. A repeated request can report its original outcome; it does not repeat an install or transfer to regenerate expired bytes.

Raw attempt logs use the configured `rawLogDays` (30 by default) and `maxLogBytes` admission cap. Completed, unpinned logs may expire automatically; uncertain, interrupted, active and unacknowledged peer work remains protected. `doctor` reports protected usage and blocked admission. Individual running logs are bounded as well. A full protected cap still permits one retention-only settings request that matches the current revision and raises the cap above observed usage. That control request can complete while ordinary processing is paused; repository jobs remain paused. Other settings changes, stale revisions and a second pending recovery cannot use this exception. New project creation and source/history capture check storage pressure before creating repository or outbox state.

Generated signed artifacts and accepted incoming artifacts are eligible after 30 days. Original project gate output and its sealed private snapshots use `rawLogDays`. Cleanup requires an explicit review:

```sh
contribution service storage --preview --json
contribution service storage --scope-token PREVIEW_UUID --request-id REQUEST_UUID --json
```

The preview lists candidates, bytes, policy and protected entries without removing output. Execution rechecks the exact scope, file identities, operation state, pins and dependent queued or unresolved requests. Only positively owned generated directories are eligible. Unknown files, symlinks, shared hardlinks and changed output are preserved. Source worktrees, Git bundles and refs, backups, installed payloads, exports and the database are outside this cleanup boundary.

Removal retains its intent before deleting each reviewed path and keeps a tombstone for every output. A crash can leave a partial directory; resume with the same scope and request UUID. New files or dependencies stop recovery without removing them. A different request cannot take over the retained cleanup. A completed request returns its original result. Cleanup does not run during an update maintenance hold.

Contribution-owned build, generic candidate and adopted captured-source checkouts have a separate review:

```sh
contribution service storage --worktrees --preview --json
contribution service storage --worktrees --scope-token PREVIEW_UUID --request-id REQUEST_UUID --json
```

Only new checkouts with a complete creation record are eligible. The record binds their attempt, repository, retained commit ref, filesystem identities and Git administration directory. Native Codex worktrees, unknown directories and older unrecorded checkouts are excluded. Eligibility uses `rawLogDays` and requires a settled, unpinned, acknowledged attempt, no unresolved clone work, no potentially live retained process, detached retained history and a clean checkout. Untracked files, ignored files, locks, submodules, replaced paths and changed registration remain protected.

Execution rechecks the review and persists its cleanup intent before invoking `git worktree remove` without force. It never resets or cleans a source checkout. New jobs in affected clones wait while removal is unresolved; duplicate requests still return their original operations. After an interruption, resume the same cleanup request. An already absent checkout and administration directory complete the retained removal receipt; partial or replaced state requires inspection. New user files are preserved. Git retention refs and bundles remain available, and original operation receipts expose the checkout expiration. Build products outside the source checkout are not removed by this command.

The native Settings → Storage view exposes both cleanup categories and raw-log policy/usage. Errors after retained partial removal carry `requestRetained: true`, the original request identity and a concrete resume action. The client keeps that request through early maintenance refusals as well as file/dependency failures; it clears it only after confirmed completion. This does not label every error an uncertain effect: the response still explains the actual blocking condition.

Accepted incoming transfer reservations are released only after a confirmed removal tombstone. Missing archive files alone never release quota. Historical begin/finish replies still return the completion receipt after expiration; a new install or transfer using unavailable output returns `ARTIFACT_EXPIRED`. Artifact listings and operation output metadata make expiration visible without rewriting the original evidence.

Current limits: the generated-output census handles at most 10,000 operations, 50,000 entries per directory, 32 directory levels and 4 GiB per candidate. Checkout cleanup also requires a complete dependency census of at most 10,000 operations. Larger or uncertain output stays protected. Summary compaction, remaining build products, Git retention release, payload and backup cleanup remain separate unfinished work. These commands do not imply that all service storage is capped or expired.

`tests/storage.test.mjs`, `tests/retention.test.mjs`, `tests/owned-worktrees.test.mjs` and `tests/device-transfer.test.mjs` cover terminal/pinned/unresolved decisions, stale selections, links, partial recovery, receipt replay and quota release in disposable fixtures. They do not provide physical device evidence.
