# Contribution: implementation and delivery plan

> Maintained requirement baseline, imported from package revision 2. Product implementation remains planned. The current next step is [S0 repository setup](../REPOSITORY_SETUP.md), bounded by the [setup prompt](../SETUP_PROMPT.md). [Review amendments](../REQUIREMENTS_REVIEW.md) clarify this baseline. Private source material remains external; see [provenance](../SOURCE_PACKAGE.md).

## 1. Assignment

Implement the first complete Contribution product described in [01-PRODUCT_REQUIREMENTS.md](01-PRODUCT_REQUIREMENTS.md). The architecture, agent contract, migration rules, and acceptance scenarios are normative companions. Work in the user's Contribution repository, using native Codex worktrees and the repository's current instructions.

The core deliverable is a functioning macOS utility with agent access, durable job execution, adopted repository gates, actual push observation, GitHub status, and the two-Mac workflow. The expanded assignment adds the optional Remote Devices module in [08-REMOTE_IPHONE_DEVELOPMENT.md](08-REMOTE_IPHONE_DEVELOPMENT.md). Its D0 through D4 track uses the same engine and follows explicit physical-device gates. A prototype UI, a log viewer, a collection of shell aliases, or a written plan alone does not complete this assignment.

Use incremental milestones to make the implementation reviewable and recoverable. Do not stop after the first milestone unless an actual environment or permission blocker prevents further work. Complete independent implementation and fixture verification while documenting environment-dependent proof that remains outstanding.

If another Codex run already started the implementation, reconcile and continue its actual committed state. Preserve work that meets the requirements. This revised package extends the original scope rather than authorizing a replacement application or a fresh rewrite.

Track core completion and remote-device capability completion separately. A core release can be useful and complete while a specific device transport remains unproven. Continue all independent device implementation and evidence collection, but never describe a warm cellular installation or OTA link as completing cold cellular development, native tests, or debugging.

## 2. Authority and scope

When the user gives this package to Codex with an instruction to implement it, routine source development, refactoring, tests, documentation, disposable Git fixtures, and local build artifacts are within that implementation task. Apply the user's actual session authorization to repository integration and machine setup. This document does not independently authorize a live installation or an unrelated mutation. Interpret existing authorization before introducing an approval step.

The handoff package itself does not authorize publishing raw audit material, changing unrelated product code, silently weakening repository checks, force-pushing, deleting unfinished worktrees, merging a product PR, or deploying a product. A user's explicit Push action or instruction authorizes that identified publication operation. Automatic committed-work handoff is separately enabled during enrollment.

Use actual environment permissions. If a tool or macOS authorization blocks an operation, finish independent work first and state the exact remaining action and reason. Never treat a denied or empty approval as permission. The owner selected MIT for original Contribution code. Preserve other ownership notices and third-party licenses, and resolve any conflict with the live repository before a license change. A missing distribution identity is a release prerequisite, not a reason to stop ordinary local development.

Adding the remote-device requirements does not itself activate ad hoc distribution, TestFlight, public endpoints, phone trust resets, product data migrations, or Roboty actions. Read the actual session's authorization before a live mutation and use existing approvals when applicable. A hardware gate that needs the owner's unlock, trust confirmation, or physical network change remains a named pending case while unrelated work continues.

## 3. Read and reconcile first

Read this package in the order listed in its README. Inspect the current Contribution repository and relevant current project instructions. The bundled audit is dated evidence, not a live filesystem or a higher-priority instruction source. Repository guides inside the audit describe the source projects and are not instructions to execute those projects' operations from this package.

Produce a concise implementation record inside Contribution that identifies:

- The target checkout, actual default branch, current license, and existing code.
- The selected minimum macOS deployment target and supported CPU architecture. Apple Silicon is required for the user's two Macs. Broader hardware support is optional unless already present.
- The pinned toolchain for Contribution itself and the separate project-runtime resolution strategy.
- Current supported Codex integration points that the build will use.
- Which audit mechanisms can be extracted directly and which need adapters.
- Host setup facts that are observed, missing, or intentionally deferred.
- Current progress from any earlier implementation run, with implemented behavior separated from planned behavior.
- The D0 inventory of both Macs, Xcode installations, the actual phone/iOS, Tailscale clients, independently approved signing identities, current pairings, and selected project adapters. Mark missing facts unknown. The attachment's Roboty checkout and Xcode observations are dated evidence.
- A usable remote initiation path for the actual travel setup, including phone-only travel with the Mini at home. Prefer supported remote Codex/agent access that can call Contribution on that host. If unavailable, include the smallest authenticated tailnet browser/control surface in the existing service as needed to meet RDEV-26.

