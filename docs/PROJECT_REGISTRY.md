# Paired project discovery

Paired hosts exchange a small catalog of intentionally enrolled projects. Each summary contains the stable project identity, name, branch, policy digest, adapter, gate activation and reported host role. Absolute paths, remotes, check commands, credentials, private adoption snapshots and source files never enter this catalog. A received summary does not enroll a checkout, run setup, replace configuration or establish writer authority.

The native sidebar shows projects requiring a local checkout and configuration differences between Macs. **Select local clone** binds an explicitly chosen existing checkout only if its tracked `contribution.json` identity/revision and integration branch match the reviewed offer. An existing mapping is revalidated. A missing or different configuration leaves the clone untouched. Use the normal approved clone or empty-history enrollment workflow to prepare an absent checkout first. This catalog does not implement automatic cloning or transfer a policy file.

```sh
contribution hosts sync --host HOST
contribution repos list --json
contribution repos resolve /absolute/local/clone --repo REPO --host HOST --expected-revision REVISION
```

Pairing performs an initial exchange; the service periodically retries through verified SSH. Each sending journal retains a monotonically increasing generation and digest. The receiving journal rejects older generations, same-generation rewrites, duplicate identities, unexpected fields and oversized catalogs. Lost replies retry the same retained content. Exchanges are serialized per host, with bounded backoff; queued core work is processed before background discovery. Pause and update maintenance stop automatic exchanges.

`hosts list` and explicit sync report `pending` or `acknowledged`. Acknowledgment describes metadata delivery, never project setup. `repos list` includes timestamped peer rows with `checkout_required`, `mapped`, `configuration_conflict` or `removed_on_peer`. Configuration conflicts remain explicit until local policy is reviewed separately. Removing a project on one host never unenrolls or deletes its clone on another. Up to 1,000 recently removed summaries are retained for visibility; each active catalog is limited to 1,000 projects and 512 KiB.

Five focused fixture groups prove discovery privacy, offline/lost-reply recovery, exact local mapping, preserved policy conflicts, stale/forged catalog rejection and receiving-journal restart. Existing two-host history/authority fixtures and the unsigned native build also pass. Actual SSH, GUI interaction, clone setup and installation remain separate qualification.

## Local folder discovery

The native sidebar and Settings → Repositories offer **Find repositories**. Selecting a folder starts a read-only engine scan; adding each result remains an explicit action. Existing enrollment is shown by Git common-directory identity. Unborn history remains visible, detached task checkouts are identified and cannot be enrolled from this view, and original project policies remain authoritative on enrollment.

`repos discover --root PATH --json` retains its repository array and adds a scan report. It streams directory entries, skips hidden/dependency/library folders and symbolic directory entries, and bounds work to depth three, 250 directories, 10,000 entries and ten seconds. One inaccessible folder does not discard already discovered results. Directory/entry/depth/deadline limits, unreadable folders and invalid Git folders are reported explicitly. A cancelled or superseded native scan cannot replace a newer selection. Scanning neither enrolls repositories nor creates project files or hooks.
