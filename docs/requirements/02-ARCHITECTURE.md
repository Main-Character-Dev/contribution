# Contribution architecture

> Maintained requirement baseline, imported from package revision 2. Product implementation remains planned. The current next step is [S0 repository setup](../REPOSITORY_SETUP.md), bounded by the [setup prompt](../SETUP_PROMPT.md). [Review amendments](../REQUIREMENTS_REVIEW.md) clarify this baseline. Private source material remains external; see [provenance](../SOURCE_PACKAGE.md).

## 1. Purpose and ownership

Contribution is one Mac application and one shared execution engine for development work across repositories. In the paired setup, the Mac mini owns canonical integration and publication jobs while the MacBook Pro owns its local development work and a durable outbox. Both expose the same progress, retained results, and agent commands. A standalone or deliberately `this-mac` repository uses its local host as canonical owner and does not require Tailscale, SSH, or a peer.

This document owns process, persistence, transfer, execution, and update boundaries. [03-AGENT_CONTRACT.md](03-AGENT_CONTRACT.md) owns command names, request schemas, configuration fields, and machine-readable results. Use those definitions rather than inventing parallel interfaces from the conceptual names below.

The following decisions are fixed:

- Native Codex owns its worktrees, project registration, and supported chat or host handoff.
- Contribution coordinates completed Git history. It does not synchronize live working directories or private Codex databases.
- One designated host owns each repository's canonical active branch. The paired owner is the Mini, and deliberate local-only repositories retain local ownership.
- Repository adapters retain check definitions, attribution rules, native reconciliation, and release policy.
- The UI and CLI submit the same operations to the same service. Neither implements a second scheduler or validation engine.
- A submitted task, an integrated task, a passing gate, a delivered push, and a merge-ready PR are different results.
- Remote Devices is an optional module of this same application and service. Its selected execution host may be either Mac, independently of the repository's canonical Git owner.
- Project adapters own build inputs, app identity, signing, data migrations, and product authority. Contribution owns reusable device transport, operation supervision, retained evidence, and recovery.

The audit (private reference; see [source package](../SOURCE_PACKAGE.md)) is the migration baseline, not a fresh host inventory. It intentionally excluded the Mini. Recheck current source and installed behavior during implementation without reopening settled product decisions.

## 2. Application, engine, and installed releases

Build a native SwiftUI application with a menu-bar surface and a full window. Swift owns presentation, notifications, platform integration, and the updater. Retain and extract the existing Node/JavaScript workflow mechanisms instead of rewriting their Git behavior in Swift. Add typed contracts and focused modules around those mechanisms as they move into Contribution.

Ship a pinned Node runtime with the application. The engine must start without a login shell, Homebrew, or a globally selected Node version. Bundle its dependencies and record the runtime and engine digests in the release manifest. Sign and verify executable components as part of the app distribution. Qualify the actual Node build and required hardened-runtime settings rather than weakening the entire application to make it launch.

The engine runtime and a repository's build runtime are separate. Repository adapters select the repository's pinned Node, pnpm, Python, or native tools. Do not run a project's commands under Contribution's Node simply because that executable is available. The audited repositories have materially different pins. Audit: runtime inventory (private reference; see [source package](../SOURCE_PACKAGE.md)).

Each released app carries an immutable engine payload. Materialize verified payloads in Contribution's managed installation area by version and digest. Durable request acceptance freezes source, destination, and policy semantics. An execution attempt resolves one absolute payload location when it actually starts and retains that executable throughout the attempt. Compatible queued requests can therefore survive an update without requiring an older worker to read a newer database. They never load engine code from Contribution's editable source checkout or follow a changing executable pointer halfway through a run.

There is one release channel for the app and its engine. Do not introduce an independent engine downloader. Retain the previous compatible payload for rollback, then remove older payloads only when no job or recovery record depends on them.

The stable CLI entry point locates the installed service and reports compatibility problems clearly. Its installation location follows the agent contract. An application repository depends on that installed interface, not a relative path into another source repository. Version reporting, read-only installation diagnosis, service-status inspection, and explicit service installation or repair have a thin installed platform-bootstrap path that works before the service is available. This path never starts a second scheduler or opens a competing database writer.

## 3. One user service per Mac

Register a bundled user background service through Apple's supported Service Management APIs. Use `SMAppService` for application-owned registration and expose actual registration status in Settings. Do not install a root daemon or write a collection of unmanaged launch jobs. Apple documents app-bundled agents and user-visible controls through this API. [Apple: login and background items](https://developer.apple.com/videos/play/wwdc2022/10096/), [SMAppService](https://developer.apple.com/documentation/servicemanagement/smappservice).

The service owns the engine, SQLite connection, scheduling, subprocess supervision, transfer retries, and remote-status polling. It also supervises any enabled Remote Devices sessions and backend children. There is no separate device daemon, scheduler, database writer, or login item. Closing the window or menu-bar interface does not cancel accepted work. Pausing processing, disabling background operation, and quitting the interface must have distinct behavior.

Use a private local Unix-domain socket for bounded requests and event subscriptions. Keep it in a short, user-owned runtime location with restrictive permissions. The CLI, UI, and SSH entry point all use that endpoint. Validate caller ownership, message size, and contract version. Never expose an unauthenticated HTTP control port merely to make the UI convenient.