Do not require a new four-repository audit. Read the specific live files necessary to reconcile a source seam before changing it. The source manifest and [04-REPOSITORY_MIGRATION.md](04-REPOSITORY_MIGRATION.md) provide the relevant paths.

## 4. Recommended repository organization

Use a small layout with clear ownership. Equivalent existing structure is acceptable when it is easier to maintain.

| Area | Responsibility |
|---|---|
| `apps/macos/` | SwiftUI views, native notifications, service registration, and updater integration |
| `packages/engine/` | Repository identity, coordination, operations, adapters, events, and recovery |
| `packages/cli/` | Agent and terminal command interface, with no duplicate workflow rules |
| `packages/contracts/` | Versioned schemas and shared interface definitions |
| `packages/adapters/` | Generic and adopted repository integrations with narrow responsibilities |
| A device module within the existing engine and adapters | Qualified device backends, artifact provenance, operation capability and ownership, and project-owned build/identity integration |
| `tests/fixtures/` | Disposable Git topology and recorded API cases |
| `tests/integration/` | Behavior tests through public commands and the service interface |
| `docs/` | Maintained requirements, architecture decisions, operator guide, and verification records |
| `scripts/` | Small build, package, qualification, and release entry points |

Start with clear modules rather than a general-purpose extension framework. A single source repository and a single released application version own all shared components. Avoid a per-repository dependency-installation workflow for the shared engine.

The package's schemas are the initial public interface baseline. Generate or validate runtime types from the same definitions. Do not independently redefine state enums in Swift, JavaScript, the CLI, and tests. Additive improvements are acceptable when the documents, schemas, fixtures, and adapters are updated together. Record any material departure from the agreed behavior before proceeding with that departure.

## 5. Milestones

### M0. Establish the maintained foundation

Implement buildable app, CLI, and engine targets with one version identity. Add the initial contract definitions and a minimal storage migration. Establish a short Contribution `AGENTS.md` that preserves task-owned commits, native worktree use, source isolation, and evidence-based completion.

Document the native-first maintenance rule: before adding custom Codex behavior, verify whether a supported native capability already covers the requirement. Keep integration examples tied to documented interfaces. A detected Codex version is not by itself proof of feature availability.

Run D0 alongside this milestone. Keep Remote Devices disabled until intentionally configured. Define its typed boundary without adding a second service, scheduler, login item, or permanent iOS app. Record the initial backend decision and the exact physical cases the first prototype must distinguish.

Deliver a minimal app that opens, a CLI that reports its version and capabilities, and a reproducible local build command. An initial empty-state screen is acceptable for this milestone only.

**Exit evidence:** the app and CLI build from a clean checkout, identify the same engine version, and run without evaluating code from an arbitrary mutable checkout.

### M1. Build the job and evidence foundation

Implement the single user service, local interface, operation store, event stream, and retained log files. A request and its identity must be recorded before it can overwrite or begin shared work. Implement idempotent admission, cancellation semantics, bounded waits, event replay, and process-identity reconciliation.

Implement bounded discovery, repository registration, identity mapping across worktrees, and status from recorded local observations. Include explicit initialization, minimal new-repo bootstrap history, configuration revision checks, and standalone operation without pairing prerequisites. Implement explicit refresh separately. Add basic host identity and version negotiation even before a real second host is connected.

Provide an actual disposable operation that can run long enough to close and reopen the UI, reconnect a CLI, and verify that the operation survives its clients. Use controlled fixture commands rather than a production build just to demonstrate process supervision.

After the journal and authenticated operation boundary exist, D1 can run independently of GitHub monitoring and repository migration. Use a narrow approved prototype to settle remote Wi-Fi and cold cellular behavior before building substantial device UI. Prototype evidence must be imported into the maintained capability record, not left in a separate private backlog.

