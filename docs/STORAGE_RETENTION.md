# Retained output and cleanup

The service retains immutable request identities, operation results, artifact provenance and transfer receipts even after their generated output expires. A repeated request can report its original outcome; it does not repeat an install or transfer to regenerate expired bytes.

Raw attempt logs use the configured `rawLogDays` (30 by default) and `maxLogBytes` admission cap. Completed, unpinned logs may expire automatically; uncertain, interrupted, active and unacknowledged peer work remains protected. `doctor` reports protected usage and blocked admission. Individual running logs are bounded as well.

Generated signed artifacts and accepted incoming artifacts are eligible after 30 days. Original project gate output and its sealed private snapshots use `rawLogDays`. Cleanup requires an explicit review:

```sh
contribution service storage --preview --json
contribution service storage --scope-token PREVIEW_UUID --request-id REQUEST_UUID --json
```

The preview lists candidates, bytes, policy and protected entries without removing output. Execution rechecks the exact scope, file identities, operation state, pins and dependent queued or unresolved requests. Only positively owned generated directories are eligible. Unknown files, symlinks, shared hardlinks and changed output are preserved. Source worktrees, Git bundles and refs, backups, installed payloads, exports and the database are outside this cleanup boundary.

Removal retains its intent before deleting each reviewed path and keeps a tombstone for every output. A crash can leave a partial directory; resume with the same scope and request UUID. New files or dependencies stop recovery without removing them. A different request cannot take over the retained cleanup. A completed request returns its original result. Cleanup does not run during an update maintenance hold.

Accepted incoming transfer reservations are released only after a confirmed removal tombstone. Missing archive files alone never release quota. Historical begin/finish replies still return the completion receipt after expiration; a new install or transfer using unavailable output returns `ARTIFACT_EXPIRED`. Artifact listings and operation output metadata make expiration visible without rewriting the original evidence.

Current limits: this output census handles at most 10,000 operations, 50,000 entries per directory, 32 directory levels and 4 GiB per candidate. Larger or uncertain output stays protected. Summary compaction, build-source worktree disposal, Git retention release, payload and backup cleanup remain separate unfinished work. This command does not imply that their storage is capped or expired.

`tests/storage.test.mjs`, `tests/retention.test.mjs` and `tests/device-transfer.test.mjs` cover terminal/pinned/unresolved decisions, stale selections, links, partial recovery, receipt replay and quota release in disposable fixtures. They do not provide physical device evidence.