The Swift platform helper remains thin. It handles service registration and macOS integration while the shared engine makes workflow decisions. A disconnected UI reconnects using an event cursor. It does not infer completion from whether its subprocess or window remains open.

An SSH session on the Mini only submits, queries, or streams a request. The installed user service owns the long-running work. Laptop sleep and SSH disconnection therefore do not terminate an acknowledged Mini job.

The initial availability promise is operation within the configured user's available session. Login after reboot, FileVault unlock, Keychain access, and foreground native-tool requirements need actual installation qualification. Report an unavailable session accurately. Do not claim pre-login operation or install an elevated service to conceal that limitation.

Prevent restart storms with bounded recovery and a retained failure reason. A missing executable or invalid installation is a stopped configuration problem, not a reason to launch thousands of identical failures. The audit found precisely that failure pattern in older unrelated jobs. Audit: existing background jobs (private reference; see [source package](../SOURCE_PACKAGE.md)).

## 4. Durable state and logs

Each Mac has its own local SQLite database under Contribution's application-support directory. The service is its only writer. Use WAL, explicit transactions, a bounded busy timeout, and durability appropriate to acknowledged queue records, including full synchronization for those commits. Keep the database on local storage. SQLite documents that WAL does not support cross-host access over a network filesystem. [SQLite WAL](https://www.sqlite.org/wal.html).

Store enrollment, authority, immutable request identities, queue order, attempts, check results, transfer state, receipt references, remote observations, and notification cursors as structured metadata. Store large output in separate per-attempt log files. A result links to the exact logs and artifacts that produced it.

Remote Devices extends this journal with approved host/device/project associations, version-qualified capabilities, session ownership, artifact provenance, intended device effects, observed readback, and reconciliation. Pairing secrets and signing keys remain in their approved system/private stores. SQLite contains opaque references and redacted metadata, not exported credentials. Device effects and the journal cannot commit atomically. Record intent before dispatch and observed effects afterward, retaining uncertainty across a lost connection or service restart.

Every attempt has independent storage from its first event. A latest-result pointer is only a view. It must never be the writable output file shared by concurrent attempts. The audit identifies existing log-clobbering paths in Main Character and Roboty. Audit: push progress (private reference; see [source package](../SOURCE_PACKAGE.md)).

Persist important transitions before publishing their events. Stream output in bounded batches rather than synchronously committing every line. Drain available subprocess output before recording a normal terminal result. On interruption, retain partial logs and the last confirmed phase without manufacturing a terminal success.

Return monotonically ordered events within the owning service, with stable attempt identities across reconnects. The MacBook caches Mini observations for offline viewing and records when they were last confirmed. Its cache is not another authority database.

Git objects, bundle files, and SQLite do not share one atomic transaction. Use retained operation intents and explicit recovery states around their boundaries. A crash after importing objects but before recording acceptance must be distinguishable from an accepted job. Reconcile that state from the retained manifest, bundle, and ref identities before sending an acknowledgment.

Apply documented retention separately to logs, summaries, and transfer artifacts. Never delete unresolved transfers, source retention refs, recovery evidence, or live-job dependencies to satisfy an ordinary log quota. Stop new durable admissions with an actionable storage error if necessary. Back up metadata through a SQLite-supported backup operation, not by copying only its main file while it is live.

## 5. Repository enrollment and native Codex

Enrollment identifies the logical Git repository, its checkout on each host, canonical owner, active integration branch, publication destination, and adapter. Paths are machine-local configuration. Do not hard-code a user's home directory, assume every branch is `main`, or identify native worktrees by a literal directory substring.

The audited active branches differ across all four projects, and Roboty has no observed remote `main`. Resolve actual configuration and Git identity. Audit: branch topology (private reference; see [source package](../SOURCE_PACKAGE.md)).

Native Codex creates and manages task worktrees using its supported interfaces. Contribution can record supported native references and expose its commands through documented project actions. It must not manipulate chat storage, worktree archives, or project-registration databases. If native registration requires a one-time app action, report that specific remaining action while completing supported enrollment steps.

New repositories start in Local development with a small configuration and the checks they actually define. An absent check plan is unconfigured, not passed. Existing repositories retain their current enabled checks until an explicit, separately verified policy migration changes them. Enrollment must not activate Glass Alpha's dormant gate or Roboty's launch-stage validation.

New-project creation makes a minimal bootstrap commit on `dev` containing only Contribution-generated metadata and workflow guidance. Use the configured Git author identity and stop with a setup action if it is unavailable. Do not invent an identity, stage product files, or include unrelated existing content. Existing unborn repositories remain unchanged until the explicit initialization operation defined in the agent contract creates their bootstrap commit. Respect pre-existing files and report conflicts rather than overwriting them.

For paired repositories, the bootstrap reaches the Mini through a special enrollment seed import. Accept that seed only when the enrolled target has no existing history and no conflicting files. Retain its exact Git objects, establish the initial branch without overwrite, and persist an idempotent receipt before acknowledgment. Recovery distinguishes an already accepted identical seed from unrelated existing history. It never imports a second root over a live repository. This enrollment transaction precedes ordinary submissions that require a real base commit. Local tasks may be captured against the retained bootstrap while offline, but their Mini integration waits for the seed receipt. A local-only repository can use its bootstrap immediately without peer transfer.