**Exit evidence:** same-repo overlapping requests keep separate histories, a repeated request is recognized, a missing completion becomes uncertain or interrupted, and the UI and CLI show the same evidence.

### M2. Deliver the first useful push workflow

Connect the generic adapter and then the existing repo reporting seams. Preserve their hook owners, arguments, stdin, exit results, runtime pins, gate selection, and evidence invalidation rules.

Implement the managed Push action through the full outer Git command. The hook executes the gate once inside that invocation. The worker's validated lease context is adopted by the hook, preventing both self-deadlock and duplicate validation. An environment variable alone is not a sufficient lease ownership check.

Capture the intended publication tip and destination through the preview scope token. Reject changed branch, resolved destination, or effective policy even when the tip is unchanged. Refresh destination state at the required boundaries and use an ordinary non-force push. Do not bypass a hook to avoid running the gate twice. A separate checks run is not automatically the publication gate and its evidence is reusable only where the adapter's contract permits it.

Add real local progress, per-check summaries, post-command delivery outcomes, failure repair context, and success/failure notifications. Integrate existing raw Git entry points through their hook reporting, keeping unobserved transport explicitly unknown.

Wire the core UI now: All repositories, per-repository view, operation detail, log search, progress, copy/export, and contextual actions. Use illustrative fixtures only where clearly marked. A demo fixture must never appear as live repository status.

**Exit evidence:** demonstrate local-gate failure, passing gate followed by remote rejection, successful delivery, no-op publication, early authentication-style failure, concurrent logs, and hook-only coverage through disposable remotes. This milestone must initiate and track a real Git push, not merely display a simulated progress bar.

### M3. Follow GitHub and finish the information design

Implement a shared GitHub monitor with credential reuse through supported tools and APIs. Start with outbound polling, rate-aware backoff, and active versus idle intervals. Idle discovery must still detect external, scheduled, and manual activity without a known Contribution push or PR. Avoid a public webhook service for this two-Mac use case.

Correlate repository, PR, commit, check suite or run, job, and attempt identities. Preserve GitHub's current-head and test-merge semantics. Follow existing auto-PR workflows instead of introducing a second PR creator. Distinguish operational workflows, optional checks, and merge-blocking checks.

Implement current readiness, freshness, required-check explanations, resolved historical failures, remote-only activity, and available hosted log retrieval. Include direct links to the precise PR, job, or run. Observe structured results, not words such as "error" in log output.

Complete native notifications and preferred-device event deduplication. Build compact settings for repositories, hosts, profiles, notifications, retention, and updates. Put detailed diagnostics in a dismissible sheet with copy/export actions.

**Exit evidence:** API fixtures cover reruns, stale head results, skipped checks, drafts, missing data, permissions, conflicts, and external pushes. A real authorized GitHub read confirms the expected API mapping. A write is required only as part of an authorized publication qualification.

### M4. Extract shared mechanics with policy parity

Extract proven common coordination, process supervision, runtime selection, and evidence/reporting code behind the adopted adapters. Keep check definitions and application-specific reconciliation in their source repositories.

Work through the four migration profiles in the dedicated migration document. Check the current versions before editing. Preserve Mathy's policy-only landing and reconciliation, Main Character's cumulative gate, Roboty's cheap local stage, and Glass Alpha's inactive pre-push activation.

A shared adapter may initially invoke an existing repository command. That is a deliberate compatibility seam. The completed extraction must remove unnecessary duplicated mechanics and establish a clear owner for remaining code, rather than leaving two independently evolving implementations of the same lock or reporter.

Keep native task lifecycle with Codex. Replace hardcoded worktree path heuristics only when actual Git and supported Codex identity are sufficient. Do not delete missing or old worktree records as part of centralization.

For D2, adopt Roboty's existing verified build/update path through the device adapter seam documented in the migration guide. Preserve its primary-source selection, exact-input artifact verification, signing identity, session ownership, and pending-operation rules. Do not route a transport experiment around those contracts or migrate all four projects to iPhone development merely because the shared module exists.

**Exit evidence:** selected commands, scope, exit codes, lock behavior, timeouts, author rules, and evidence reuse match the adopted policy. Include repository-specific provenance and migration notes. Runtime pins still come from the project, not the user's interactive shell.

### M5. Enable durable two-Mac work

