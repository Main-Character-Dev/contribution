# Installed payload and lifecycle

The packaged app contains `Contents/Library/ContributionService` and `Contents/MacOS/contribution`. Both are native launchers. They verify the allowlisted engine manifest and every file before copying to the current user's private `Library/Application Support/Contribution/Payloads/<manifest-sha256>` directory. Only a complete, fsynced, verified staging copy is published by atomic rename. Files are read-only and the runtime executable has owner-only execution permission. A damaged retained payload is reported, never silently overwritten.

The engine and its runtime execute at absolute paths within that retained directory. Replacing or moving the app does not change an already running attempt. Old payloads and interrupted staging copies remain retained until dependency-aware lifecycle cleanup is implemented; ordinary log pruning never removes them. Manifest validation is integrity checking, not a substitute for release code signing and notarization.

Settings exposes explicit service registration through `SMAppService` and CLI installation at `~/.local/bin/contribution`. The CLI installer refuses an occupied path and removes only the symlink matching its installation receipt. Add `~/.local/bin` to the shell's PATH. These controls require the packaged app. They have been exercised in temporary fixture homes only.

`service restart --when-idle` refuses active jobs, peer transfers, unresolved effect uncertainty, owned phone sessions and unconfirmed backend workers. Direct restart and update requests use the same retained-session blockers as update maintenance; a refusal preserves the service and its pause/queue state. Once idle, restart closes the private socket and journal, releases the service lock and uses the pinned runtime's `execve` to replace the same service process. It does not create a second scheduler. Queued requests and the pause flag survive; startup revalidates the payload and reconciles retained effects. An ordinary termination drains without requesting restart. A service-lock acquisition interrupted during its short recovery critical section leaves an explicit repair block rather than guessing ownership.

The background service is a user agent. Pre-login execution is not provided. Actual post-login registration, owner approval, signing, app-update installation and physical-device teardown remain separate qualification. No launchd policy is changed to produce an endless restart loop.

Raw logs expire after the configured age (30 days by default) when a new durable request performs cleanup. `doctor` reports current bytes, protected bytes, eligible bytes and admission pressure. Every admission route uses the same cap; active output is bounded with visible truncation evidence. Pinned records, active/unresolved/interrupted operations and unacknowledged peer evidence are not evicted. An expired log returns `LOG_EXPIRED`; summaries and immutable replay identities remain. Automatic summary, remote-cache and artifact compaction remains pending, so this is not a claim of complete retention qualification.

Independent proof commands:

- `bash scripts/check-native-client.sh`: real Swift and Node clients share authenticated IPC, admission and retained results.
- `bash scripts/check-native-payload.sh`: simulated app replacement with a running older payload and damaged retained-file rejection, using a compile-time-only temporary support root.
- `bash scripts/dev.sh native:test`: contract projection and explicit CLI-link ownership tests in a disposable home.
- Node `lifecycle`, `bootstrap-recovery`, `configuration-recovery` and `journal` tests cover queued restart, private socket checks, partial files, owner edits and atomic settings completion.