Availability and ownership are resolved per repository. `both-macs` uses the paired primary, while `this-mac` means deliberately local ownership without expected handoff. Re-enrollment cannot silently change an existing owner. Changing canonical ownership requires an explicit migration that reconciles histories and disables the old owner's mutation route. Loss of the Mini does not elect the laptop automatically. Local task work can continue offline without creating two canonical histories.

## 6. Completed-work transfer through retained Git bundles

For paired repositories, use ordinary macOS SSH over Tailscale for peer transport. Tailscale supplies private connectivity. SSH supplies verified host identity and authenticated command execution. Do not require Tailscale SSH server mode, whose macOS support depends on the client variant. A local-only repository bypasses peer transport and uses the local admission path. [Tailscale: SSH comparison](https://tailscale.com/docs/features/tailscale-ssh).

Transfer committed task snapshots through retained Git bundles and a small manifest. Git documents bundle creation, prerequisite verification, and fetching from a bundle. It does not provide working-directory synchronization through this mechanism. [Git bundle](https://git-scm.com/docs/git-bundle).

### Sender

The agent commits task-owned work through the existing repository policy. Contribution does not blanket-stage files, auto-stash unrelated changes, or manufacture an unfinished-work commit.

Capture the task's exact source commits, source base, intended integration branch, repository identity, and relevant attribution metadata. Capture an explicit combined integration message or other valid adapter-owned candidate metadata when required, using the agent contract. Missing required metadata produces a focused input requirement rather than a guessed message. Validate the source at capture and retain a local Git ref so cleanup cannot make its objects unreachable. Create a bundle from those immutable identities, verify it locally, then save the manifest, bundle digest, and outbox record before reporting queued work.

Incremental bundles may exclude only prerequisites the receiver is expected to possess from a confirmed exchange. An unavailable prerequisite causes an explicit request for additional objects or a self-contained replacement bundle. Repackaging the same source snapshot may change transport bytes without creating a second logical task.

The outbox survives restarts and network loss. Retry transport with the same logical request identity. Do not recapture a moving branch or add newer commits during a retry. Subsequent edits and commits remain a separate submission.

### Receiver

Upload into a private staging location through a fixed installed SSH entry point. Send structured data through stdin instead of interpolating repository paths or task text into a remote shell command. Verify the manifest, digest, repository association, permitted refs, supported object format, and bundle prerequisites before admission.

Import only the declared source into a dedicated incoming ref namespace. Never update the checked-out primary as part of receipt. Do not execute code contained in an incoming bundle merely to inspect it. Unexpected refs, missing prerequisites, and inconsistent source identities are rejected with specific reasons.

Record the retained source and queue item durably, then acknowledge the exact request. Repeated submission of the same request and source returns its existing state. Reusing that identity for different source content is an error. Recovery checks for already imported refs and existing queue records before repeating any operation.

An acknowledgment means the Mini retained the task. It does not mean integration or publication succeeded. Keep sender retention through the documented landed-receipt exchange and preserve the native source lifecycle. Never interpret acknowledgment as permission to delete the only remaining copy of unfinished work.

Remote Devices reuses this authenticated request and retained-transfer machinery for a selected immutable signed artifact when its build and installation hosts differ. Use a device-artifact manifest and private staging area, not a Git bundle containing app binaries or credentials. Verify its digest, size, app identity, signature, and provisioning at the receiving boundary before admitting installation. Resume or deduplicate the same artifact transfer without rebuilding or changing its identity. This is a narrow artifact route, not general filesystem synchronization.

This is an at-least-once transport with idempotent admission. It is not a claim of universally exactly-once execution. No ordinary Git push is used for peer handoff, so transferring work cannot accidentally invoke the expensive GitHub publication gate. The audit documents that risk in the current hooks. Audit: two-Mac transfer considerations (private reference; see [source package](../SOURCE_PACKAGE.md)).

Git LFS content, submodule repositories, ignored files, and external runtime state need explicit adapter support. Detect unsupported requirements and stop that task with a clear reason. Do not silently copy credentials, databases, native caches, or Roboty experiment data as extra bundle contents.

## 7. Imported-source landing

### Default adapter for new projects

The `generic-v1` adapter uses the shared provisional-landing mechanism for newly created repositories. Require a declared base that is an ancestor of the submitted tip and a captured task range whose ownership can be established. Prepare the task's combined changes against the current canonical target in an isolated candidate. Produce one integration commit per completed task, preserving the source-to-landed mapping. Do not run a broad publication suite during this landing.

For a single source commit, retain its author and author timestamp and use its message unless explicit validated integration metadata supplies another message. For several source commits, require one original author identity and an explicit combined integration message. Multiple author dates are allowed for this new-project default, with the submitted tip's original author timestamp retained. Use the canonical repository's configured Git committer identity. Missing identity or message is an input requirement, not permission to fabricate metadata. These defaults do not change the stricter adopted repository adapters.

Conflicts, unsupported source topology, or unclear ownership retain the candidate and request focused resolution. An already integrated source is reported through its existing receipt rather than applied again. Candidate preparation can be retried against an advanced target, but primary promotion still verifies the exact candidate, target, branch, and clean checkout under the shared lease. Initially support ordinary Git repositories. Unsupported LFS, submodule, or special reconciliation needs are explicit adapter limitations.

### Adopted and remote source adapters

Extract common landing-flight, process-identity, lease, and subprocess mechanisms after parity verification. Keep repository-specific behavior in adapters. The current workers require a local source path, create a provisional integration, and recheck exact identities before advancing primary. They cannot consume a MacBook path from the Mini unchanged. Audit: lifecycle trace (private reference; see [source package](../SOURCE_PACKAGE.md)).

Add an imported-source adapter whose authority is the sealed incoming snapshot. It materializes a Mini-local integration source when the existing worker needs files and uses Contribution's own temporary-checkout lifecycle for that materialization. It must not forge a native Codex registration or claim ownership based on a directory name.

The receiving adapter verifies the declared commit set, source base, author rules, required metadata, introduced-history protections, and applicable exact-source review evidence. Sender-supplied receipts are evidence inputs, not permission to bypass receiver admission. Cross-host deterministic receipt reuse requires the same established input and environment contract, not simply a matching commit SHA.

Preserve Mathy's approved multi-date attribution behavior and the other repositories' current restrictions until policy deliberately changes. Preserve exact provisional commit and tree checks, conflict parking, supersession semantics, and Mathy's dependency, Pod, and Xcode reconciliation. Do not reduce all four workers to a generic unchecked merge.

Under the existing primary mutation lease, recheck active branch, target commit, cleanliness, and candidate identity before promotion. If primary moved while preparation ran, use the existing bounded reprepare/defer behavior. Integration conflicts become explicit retained candidates for an agent to resolve. The background service does not call a model to guess a resolution.

Remote landing checks the captured immutable source, not a live laptop directory that may be asleep. This is an explicit adaptation of source identity. A local native worktree that advances after capture remains newer work. A returned receipt cannot mark that newer checkout wholly integrated.

Record the exact mapping from source commits to provisional and landed commits. Integration may create a new commit, so ordinary ancestry alone does not always identify the source task as completed. Preserve the existing mark-integrated and resolution semantics through that mapping.

If promotion succeeds but native reconciliation fails, retain a distinct post-integration recovery state. Recover reconciliation against the recorded landed identity. Do not replay the integration or automatically reset primary.

## 8. Safe primary mirrors

For paired repositories, the MacBook's primary checkout is a mirror of canonical accepted history, not a second integration owner. Receive canonical commits and landing receipts through the same authenticated exchange, independently of unpublished task branches. A local-only repository retains its ordinary local canonical checkout instead of maintaining a peer mirror.

Fast-forward a mirror only when its configured branch is correct, its working tree and index are clean, no Git operation is underway, and the local mutation lease is available. Recheck immediately before mutation. All Contribution-controlled writers must honor that lease.

If the mirror contains unique commits, dirty files, or divergent history, retain both histories and report the exact condition. Do not reset, force-checkout, stash, delete worktrees, or select a winner by timestamp. An agent may submit identified local commits through normal admission, but Contribution cannot infer that unrelated work is complete.

Native task worktrees remain usable from their captured bases while the mirror advances. Offline work proceeds from the latest available base. Source synchronization does not migrate paired device identity, private experiment history, databases, or a running product service.

## 9. Queues, Push snapshots, and one gate invocation

The canonical host has one ordered mutation queue per repository. That host is the Mini for paired repositories and the local Mac for deliberately local-only repositories. Integration and publication share that order. Independent repositories may progress concurrently subject to host resource limits. Existing primary leases remain the final protection against other cooperating local entry points.

A Push preview returns an opaque `scopeToken` binding the selected repository, canonical active branch and exact tip, resolved destination identity and ref, and effective policy/configuration revision. The mutation requires that token and the expected tip defined in the agent contract. The UI and agent submit the scope they actually inspected. A token is a scope reference, not authorization to publish by itself. Resolve remote aliases to their actual destination identity when binding the preview, so changing an alias's URL cannot redirect an otherwise unchanged request.

Validate the token and expected tip at admission and execution. A destination or policy change rejects the selection even when the commit SHA is unchanged. Persist the validated scope with the accepted request and preserve it through retries. Request-id deduplication does not replace this preview-to-request check.

Before execution, recheck the selection. Earlier queued work or external mutation may have made it stale. Report that outcome and require a new selection instead of silently adding newer commits, rolling primary backward, or redirecting to another branch. Once an admitted Push starts, later same-repository landings wait until its transport result is recorded. Offline queued Push requests retain their original selection on reconnect.

The Push invocation owns the primary lease across validation and Git transport. Adapt existing hook lease acquisition to adopt the already owned invocation context after verifying the owning process, attempt, exact ref transaction, and lease token. Do not acquire the same non-reentrant lease twice. Do not replace it with an environment variable that blindly skips protection.

Run the publication gate once through the actual admitted Git invocation. The wrapper starts Git and captures its result. The pre-push adapter runs the enabled gate inside that invocation and streams its evidence. Do not run a full preparation gate and then trigger the identical gate again through Git.

Retain existing stdin handling, branch admission, final identity checks, runtime selection, and exit behavior. Ordinary integration publication and registered maintained-release routes remain separate. Do not broaden a repository's accepted ref transactions during reporting migration.

Capture Git's final exit and per-ref result. Check success followed by remote rejection is a failed push. Connection loss after possible acceptance is an uncertain delivery until a remote observation resolves it. Reconcile the intended commit against the destination before proposing a retry. Do not automatically repeat publication from an ambiguous outcome.

After paired authority cutover, the companion's ordinary pre-push path refuses direct publication and returns the supported Contribution route. It does not enqueue a remote push and then let the original local push continue. Contribution provides no bypass flag or alternative publication path around the canonical owner. These remain operational controls in a user-owned development environment, not a claim that Git hooks prevent a user from deliberately reconfiguring Git.

External pushes on the canonical host, including a standalone owner, remain hook-observed and must acquire the same primary lease when there is no verified managed-invocation context. A pre-push pass cannot prove delivery, and Git has no standard client post-push hook. A native Codex or other Git client's Push button is fully observed only if a documented integration supplies completion. Preserve the gate-only outcome when that signal is unavailable. Audit: outcome boundaries (private reference; see [source package](../SOURCE_PACKAGE.md)), [Git hooks](https://git-scm.com/docs/githooks).

## 10. Validation, status, and remote follow-up

Keep check planning and project commands in repository adapters while sharing execution, progress, timeouts, evidence storage, and compatible receipt plumbing. Local development uses configured inexpensive policy checks and focused task proof selected by agents. It does not automatically install a broad publication suite. It must not label an integrity-only gate as broad validation or silently skip a required check to meet a timing target.

Explicit checks identify their source and execution context. A local task check supplies `--source-path PATH` and runs on the current host, including while the Mini is offline. Verify that path belongs to the enrolled repository, then record its exact HEAD and applicable dirty-input fingerprint, check plan, and environment. Recheck relevant inputs before publishing reusable proof. If files change during execution, retain the observed result without presenting it as stable proof for a different tree.

A canonical check supplies `--canonical` and runs against the configured owner's checkout. The source selectors are mutually exclusive. When neither is supplied, infer only an unambiguous current local checkout as defined by the agent contract. Otherwise return a source-selection error. Never infer a switch to Mini execution merely because the caller supplied a repository ID. Local task checks, including successful focused checks, never imply completion of the publication gate.

Preserve distinctions between passed, failed, reused, unselected, inactive, cancelled, timed out, interrupted, and unknown results. A check profile does not itself authorize a release or satisfy a required GitHub rule. Audit: current validation policies (private reference; see [source package](../SOURCE_PACKAGE.md)).

Derive push-needed status from canonical Mini history versus the intended destination. Keep unfinished work, outbox backlog, landing backlog, unpublished commits, and failed CI separate. A missing destination branch needs first-publication status. A stale observation needs a timestamp. Remote divergence needs integration attention, not an automatic force push.

After confirmed delivery, the canonical host follows applicable GitHub checks and PR state using supported authenticated APIs. Match observations to exact commit and PR identities. Independently perform slow, bounded discovery of external pushes, PR updates, and manual or scheduled workflow activity for enrolled repositories, even when Contribution has no known push or PR. This creates tracked remote-only activity without inventing a local publication. Do not wait forever for a workflow that is not configured to run on that event. Required checks, review requirements, draft status, conflicts, and other applicable repository rules remain separate inputs to merge readiness.

A local pass does not turn GitHub CI green. A ready PR does not merge automatically. Refresh relevant remote state before any explicitly requested merge and preserve its expected head. Changes to the PR base or head can invalidate readiness. The command contract owns mutation authorization and error representation.

Notify on useful terminal outcomes and newly actionable failures, with a link to the exact retained attempt. Keep check progress inside that attempt rather than sending a notification per check. Reconnection restores missed results without replaying every historical toast. Notification permission or UI failure cannot change a gate result.

## 11. Authentication and execution boundaries

Use existing supported GitHub and SSH credential mechanisms where possible. Keep secrets in system credential storage or the user's configured credential helper, not repository configuration, bundle manifests, SQLite records, or logs. A queued operation that needs unavailable credentials waits with a clear authentication action instead of opening an invisible background prompt.

Verify SSH host identity and use noninteractive authentication for background work. A changed host key stops transfers until trust is deliberately repaired. Tailscale reachability does not replace SSH trust. The receiving command resolves enrolled repository IDs itself and rejects arbitrary filesystem destinations.

Run under the enrolled user's permissions. Repository checks are trusted development code and may start local services or native tools according to their policy. Contribution is not a hostile-code sandbox. Validate executable selection and argument boundaries, preserve scoped process environments, and never turn a received task into arbitrary shell text.

Keep registration, transport, local development, GitHub publication, PR merge, and application distribution as separate authorities. Persist the authorized request so normal continuation does not ask for repeated approval. A material change in source, destination, or operation invalidates that request rather than extending its scope invisibly.

For Remote Devices, approve the host, authenticated physical device, repository/app identity, and permitted operation. Tailscale membership, an SSH login, or a product's own app-to-Mac connection does not itself authorize installation, logs, tests, or debugging. Extend the fixed installed SSH entry point with allowlisted structured device requests. The local service independently validates enrollment, operation scope, request identity, and schema support. Never accept a remote shell fragment, arbitrary bundle uninstall, filesystem destination, or raw developer-service proxy. Normal local callers use the same private IPC endpoint.

The phone-only travel case needs a usable initiation path while the Mini remains at home. D0 must prove that a supported existing remote agent/Codex route can invoke the Mini's installed interface from that setup. If that route is absent, include a narrow authenticated private browser control surface in the existing service. It dispatches the same allowlisted versioned operations and exposes their retained progress. Protect it with application authorization as well as tailnet access, appropriate private HTTPS, request-origin/session controls, and revocation. It is not an additional daemon, arbitrary shell endpoint, or exposed Apple backend API. Browser control is in scope when needed for RDEV-26 and does not add a permanent iOS client.

Redact known credentials and credential-bearing URLs before writing logs. Do not export raw environment dumps or authentication output for diagnosis. Redaction is defense in depth, so adapters should avoid emitting secrets in the first place.

## 12. Failure and recovery

| Failure | Required recovery |
|---|---|
| Laptop sleeps before receiver acknowledgment | Keep the outbox and retained source, then retry the same request |
| Acknowledgment is lost | Query or resubmit the same identity and recover its existing receiver state |
| Mini restarts with queued work | Resume admitted queue records after checking installation and repository readiness |
| Service exits during a command | Verify process identity and retained operation state, then mark interrupted or reconcile proven effects |
| Primary promotion happened before receipt finalization | Compare recorded provisional and current Git identities before completing the receipt |
| Native reconciliation fails after landing | Recover that reconciliation stage without replaying the commit |
| Push connection fails after possible acceptance | Observe the intended destination before offering another publication |
| Database, disk, or log storage fails | Stop new unsafe admissions and retain a concrete storage failure |
| Peer version is incompatible | Preserve the outbox and request a compatible update, without downgrading the protocol silently |
| UI or notifications are unavailable | Continue accepted service work and retain normal CLI-visible evidence |
| Device connection drops after install or launch dispatch | Retain `outcome_unknown`, then observe the named effect before offering another mutation |
| Install is confirmed but launch fails | Keep the successful installation evidence and a separate failed launch effect |
| Previous device host is unreachable during transfer | Retain `previous_owner_unconfirmed` and block conflicting work until release or explicit recovery is established |
| Device or host authorization is revoked | Stop future privileged operations and invalidate readiness without creating replacement trust |

Use existing PID plus process-start identity when supervising children and reclaiming local leases. Never kill an arbitrary matching process name or assume a stale PID identifies the original worker. Cancellation targets only the owned job tree and preserves already completed external effects.

Restarting a service must not automatically rerun a failed gate, resolve a conflict, publish another ref, or submit a model task. Recovery distinguishes observation, safe repeatable preparation, and operations whose effects need reconciliation first.

## 13. Idle efficiency and shared resources

Wake work from submissions, process completion, relevant local changes, reconnects, and bounded timers. Debounce repository observations. Do not recursively poll every worktree or rebuild a global Git inventory every second. Watchers are hints followed by targeted Git reads, not proof of repository state.

Back off peer retries with jitter when offline. Use frequent detail polling only for unresolved tracked remote work, respect API limits, and slow down when nothing changes. Stop detail polling for terminal runs while retaining refresh-on-demand. Keep a separate slow repository-discovery pass to find external, manual, scheduled, or rerun activity that has no current local operation. Reuse SSH connections where supported without making their lifetime own jobs.

Retain existing named native build and simulator leases across repositories. Add a small host-level concurrency budget for heavy checks, with visible wait reasons. Keep ordinary metadata and transfer operations responsive while those resources are busy. Do not hold a global repository lock during a long native build.

Keep-awake behavior is an explicit host preference for accepted work. Do not disable sleep globally as a hidden installation action. The Mini's always-available role depends on its configured power, session, network, and native-tool readiness.

An enabled device session uses these same resource budgets, bounded backoff, and power preferences. Persist its remaining recovery budget across restart. Measure idle host CPU, traffic, phone battery impact, and warm-session survival before enabling persistent maintenance by default. Pausing or disabling the module stops automatic reconnection. A stream failure does not prove the outer developer session ended, and reconnection never triggers an unsolicited install or launch.

## 14. Updates and compatibility

Use Sparkle for signed application updates over HTTPS. Ship a signed and notarized application and signed update archives through the normal release process. Keep update signing keys separate from ordinary development execution. Sparkle's documented setup covers these distribution mechanisms. [Sparkle documentation](https://sparkle-project.org/documentation/).

Installation requires a service maintenance window. Stop new local admissions from starting, drain active jobs, finish durable writes, and stop the old helper before replacing its app bundle or activating another engine. Queued requests remain durable. Cancelling an update releases the maintenance window without changing them.

Queued requests retain their IDs and accepted source, destination, and policy scope across an update. Revalidate them under a compatible installed engine before starting an attempt, then pin that attempt's executable. An incompatible policy or contract revision waits or rejects with a specific explanation. It must not silently widen the request, discard its identity, or run an old worker against a migrated database merely because it was queued before the update.

Integrate Sparkle's supported delegate controls with this window. Do not assume delaying the visible app relaunch alone protects a separate helper or covers installation on quit. Qualify manual, automatic, and on-quit paths. Until all enabled paths respect service quiescence, restrict installation initiation to a held idle window and leave unsafe automatic installation modes disabled. [Sparkle updater delegate](https://sparkle-project.org/documentation/api-reference/Protocols/SPUUpdaterDelegate.html).

Perform database migrations transactionally after a supported backup and before starting new jobs. Prefer additive changes with a documented compatibility range. Retaining an old executable does not guarantee safe database downgrade. If rollback is incompatible, preserve data and enter a repairable stopped state rather than restoring an older database over accepted work.

The two Macs negotiate supported request and receipt versions. Exact app-version equality is unnecessary when the contract is compatible. An older client may view supported results without acquiring unsupported mutation capability. Update each host between its jobs, preserving pending transfers throughout.

Device backends ship through this same reviewed release boundary. Pin exact revisions and dependent tools after the D0/D1 investigation, retain their license notices, and requalify affected physical cases after a material macOS, Xcode, iOS, Tailscale, or backend change. Parse the actual versioned native JSON rather than assuming a previously observed CoreDevice field still exists. A maintenance window must reconcile active device mutations and release or retain known utility-owned sessions before replacement. Disabling an incompatible remote backend preserves standard local development.

Contribution's source repository is maintained through its own native Codex worktrees and installed stable tooling. Test a candidate engine explicitly in isolated fixtures. Committing or landing its source does not install that candidate into all projects. Promotion changes the installed release only after its own validation and authorized distribution step.

Revisit native Codex capabilities during deliberate upgrades. Replace custom adapters after verifying the supported native behavior covers current ownership and recovery requirements. Do not poll private app data or run a background system that rewrites workflows whenever Codex changes.

## 15. Implementation boundaries to prove

Before migrating real workflows, demonstrate durable admission across interrupted transfers, duplicate requests, source-to-landed receipt recovery, stale Push rejection, one gate execution, lease adoption without deadlock, transport failure after a local pass, and update deferral while jobs run. Preserve each repository's selected checks and activation during adapter extraction.

Qualify signed helper registration, notification delivery, SSH authentication, native-tool availability, and service recovery on the actual Macs during setup. These are installation proofs, not reasons to expand Contribution into a general remote-computing platform. The implementation plan owns sequencing and acceptance evidence.

## 16. Optional Remote Devices module

The full requirement set and physical acceptance crosswalk live in [08-REMOTE_IPHONE_DEVELOPMENT.md](08-REMOTE_IPHONE_DEVELOPMENT.md). The shared implementation sequence is D0 through D4 in [05-IMPLEMENTATION_PLAN.md](05-IMPLEMENTATION_PLAN.md). This section fixes ownership and execution boundaries. No device, signing, network, or app-data acceptance is claimed by this package.

### Execution host and project ownership

Both Macs are independently provisioned. Either may prepare a build or operate the phone while the other is unavailable. Selecting the MacBook for device work does not transfer the Mini's canonical Git integration authority. A project adapter still selects the exact allowed source, configuration, team, bundle identity, entitlements, and build number. It can require its clean primary branch or a separately authorized source. The shared service cannot relax that rule because another Mac has a reachable phone.

Roboty is the first consumer. Preserve its existing exact-input artifact checks, in-place update route, native-session guards, and foreground/pending-operation policy. Its app-to-Mac connection and Apple developer connection are distinct. Device operations do not authorize physical robot actions, product workspaces/history migration, release activation, TestFlight, or Git publication. Other project adapters retain their own policies.

Preparation returns an immutable signed artifact and provenance independently of phone reachability. Its receipt records the producing host, source/tree/input identity, configuration and adapter revision, toolchain, signed app identity, provisioning checks, artifact digest, and time. The receiver can verify an artifact without possessing the producer's signing private key. Each Mac obtains its own approved signing and pairing setup. Neither general sync nor device transfer copies private signing or Apple pairing material.

### Initial backend boundary

Use the existing Xcode/CoreDevice route as the native local/USB baseline and for network operations it actually supports. Keep native Xcode pairings intact. A remote address appearing in an inventory or an expanded transport allowlist does not create the required trusted Apple connection.

Select **go-ios as the initial remote backend prototype**, behind a small internal operation adapter. Its MIT license makes it the preferred first reuse candidate, subject to pinned-revision, dependency, packaging, and actual-device review. It is not yet a production remote-support claim. Review `pymobiledevice3` separately as a GPL-3.0-or-later research and compatibility reference. Do not bundle it into the baseline or assume that invoking a separate process removes redistribution obligations. [go-ios](https://github.com/danielpaulus/go-ios), [pymobiledevice3](https://github.com/doronz88/pymobiledevice3), [source and licensing decisions](07-SOURCES_AND_DECISIONS.md).

Prefer a supervised userspace route when the selected backend can supply one. The D1 spike must use its declared method and report any missing privilege or conflicting native session. It must not silently switch into a root/native tunnel, stop unrelated Apple daemons, or install another persistent helper to make a test pass. If a specific operation requires elevation, document the narrow API, actual reason, signing/distribution implications, and proof before adopting an additional privileged boundary. Do not run the application or arbitrary project commands as root.

Keep the interface small: discover/verify, connect, prepare, install, launch, logs, scoped test/UI/debug, disconnect, and reconcile. These are internal implementations behind the same operation engine. There is no general plugin marketplace, distributed lock service, or parallel orchestration framework. Exact installed backend versions are release inputs, not mutable global Python/Homebrew dependencies.

D0 inventories both actual hosts, phone, signing identity, and supported bootstrap paths. D1 proves a basic authenticated remote Wi-Fi operation, then immediately tests fresh cellular initiation after deliberate session close and phone/Mac restart. Investigate early, before investing in the full interface. Warm cellular survival and cold cellular establishment have separate evidence keys. A timeout establishes the observed failed phase, not an unsupported claim that Wi-Fi is required.

First proof uses `devices qualify` through the shared service and journal. Its registered plan binds the AT case, owner-approved test-app/data fixture, exact context, named operations, and bounded attempts/duration. This explicit qualification intent can investigate unverified capability while routine operations remain unavailable. It does not bypass trust, signature, app identity, ownership, or uncertain-effect guards, and it cannot silently promote its result into supported capability. The same route qualifies later logs/test/UI/debug operations independently in D3.

### Capability and readiness

Record support per operation, backend/version, host/toolchain, phone/iOS, signing method, bootstrap, and tested network context. Network context distinguishes shared Wi-Fi, different Wi-Fi, isolated guest Wi-Fi, tethering, warm cellular, cold cellular, and direct versus relayed tailnet routes. An unobserved field is unknown. Do not copy Roboty's historical local Xcode observation into either Mac's inventory.

Support uses `unverified`, `supported`, `unsupported`, or `requires_action`. Current availability separately evaluates host/network, authenticated trust, Apple service/session, qualified operation, and ownership. A capability with past physical proof can be temporarily unavailable on a locked phone. A reachable device can have no qualified install path. Publish timestamps and evidence references rather than collapsing these states into a green connection badge.

An installation is confirmed only by the chosen device's supported identity/version/build readback or another documented device-side confirmation. Preserve what the tool actually observed. The artifact's SHA-256 is preparation/transfer evidence. It is not a phone-side executable measurement when the backend cannot read that measurement. Installation success does not prove launch, logs, data retention, tests, or an Xcode Run destination.

### Device operation ownership and recovery

The current selected host owns the device operation record and serializes incompatible work through the existing service resource/lease mechanism. That resource covers the phone across repositories and known local Xcode/test sessions. Independent builds can use normal host build leases without reserving the device for their entire duration. Check current ownership and project session rules before dispatch. An external session the service cannot safely identify or release produces a busy/unknown result, not a process kill.

Host transfer is explicit. Normally the former host stops new device work, reconciles active effects, releases its utility-owned session, persists its released state, and returns a retained release receipt. The next host consumes that receipt and verifies its own trust, current device state, and authorization. A release can be prepared while the former host is online and consumed later, so ordinary operation does not require both Macs to stay running.

If the former host cannot be reached and no usable release is available, retain `previous_owner_unconfirmed`. Lease expiration only describes a local observation and does not fence a phone session or prove the old worker stopped. Recovery requires evidence that prior automation cannot continue, reconciliation of the specific prior operation, and an explicit ownership transition. Keep conflicting mutations blocked when that cannot be established. Document any owner action needed to stop/disable the former service. Do not claim strong fencing against unknown external Apple sessions or use automatic election to hide this limit. A host that has released or lost authorization must not restart its old device session.

Before a mutation, journal the exact host, device, app, artifact/build, capability context, adapter/policy, and requested effect. After an interrupted install or launch, enter the existing `outcome_unknown` operation state with reason `OUTCOME_UNCERTAIN`. Query the installed identity or process using a qualified read path before deciding what can safely happen next. No query support means unresolved uncertainty. Reusing a request ID returns that original operation rather than dispatching a second effect.

Install-and-launch is one scoped request with two retained effects. Successful install plus failed launch produces a failed composite operation with confirmed install evidence and a separate launch failure. Cancellation records confirmed effects and remaining uncertainty. Reconciliation can finish an observation or propose the next authorized action, but cannot silently replay a launch, uninstall, downgrade, force-quit, or reset product data.

### Remaining development operations and fallback

Logs are scoped to the approved source, bounded in duration/bytes, cancellable, timestamped, and privately retained. Tests and accessibility interaction require a declared signed runner or qualified native tool, approved plan, session ownership, and cleanup. A temporary signed test runner is distinct from a permanent iOS client. Screenshots and screen capture are explicit capabilities with scope and retention. They are not prerequisites for installation confirmation.

Qualify interactive debugging with real attach, breakpoint, inspect, resume, disconnect, and cleanup. Qualify a native Xcode destination separately from an explicit debugger bridge. D3 retains each missing capability until it has its own evidence on each claimed network/version combination.

If direct cold cellular installation is blocked, D1 may select a separate private OTA feasibility track. It must prove the iOS system installer's manifest/package access, authorized signing/export mode, in-place identity/data continuity, required interaction, and installed-version confirmation. Safari reaching a private page is insufficient. OTA preparation is `delivery_prepared` until confirmed installation. It never implies launch, logs, tests, debugging, or cold developer-session support.

An OTA endpoint, if selected, is a narrowly scoped service-owned artifact-serving component. It serves only approved expiring artifacts over compatible private HTTPS, follows existing authorization and retention, and supports revocation. No public Funnel, router forwarding, or public build links are introduced by this plan. Qualify authentication with the system installer rather than assuming browser login applies to its requests.

The baseline phone dependency remains Tailscale and ordinary Apple developer/trust prerequisites. A permanent custom iOS client requires a separate evidenced decision about the missing capability, viable APIs/permissions/background behavior, and coexistence with Tailscale. A client cannot be presumed to open an unavailable system developer service.

D2 closes the first verified preparation and in-place update outcome. D3 closes each additional operation independently. D4 qualifies recovery, host transfer, revocation, privacy, app-data continuity, compatibility, and lifecycle with M6. Core Contribution release can proceed independently. Unpassed remote-device cases remain open in the canonical plan and acceptance table.