Implement retained bundle export/import over normal SSH through Tailscale. Seed newly created shared history through the dedicated empty-target enrollment transaction before admitting ordinary source tasks to canonical landing. Local outbox capture may proceed while seed acknowledgement is pending. Start with prerequisite-complete bundles for correctness. Add incremental transfer only when it materially improves observed overhead and has complete prerequisite negotiation.

The MacBook persists a submission and its source identity before sending. The Mini retains the commits, durable incoming references, and request before acknowledging acceptance. A disconnect before acknowledgement is retried idempotently. A disconnect afterward does not cancel execution.

Implement the imported-source admission adapter described in the architecture. It must preserve the old source-to-candidate-to-landed receipt semantics without pretending the source is a Mini-local Codex worktree. A transfer can include prerequisite history while the submitted integration scope remains the selected task commits.

Complete canonical landing, push queue barriers, safe primary mirror updates, local cache refresh, and cross-device activity. Keep source worktrees and pins recoverable until their actual completion rules are satisfied. Demonstrate normal pending states when the Mini is unavailable.

Perform deliberate authority cutover for each existing repo only after reconciling both clones and draining incompatible operations. A companion's network failure never changes authority. Existing work on either Mac must remain reachable through commits, refs, or explicitly retained candidates. After paired cutover, the companion authority guard refuses ordinary direct pushes before they can create a second publication route. Preserve canonical-host external hook enforcement and its limited delivery observation.

Synchronize Contribution's own project registry using the existing durable metadata channel, stable repository identity, and configuration revision checks. Store per-host checkout paths and setup status separately. A newly enrolled project can appear on the other Mac while its checkout or one-time Codex setup is pending. Reuse the established clone or empty-target enrollment transaction. Do not run a new project's scripts solely because its metadata arrived.

Use native Codex Remote and Handoff for supported session movement. It requires matching saved projects on both hosts. Implement `codex app PATH` and the documented local workspace deep link when the installed client supports them, with exact manual setup guidance as the fallback. Automatic Codex saved-project-list synchronization remains conditional on a documented registration interface. Do not treat opening a path as proof that the other Mac's sidebar changed.

**Exit evidence:** complete the two-Mac acceptance cases with sleep, disconnect, duplicate submission, stale mirrors, conflicting landings, missing prerequisites, and real runtime setup. Before a Mini is available, implement these behaviors in process-separated fixtures and explicitly leave the physical two-Mac evidence outstanding.

### M6. Package, update, and qualify the complete product

Bundle the correct utility runtime and engine with the SwiftUI application. Register background components through supported macOS APIs under the development user. Provide the stable CLI entry point and a diagnosable installation state. Do not assume GUI terminal environment variables exist in the service session.

Use Developer ID signing, notarization, and Sparkle for the distributable application. All paths that install an update must quiesce incompatible workers and preserve accepted requests. Delaying a visible app relaunch alone does not prove helper safety.

Implement version compatibility, data migration preflight, rollback behavior, and recovery after failed update. Keep a compatible previous engine where supported. If a database migration cannot be read by an older version, report that limitation and use an approved recovery procedure rather than running the old binary on an incompatible store.

Verify restart behavior with the actual user session and machine configuration. FileVault unlock, credentials, macOS background-item authorization, and native tools can affect availability after a reboot. Show actual readiness and actionable instructions. Do not weaken those settings to obtain a green test.

For enabled device backends, run D4 qualification through this same release and update lifecycle. Package pinned dependencies reproducibly, retain required notices, and separate any privileged helper from the normal service. Pause or reconcile active device mutations before replacing their worker. Revalidate affected compatibility after toolchain/backend upgrades. A disabled or unsupported device backend must leave normal Git development usable.

Implement retention, sanitized diagnostic export, storage-pressure behavior, upgrade diagnostics, and user-controlled unenrollment. Review the obsolete maintenance-control launch jobs separately and retire only confirmed obsolete integration through a documented, authorized step.

**Exit evidence:** pass the applicable acceptance matrix and retain clear evidence for the real Mac and two-Mac cases. A runnable local development build is useful while signing credentials are unavailable, but it is not evidence that a signed release or unattended installation is qualified.

### Device track D0 through D4

This track is part of the expanded assignment. It proceeds alongside core implementation once its prerequisites exist. Document 08 owns full RDEV requirements, original AT rows, capability priorities, and the requirement-to-evidence crosswalk.

| Phase | Prerequisites | Work and decision | Exit evidence |
|---|---|---|---|
| D0. Inventory and ownership | M0 inspection | Resolve the live compatibility target, approved hosts/phone/project identity, pairing/signing ownership, existing Roboty seam, and module boundary. Native Apple tooling remains the baseline. A pinned go-ios adapter is the initial remote prototype candidate. | Inventory with actual versions or explicit unknowns, dependency/license/privilege record, requirement owners, and a scoped prototype recipe. No unsupported minimum OS or phone state invented. |
| D1. Remote feasibility | D0 and M1 journal/dispatch, with isolated exploratory inspection possible earlier | Prove an authenticated operation and verified update on remote Wi-Fi. Immediately test deliberate teardown, a fresh cellular session, phone restart, and host restart with the phone still on cellular. Compare warm transition separately. | Evidence for AT-01/02/06/08/09/10 as applicable, a named failed layer when known, and a backend decision. Cases lacking proof remain open. |
| D2. First useful device operation | Shared journal/authorization, selected qualified route, project adapter parity | Prepare and verify an immutable signed artifact while the phone is offline, then install in place on the exact device from either selected Mac. Implement honest progress, uncertainty reconciliation, data retention, and separate launch result. | Actual identity/build readback and retained meaningful fixture data on both hosts. A prepared or transferred artifact alone does not pass. |
| D3. Developer operations | D2 and qualified backend capabilities | Add launch, bounded app logs, signed native tests, accessibility interaction, optional scoped screenshots, and desired interactive debugging. Qualify native Xcode destination integration separately from a custom debugger bridge. | Each claimed operation has its own version/network evidence. Debugging includes attach, breakpoint, inspect, resume, disconnect, and cleanup. |
| D4. Reliability and release | D2/D3 implementations and M6 packaging/lifecycle | Exercise interruption, two-host transfer, known Xcode/test conflicts, pause/revocation, relayed routes, upgrades, retention, and idle costs. Reuse the existing service and updater. | Applicable AT-01 through AT-24 recorded for both Macs, no hidden incomplete requirement, scoped cleanup, and a clear capability/release status. |

#### D1 stop and continuation rules

Before physical experimentation, record the test app, selected device and hosts, exact backend revision, operation, connection deadlines, retry limits, and the prototype's attempt/time budget. Plan one focused implementation investigation and one assisted physical-device session. One alternate backend comparison is justified when it tests a specific new explanation for the failure. Do not repeat equivalent retries, reset trust, or build a general remote platform to avoid recording an unresolved result.

Qualify remote initiation from the intended travel caller as part of D2. Starting a job locally on the home Mini does not prove the owner can request it while traveling with only the phone. Record the actual supported agent interface or authenticated browser route and its authorization, without introducing a permanent iOS app.

A valid D1 outcome is one of the following:

1. A direct developer route is demonstrated for the named target cases.
2. Remote Wi-Fi and possibly warm cellular work, while cold establishment or restart recovery remains unresolved. Carry RDEV-19 and AT-08 through AT-10 forward and investigate private OTA installation separately.
3. The candidate fails a named capability with retained evidence and a specific next hypothesis. Keep ordinary development available and continue independent implementation.

An experiment may finish with an unresolved result. That does not close the underlying requirement. An additional iOS client is considered only after a concrete API/permission/background proof identifies a capability it can actually supply. Do not make a permanent companion app the default response to a timeout.

#### OTA and host-transfer gates

If selected, OTA must prove system-installer access to both manifest and package, approved signing and app identity continuity, data retention, required interaction, and actual installed-version confirmation. Browser access alone is insufficient. If developer readback is unavailable, the project must define and qualify another device-side confirmation method. Until then report delivery prepared or verification pending.

A development-host switch requires release or reconciliation of the earlier device operation owner. An unreachable host or expired coordination lease cannot by itself establish that the phone is free. Implement explicit uncertainty and recovery rather than automatic takeover. The final qualified design must also support either Mac working independently after clean transfer.

## 6. Verification strategy

Use [06-ACCEPTANCE_TESTS.md](06-ACCEPTANCE_TESTS.md) as the behavioral gate. Prioritize meaningful integration tests around state transitions and real Git plumbing. Use unit tests for decision logic where they catch a specific risk, not to duplicate the implementation's structure.

Preserve all 54 original core acceptance scenarios and all 24 added physical device cases. The exact RDEV and AT text remains in document 08. Fixture tests can validate contracts, authorization, stale state, cancellation, and reconciliation logic. They cannot establish real Apple pairing, cellular transport, system-installer access, installed-app identity, data retention, or debugger behavior.

Maintain a machine-readable and human-readable verification record with these outcomes:

- Implemented but not yet exercised.
- Fixture verified.
- Verified on one real Mac.
- Verified across the actual two-Mac topology.
- Blocked with an exact prerequisite and reproduction command.
- Failed with retained evidence.

For remote capabilities, also record the exact host/phone/toolchain/backend/network tuple, evidence source, required owner actions, operation-specific qualification, and current availability. Qualification and current reachability are different fields. A `supported` historical tuple can be offline today. An available transport does not establish untested operations.

A skipped or unavailable test is not a pass. A screenshot of a working screen is not proof of durable queue behavior. Conversely, backend fixture tests alone do not prove that the macOS app installs, updates, or provides usable notifications.

Run the complete required checks for Contribution itself before committing a finished implementation change according to its current guidance. Avoid repeatedly running broad suites without a remaining concrete risk. Keep each task's own work committed and leave unrelated concurrent work alone.

## 7. Performance qualification

Measure Contribution overhead separately from repository workloads. The product document sets targets for UI responsiveness, local status access, notification latency after observation, and idle resource use.

Record command and check durations, selected check counts, cache reuse reasons, transfer sizes, queue wait, and local service overhead. Reuse existing process supervision and build resource locks. Start conservatively with resource capacity one for expensive shared native resources. Different repositories can make progress concurrently when they do not contend for those resources.

Avoid continuous disk-wide scanning, tight polling, unbounded log loading, or an LLM process for routine status interpretation. Favor bounded file-system reconciliation, structured events, indexed history, streaming logs, and cached remote observations with timestamps.

Do not introduce a strict wall-clock cutoff that silently skips required checks to meet the lightweight profile's speed goal. Optimize unnecessary work and make any genuinely necessary slow check visible.

## 8. Maintainable operations and documentation

Provide a short operator guide for installation, new-repo enrollment, switching profiles, ordinary pushes, reading failures, reconnecting a host, restoring a moved checkout, upgrading, and removing Contribution's integration.

Add a concise device runbook covering host selection, bootstrap trust, build preparation, install-only versus install-and-launch, logs/tests/debugging, cold versus warm cellular, private OTA when qualified, host transfer, pause, and uncertain-effect reconciliation. Keep meaningful operational guidance in Contribution and project-specific signing, data migration, and product authority in each project.

Provide a short agent guide focused on executable commands and invariants. Avoid a long duplicated runbook in every repository. A user working in any enrolled project should be able to direct Codex to improve Contribution in its own source repository. That change must be developed and released independently of the already-running installed engine.

Document recovery around interrupted landings, ambiguous pushes, and blocked mirrors using the actual implemented commands. Recovery should preserve source and evidence first. Any destructive operator action must be clearly described and outside automatic retry behavior.

## 9. Completion report

At completion, report the following without claiming unverified work:

1. What was built and where the application, CLI, source, and documentation are located.
2. Which milestone and acceptance evidence exists, with links to logs or test summaries.
3. Which repositories have been observed, enrolled, migrated, and qualified. These are distinct states.
4. The actual canonical host and branch configuration for enrolled repositories.
5. How to start Contribution and perform one ordinary agent-driven push.
6. Any remaining environment-specific steps, including Mini setup, native Codex manual registration, signing, or credentials.
7. Material deviations from this package and their rationale.
8. The D0 through D4 state, operation-by-operation capability matrix, actual physical-device evidence on each Mac, and remaining cold-cellular or debugging gaps. Do not call the expanded remote target complete while a required case lacks proof.

Keep the report focused on behavior and remaining proof. Do not present unimplemented placeholders as future polish when they are part of the first complete version.
