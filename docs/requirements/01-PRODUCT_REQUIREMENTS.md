# Contribution: product requirements

> Maintained requirement baseline, imported from package revision 2. Product implementation remains planned. The current next step is [S0 repository setup](../REPOSITORY_SETUP.md), bounded by the [setup prompt](../SETUP_PROMPT.md). [Review amendments](../REQUIREMENTS_REVIEW.md) clarify this baseline. Private source material remains external; see [provenance](../SOURCE_PACKAGE.md).

## 1. Purpose and scope

Contribution is a macOS utility that makes a solo developer's Codex workflow consistent across repositories and computers. Its name is **Contribution**, its domain is **contribution.dev**, and its command is **`contribution`**. The first user works on Mathy, Roboty, Main Character, Glass Alpha, and Contribution itself using an always-on Mac Mini and a MacBook Pro.

The product should make ordinary development feel simple: finish a task, preserve the committed result, land it on the Mini, see what needs pushing, initiate a GitHub push when wanted, and follow its checks through to PR readiness. An optional Remote Devices module extends that same workflow to preparing and installing an iPhone development build from either Mac over Tailscale, then qualifying launch, logs, tests, UI interaction, and debugging. The app and agents use the same engine. The user should not need to maintain different workflow scripts in every project or keep terminal windows open to preserve a job.

This document defines product behavior. [02-ARCHITECTURE.md](02-ARCHITECTURE.md) owns process and storage design. [03-AGENT_CONTRACT.md](03-AGENT_CONTRACT.md) owns exact commands, schemas, interfaces, and machine-readable states. [04-REPOSITORY_MIGRATION.md](04-REPOSITORY_MIGRATION.md), [05-IMPLEMENTATION_PLAN.md](05-IMPLEMENTATION_PLAN.md), and [06-ACCEPTANCE_TESTS.md](06-ACCEPTANCE_TESTS.md) own sequencing and proof. [07-SOURCES_AND_DECISIONS.md](07-SOURCES_AND_DECISIONS.md) records supporting sources and design decisions. Do not introduce a second command vocabulary or competing implementation contract here.

The canonical remote-device requirements, RDEV-01 through RDEV-40, and their physical acceptance cases, AT-01 through AT-24, are in [08-REMOTE_IPHONE_DEVELOPMENT.md](08-REMOTE_IPHONE_DEVELOPMENT.md). The original attachment is retained as dated evidence in the supplied remote-development handoff (private reference; see [source package](../SOURCE_PACKAGE.md)). The maintained module specification and shared contracts own future implementation status.

**Priority convention:** Existing P0 requirements define the complete core release, M0 through M6. The added remote-development scope follows D0 through D4 and the explicit capability priorities in document 08. Core delivery can complete independently of an unresolved Apple transport capability. The overall remote target remains open until its required physical evidence exists. A reporting-only milestone, installation-only fallback, or passing fixture cannot stand in for the remaining intended capability.

### Goals

- Make the same action behave consistently from Codex, a terminal, or the app.
- Keep completed work recoverable and automatically transferable between Macs.
- Centralize common mechanics while retaining product-specific checks and policies.
- Make current activity, failures, publication status, and next actions immediately understandable.
- Reuse supported Codex capabilities and established Git behavior.
- Keep normal operation quiet, lightweight, and resilient to sleep, disconnection, and restarts.
- Make remote iPhone development useful from either approved Mac without routine USB use, while showing exactly which operations are available on the actual phone and network.

### Non-goals

Contribution does not replace Codex's editor, conversations, native worktree lifecycle, or model reasoning. It does not synchronize arbitrary folders, credentials, databases, simulators, robot recordings, or unfinished file edits. It does not introduce an enterprise approval platform, a general plugin marketplace, a hosted control plane, or a full Git client. Automatic GitHub publication, PR merging, and deployment are separate opt-in product decisions, not consequences of enabling handoff.

This package does not build a marketing site for contribution.dev. The owner selected MIT for Contribution's original code and a maintainer-driven open-source project. Preserve third-party licensing and attribution. If the live repository has conflicting licensing, resolve that specific discrepancy before changing its license. Implementing this package does not publish source or create a public repository.

## 2. Product model

**PRD-MODEL-001: One engine, several entry points.** The native app, CLI, Git adapters, and supported Codex integration invoke the same operations and consume the same results. An app-only capability that an agent cannot inspect or invoke is incomplete. The CLI remains usable without an open app window.

**PRD-MODEL-002: Explicit canonical owner.** Each enrolled repository has one canonical landing owner. For this paired setup, that owner is the Mac Mini. A standalone installation or deliberately local-only repository uses its local Mac as owner and does not require a Mini or Tailscale. References to Mini execution below describe paired repositories. Either Mac may initiate, inspect, or cancel supported operations. Owning landing does not require the user to sit at that computer. The MacBook remains useful for local editing and focused checks while disconnected. A local check targets its selected local worktree, while a canonical check explicitly targets the owner. The app must never validate the wrong checkout because a host is unavailable. It must not silently promote itself to owner when the Mini is unavailable.

**PRD-MODEL-003: Primary is a configured branch.** Primary means the repository's configured integration checkout and active branch, not necessarily a branch named `main`. Existing repositories may use integration branches other than `main`; resolve each live repository contract. The UI must distinguish those branches from a PR's target branch. Branch changes must follow supported configuration and lifecycle operations rather than name guessing. Audit inventory (private reference; see [source package](../SOURCE_PACKAGE.md))

**PRD-MODEL-004: Preserve distinct milestones.** Task commitment, transfer, landing, local validation, GitHub delivery, remote checks, merge readiness, merging, and deployment are separate facts. A successful earlier milestone never implies a later one. Summaries may combine them into readable sentences, but the underlying outcomes remain independently visible.

**PRD-MODEL-005: Build host and Git owner are separate choices.** The selected iPhone build or device-operation host may be the Mac Mini or MacBook Pro. This does not transfer the repository's canonical landing or publication authority. An authorized development build does not require a GitHub push. The project adapter resolves and verifies its approved source checkout, configuration, signing identity, and build inputs on the selected host.

## 3. Validation profiles and repository policy

**PRD-POLICY-001: Two understandable profiles.** Expose **Local development** and **Standard** as the primary validation choices. Their configuration identifiers are `local-development` and `standard`. A profile describes validation policy, not which Mac runs commands and not whether the project has a deployed website.

| Profile | Intended behavior |
|---|---|
| Local development | Lightweight development with configured identity, ownership, and repository safety checks. Agents run focused task proof. Broad publication qualification and hosted checks are inactive unless separately configured. |
| Standard | The repository's selected publication checks run before a GitHub push, with justified reuse and project-specific requirements. Relevant remote checks remain visible afterward. |

**PRD-POLICY-002: New projects start light.** A newly created repository defaults to Local development. Do not generate a large validation system, activate deployment, or install hosted workflows merely because a project was created. Moving to Standard is an explicit configuration change with a concise explanation of the checks it enables.

**PRD-POLICY-003: Preserve existing behavior during enrollment.** Existing projects retain their actual gate activation, selected commands, failure behavior, required evidence, and remote rules. A profile label is not permission to replace their contracts. Profile and gate activation remain separate settings. Mathy and Main Character currently have cumulative publication gates. Roboty deliberately has a lightweight local stage. Glass Alpha has a dormant pre-push gate. Enroll reporting for all four without silently activating the dormant gate or broadening Roboty's checks. Audit policies (private reference; see [source package](../SOURCE_PACKAGE.md))

**PRD-POLICY-004: Common mechanics, project definitions.** Contribution owns execution, coordination, runtime selection, reporting, and supported evidence plumbing. Repositories retain check commands, input ownership, product-specific reconciliation, build requirements, and release policy. Runtime pins remain repository-specific. A shared utility update should improve common mechanics without requiring four copied script patches.

**PRD-POLICY-005: Truthful controls.** Users and agents can configure supported pre-push automation and notification preferences through the same validated configuration operations. Revision checks prevent one client from overwriting another client's newer settings. The screen must show effective policy and overrides. Disabling a check is recorded as disabled, not passed. Inactive-by-profile, not-selected, reused, cancelled, interrupted, and unavailable are distinguishable. A local setting cannot claim to remove a GitHub-required check. Changes that alter publication requirements must be deliberate and reviewable.

## 4. Installation, discovery, and new repositories

**PRD-SETUP-001: A normal Mac installation.** Ship one native app with a menu-bar item, a main activity window, a CLI, and the necessary background components. The installation should provide a stable command location and a clear background-service status. It must not require a terminal tab, an open editor, or an always-visible window to keep accepted jobs running.

**PRD-SETUP-002: Short onboarding.** Initial setup identifies this computer's role, finds the Contribution source repo when available, checks the prerequisites needed for selected operations, and offers repository discovery. Pairing uses the existing Tailscale and verified SSH setup. Show precise remediation for missing access. Do not configure an unrelated VPN or substitute a public service. Mini readiness must include whether the required user session and native tools can run after restart.

**PRD-SETUP-003: Bounded discovery.** Scan selected development folders, initially suggesting the user's known project root. Deduplicate linked worktrees by Git common-directory identity. Show discovered repositories with their paths, remote identity, current policy, and enrollment status. Discovery itself is read-only and must not traverse the entire disk or install hooks in every directory it finds.

**PRD-SETUP-004: Easy enrollment.** Adding an existing repo produces a small configuration record and compatible adapters through the current hook owner. Preserve existing Husky or trusted-dispatch arrangements. Show what will change and any unsupported condition. New worktrees of an enrolled clone inherit the repository's integration without separate enrollment. A second independent clone is not automatically the same local checkout just because its name matches.

**PRD-SETUP-005: New-project lifecycle.** A user or agent can create a new local project through the shared engine, choose its name and location, and receive a Git repository enrolled under Local development with concise workflow guidance. Reuse an existing appropriate template when explicitly selected. New creation includes a minimal bootstrap commit on `dev`, containing only generated Contribution configuration and guidance under the user's configured Git identity. Existing unborn repositories require an explicit Initialize history action. A paired repository seeds the canonical host only when its target history is absent, with durable retention and idempotent receipt, before normal task submission begins. Existing application files are not automatically staged. Creating a GitHub remote or publishing the project is a separate requested action. Once a remote exists, associate its identity with the existing local project without duplicating history or enrollment.

**PRD-SETUP-006: Supported Codex registration only.** Provide Open in Codex through documented `codex app PATH` or the documented local-workspace deep link when supported by the installed client. Detect an installed application and supported command or URL handler before invoking a path that could otherwise start an installer. A deep-link prompt is prefilled, not automatically submitted. Opening a workspace does not prove persistent sidebar registration or cross-device propagation. If saved-project registration has no documented interface, show the exact folder and a one-time Add Project instruction. Track that step truthfully. Do not edit private Codex databases, automate its UI, or invent a project-registration API. Contribution enrollment remains useful while this manual step is pending. [Verified native interfaces](07-SOURCES_AND_DECISIONS.md)

**PRD-SETUP-007: Enrollment stays maintainable.** A repo can move, change its active branch, add a peer clone, or leave Contribution through supported operations. Show stale paths and configuration drift with one repair action. Unenrollment stops future automation and removes only Contribution-owned integration. It preserves source files, Git history, unfinished candidates, and relevant retained records.

**PRD-SETUP-008: Shared project registry.** An intentionally enrolled project appears in Contribution on both paired Macs after metadata synchronization. Associate one stable project identity with each host's independently resolved checkout and setup state. An absent checkout offers the supported clone or empty-history enrollment path. Do not synchronize absolute paths as if both hosts shared a filesystem. Metadata synchronization does not run project setup scripts, enroll unrelated folders, copy credentials, or silently register projects in Codex. Offline enrollment is durable and pending until acknowledged. A conflicting configuration revision requires reconciliation instead of last-writer overwrite.

## 5. Daily work and automatic handoff

**PRD-WORK-001: Native Codex lifecycle.** Codex owns supported worktree creation, handoff, session continuity, archive, and restore behavior. Contribution supplies the repository workflow and coordination that those features do not provide. Do not create a competing session browser or infer ownership from a hard-coded `/.codex/worktrees/` path. That path assumption is an identified limitation in the audited tooling. Native capability audit (private reference; see [source package](../SOURCE_PACKAGE.md))

For cross-host chat movement, use native Codex Handoff when available. It requires a matching saved project for the same Git repository, including the same subdirectory when applicable, on each host. Contribution's durable submitted-commit transport remains separate from moving a Codex chat. Keep the user's preference to fetch upstream before creating worktrees where the installed Codex setting supports it. A GitHub fetch does not prove the Mini's unpublished integration history has reached a laptop. [Current Handoff documentation](07-SOURCES_AND_DECISIONS.md)

**PRD-WORK-002: Finish with owned work committed.** The shared guidance tells agents to commit their own completed changes and invoke the normal completion workflow. It does not authorize blanket staging, discarding unrelated edits, or declaring another agent's work finished. Ordinary source editing stays in task worktrees. Dirty primary is an actionable blocker, not a cleanup instruction.

**PRD-WORK-003: Automatic committed-work transfer.** Once a task intentionally completes and its commits are eligible, Contribution automatically queues the committed result for the Mini. No additional GitHub push is required. Transfer records identify the exact submitted work and distinguish receipt from acceptance and landing. The sender retains recoverable source references until the receiving workflow acknowledges the relevant outcome.

**PRD-WORK-004: Honest offline behavior.** If the Mini is unreachable, the task can finish locally and display “Committed, waiting for Mini.” Reconnection retries transfer automatically. If the MacBook disconnects after the Mini has accepted the request, the Mini continues eligible work. Closing the MacBook before acceptance must not produce a landed or backed-up claim. Connection loss is a normal waiting condition unless a specific user action is required.

**PRD-WORK-005: Canonical landing and return.** The Mini serializes landing through the configured repository contract. Once accepted history advances, the MacBook receives it and advances its primary checkout when safe. Busy or dirty checkouts are left intact and show why the update is waiting. Divergence and conflicts preserve both histories and become explicit integration work. Transfer must not accidentally invoke the full GitHub publication gate.

**PRD-WORK-006: Quiet background operation.** Normal synchronization, matching histories, and successful automatic fast-forwards need no popup. Show pending work and last confirmed contact in the relevant repo view. Automatic retry applies to recoverable handoff, not blind repeated pushes, merges, or deployments. Worktree cleanup remains with its documented owner and never follows from an old timestamp or missing directory alone.

## 6. Push-needed status and GitHub publication

**PRD-PUSH-001: Explicit publication.** The main action is **Push to GitHub**. It is available from a repo view and through the agent contract. Completing a task or synchronizing Macs does not publish it. The usual execution host is the Mini, subject to the verified runtime and repository requirements described in the architecture. Either Mac can request and observe the action.

**PRD-PUSH-002: Precise push-needed indicators.** Compare the Mini's canonical active-branch history with the configured destination branch on the intended GitHub remote. Do not compare against an arbitrary `origin/main`, a task worktree, the MacBook's lagging clone, commit dates, or the number of dirty files.

| Observed relationship | User-facing meaning |
|---|---|
| Canonical history equals the confirmed destination | No committed primary work awaiting push |
| Canonical history is ahead of that destination | Push available, with the known commit range or count |
| Destination is ahead | Primary needs reconciliation or update |
| Both contain unique commits | Histories diverged, integration needed |
| Destination branch is confirmed absent | First publication available |
| No remote is configured | GitHub destination not configured |
| Mini or remote data is unavailable or stale | State unknown or last known, with observation time |

Newer local task commits still awaiting landing appear separately. When a fresh comparison is equal, the Push button is disabled and explains that there are no unpublished primary commits. Missing or stale state offers Configure, Refresh, or Reconcile as appropriate instead of enabling a misleading Push action. Work waiting for landing remains visible even when Push is disabled. Stale observations must not become a confident “Everything pushed.” Refresh at appropriate operation boundaries and when the user requests it. Current branch and transfer findings (private reference; see [source package](../SOURCE_PACKAGE.md))

**PRD-PUSH-003: One observed operation.** The app and CLI create a durable attempt, display the intended repository, branch, destination and commit scope, run the existing configured gate once, observe Git's transport outcome, and associate subsequent GitHub activity. Waiting for a lease is visible. The preview supplies a scope token binding repository, canonical branch and tip, resolved destination, and effective policy. Execution verifies that token and rejects changed scope even when the tip is unchanged. The job must not silently include unrelated commits that arrive after its publication scope has been established.

**PRD-PUSH-004: Integrate ordinary Git entry points.** Existing Git hooks report into the same activity history while retaining enforcement. Supported wrapper or client integrations can report delivery completion. A hook-only attempt may report “Checks passed, delivery unobserved.” Passing pre-push does not establish delivery, and no-op pushes or early authentication failures must be captured when the managed invocation owns them. After paired authority cutover, a companion's ordinary Git push is refused by a separate authority guard with a clear Contribution Push action. It must not silently launch a Mini push and let the companion push continue. Canonical-host external pushes keep their hook coverage. This guard does not activate an inactive validation gate. Partial ref delivery remains partial. Push boundary evidence (private reference; see [source package](../SOURCE_PACKAGE.md))

**PRD-PUSH-005: Focused recovery.** A failed check exposes its command, evidence, and narrow repair action. A repair does not automatically publish. A transport interruption whose remote outcome is unknown requires reconciliation before any retry. Cancel should stop work where possible, preserve evidence, and state when remote acceptance cannot be undone. Closing the viewer is never a cancellation request.

## 7. Activity, evidence, and logs

**PRD-RUN-001: Unique attempts.** Every operation attempt has a stable identifier and retained metadata before shared work starts. Simultaneous attempts in one repo and operations across repos cannot overwrite each other's logs or notifications. “Latest” is a view, not the writable owner of a running job. This directly addresses the audit's shared-log initialization issue. Reporting evidence (private reference; see [source package](../SOURCE_PACKAGE.md))

**PRD-RUN-002: Useful live progress.** Show queued or running state, the current phase and check, execution host, elapsed time, completed versus selected checks when known, and a specific reason for waiting. Preserve raw local output with live follow, pause-follow, search, copy, and export. Do not invent completion percentages or treat check counts as elapsed-time estimates.

**PRD-RUN-003: Summary before detail.** A run summary states what was requested, what happened, the affected commit range, effective profile, and the next useful action. Selecting a check reveals its command, outcome, duration, input or reuse explanation, and log section. Preserve existing useful repair records and validation evidence instead of reducing failures to a generic red badge.

**PRD-RUN-004: Persistent history.** Reopening the app, switching repos, restarting the UI, or reconnecting to the Mini must allow the user to inspect retained past and current attempts. A missing completion event is interrupted or unknown until reconciled. A previous failure remains historical after a newer applicable success resolves it. Reporting cannot silently change a gate's exit result.

**PRD-RUN-005: Practical retention.** Retain raw logs for 30 days by default and summaries for one year. Apply a configurable disk cap with visible usage and an explanation of what will be removed. Allow the user to pin failure records and their associated evidence against automatic eviction. Do not automatically discard active runs or unacknowledged handoff evidence. If preserved data prevents meeting the cap, report that condition, retain the material, and pause admission of affected new jobs until the user frees space or raises the cap. Do not silently turn a disk cap into unlimited growth or delete pins to meet it. Exports remain user-controlled.

**PRD-RUN-006: Evidence availability is explicit.** Locally captured output is live. GitHub job and step state updates as remote observations arrive, while remote logs are shown when GitHub exposes them and credentials permit retrieval. Do not promise live streaming of GitHub output that its interface does not provide. Distinguish not-yet-available, expired, denied, and unavailable logs. Retained local summaries should continue to explain the outcome if remote logs expire.

## 8. GitHub state and notifications

**PRD-GITHUB-001: Follow relevant remote activity.** Monitor configured repositories for associated checks and PRs, including activity initiated outside Contribution. Relevant scheduled and manual workflow failures remain visible even when they are unrelated to a PR. Correlate repository, refs, commit identities, remote run attempts, and PR identity. Label remote-only activity honestly rather than inventing a local push. Polling or other supported transport is an architecture choice, with visible freshness and appropriate backoff.

**PRD-GITHUB-002: Current merge readiness.** “Ready to merge” requires a current, non-draft PR whose applicable required checks, review rules, and GitHub merge conditions are satisfied. A green result for an older head is insufficient. Reassess after head or relevant base changes. Unknown or pending calculations remain unknown or checking. Repositories without a PR or required checks receive accurate states rather than synthetic failures or successes.

**PRD-GITHUB-003: Required and optional failures.** Display GitHub failures even when they do not block merging. Clearly label nonblocking failures and separate them from the required-check verdict. Keep deployment status distinct. Opening a ready PR is part of the first complete version. Enabling automatic merge or deployment is not.

**PRD-NOTIFY-001: Milestones, not chatter.** Notify for local gate pass and failure, Git transport success and failure, GitHub failures, and a current PR becoming ready to merge. Name the repo and milestone. Group or update notifications belonging to one operation so a quick check-pass and delivery-success transition does not create a pile of banners. Individual passing checks, cache reuse, ordinary sync, and routine disconnected waiting stay in the activity view.

**PRD-NOTIFY-002: Correct destination and deduplication.** Notifications link to the exact retained run, failed check, or PR. Deduplicate across repeat observations, app restarts, and both Macs. Default notification delivery to the MacBook when it is the chosen interactive device, with a preference to use either Mac. On reconnect, show current actionable outcomes and a concise catch-up view. Suppress obsolete alerts for failures or readiness that newer state has superseded.

**PRD-NOTIFY-003: Respect attention.** Use ordinary macOS notifications and in-app attention states. Do not open Sublime tabs or steal focus by default. The user can opt into raising a failure window. Denied notification permission must leave all activity visible and must not block execution. A failure of the viewer or notification channel cannot turn validation off.

**PRD-NOTIFY-004: Fast agent handoff.** Provide a focused repair prompt with repository identity, exact affected commits, failure details, evidence references, and the narrowest useful next step. It must preserve unrelated work and avoid an implicit push instruction. A documented Codex deep link or other supported integration may open that context. Copying the prompt and opening the project are the dependable fallback.

**PRD-NOTIFY-005: Device-operation notifications.** When Remote Devices is enabled, use the same notification and activity system for verified installation, a failed requested operation, and concrete user actions such as unlocking the phone. Installation success and launch failure can appear in the same receipt with separate results. Avoid repeat alerts during normal reconnection and do not expose exact device identifiers or private logs in notification text.

## 9. Window structure and accessibility

**PRD-UI-001: Three useful levels.** Provide a consolidated view, a repository view, and a run detail view. The consolidated view groups **Needs attention**, **Running or queued**, and **Recent activity**. Support search and filters for repository, host, outcome, and date. The repo view filters that same information and adds branch, owner, handoff, push-needed status, and the publication action. Run detail provides summary, check list, and logs without losing navigation context.

**PRD-UI-002: Compact menu bar.** The menu-bar item indicates running work and actionable problems. Its panel shows a short current-activity list, connectivity, and access to the main window. Large logs and configuration forms belong in the window. The product must remain understandable when all operations are idle.

**PRD-UI-003: Compact settings.** Organize settings around repositories, devices, notifications, storage, and updates. Show effective values and meaningful overrides without a wall of implementation terminology. Detailed diagnostics open in a dismissible sheet or dialog with copy and export actions. Do not expand long diagnostic accordions into the settings page.

**PRD-UI-004: Accessible operation.** Support keyboard navigation, visible focus, VoiceOver labels, text selection, readable contrast, and reduced-motion preferences. Status cannot depend on color alone. A resizable window must preserve useful log and summary layouts. Log autoscroll pauses when the user reads earlier output and resumes through an explicit control. Loading and stale states must remain legible rather than blank.

**PRD-UI-005: Remote Devices fits the existing window.** Add a Devices destination only when enabled and contextual Build and Install actions for configured iOS projects. Select the host, approved phone, project, and build. Display current readiness, operation-specific availability, requested action, and one useful next step. Reuse run detail for progress, logs, cancellation, and reconciliation. Place pairing setup, qualified capabilities, and technical connection details in the existing settings and diagnostics patterns. The ordinary Git workflow stays compact when this module is disabled.

## 10. Updates and operational quality

**PRD-UPDATE-001: Stable installed behavior.** Contribution has its own source repository and an installed version separate from unfinished source changes. An agent in another project can locate that repo, follow its instructions, make changes in a supported isolated worktree, validate them, and land them through its normal workflow. Editing source does not install or publish it automatically.

**PRD-UPDATE-002: Low-effort safe updates.** Provide update discovery, an understandable version state on both Macs, compatible activation between jobs, and rollback to the prior supported version. Running jobs retain the version and configuration needed to explain their results. A peer compatibility problem should queue the affected operation with a useful action, not fall back to unsafe behavior.

**PRD-QUALITY-001: Recoverable operation.** UI restarts, worker interruption, network loss, machine sleep, and duplicate requests must preserve known source and run state. Show the difference between accepted work, completed work, and uncertain outcomes. Test recovery using the acceptance plan before claiming reliable unattended use. The Mini's always-on role does not override macOS login, power, credential, or native-tool requirements.

**PRD-QUALITY-002: Performance targets.** The following are engineering targets for representative enrolled repositories, not measured product promises. Validate them on both actual Macs and revise with evidence if a target conflicts with correct execution.

| Interaction | Target |
|---|---|
| Open a cached repository or run view | Useful content within 1 second |
| Submit an operation | Visible local receipt or queued acknowledgment within 1 second, with remote acceptance shown separately |
| Display emitted local log output | Normally within 1 second |
| Discover a changed active GitHub result | Normally within 30 seconds while monitoring active work, subject to API limits |
| Resume eligible queued handoff after confirmed reconnection | Begin within 10 seconds when resources are available |
| Idle operation | No continuous repo-wide file scans, rebuilds, model calls, or busy polling |

These targets describe Contribution overhead. They do not promise a build duration, GitHub scheduling time, or network throughput.

## 11. First complete version and later work

**PRD-SCOPE-001: Complete first-version outcome.** The first complete version includes installable macOS packaging, app and agent access to the same engine, simple enrollment and new-project defaults, preservation of existing policies, native Codex lifecycle integration, Mini-owned automatic committed-work handoff, explicit managed GitHub pushes, precise push-needed status, durable logs, current GitHub/PR monitoring, requested notifications, and safe updates. Both Macs must pass the relevant end-to-end acceptance scenarios.

Migrate in slices so current projects remain usable. Reporting adapters can ship first, followed by shared mechanics and two-Mac authority as described in the migration plan. Keep unsupported or unfinished features visibly unavailable. Do not replace that phased delivery with a claim that a log viewer alone satisfies the complete scope.

**PRD-SCOPE-002: P1 extensions.** Consider richer GitHub merge controls, optional automatic publication policies, additional hosts, and broader agent integrations only after the first version is reliable. Public distribution polish can follow actual usage. None requires a new generic framework or a change to the initial macOS and Codex focus.

**PRD-SCOPE-003: Preserve the added remote-development target.** Remote Devices is an optional installed feature with required planned capabilities. Optional installation does not make its stated requirements optional once enabled. D0 and D1 investigate the hard transport boundary early. D2 delivers a verified in-place development update. D3 qualifies launch, logs, signed tests, accessibility interaction, and the desired interactive debugging workflow independently. D4 proves lifecycle, host transfer, privacy, retention, and compatibility. Publish separate core and device-module verification status. A useful core release can ship while a remote capability remains explicitly unresolved.

## 12. Remote iPhone development

Document 08 retains the full requirements and acceptance text. These product requirements connect that scope to Contribution's existing behavior without replacing the RDEV IDs.

**PRD-DEVICE-001: Two independent development hosts.** Support the Mac Mini and MacBook Pro as separately provisioned build and device-operation hosts. Either may work while the other is off, once any earlier ownership has been released or reconciled. Keep each host's signing assets and Apple trust records private. Bind every mutation to an approved host, phone, project, bundle/team identity, immutable artifact, and operation ID. Covers RDEV-01 through RDEV-04, RDEV-07 through RDEV-09, and RDEV-13.

**PRD-DEVICE-002: Honest network coverage.** Target remote Wi-Fi, isolated guest networks with working internet, mixed Mac Ethernet/Wi-Fi arrangements, tethering, and phone cellular. Record the actual route and prerequisite state. Distinguish a warm session carried from Wi-Fi from a fresh cellular developer connection after deliberate teardown or restart. Test cold cellular during D1. A failed or unavailable path remains an explicit unresolved capability. Covers RDEV-05, RDEV-06, RDEV-18 through RDEV-20, and RDEV-24.

**PRD-DEVICE-003: Build, install, and launch are distinct.** Preparation can finish while the phone is offline. Installation verifies the intended device and installed bundle/version through actual readback or a documented device-side verification method. Preserve app data, Keychain access, configuration, and project identities. Never uninstall as a connectivity repair. Launch is separately requested and may fail after installation succeeds. Covers RDEV-08 through RDEV-12, RDEV-21, RDEV-27, and RDEV-37.

**PRD-DEVICE-004: Complete developer operations stay in scope.** Plan and qualify bounded app logs, signed native tests, accessibility interaction, explicit screenshots where requested, and interactive debugging. Prove each operation on its claimed backend/version/network combination. Installing an app is not an Xcode Run destination or debugger proof. Covers RDEV-14 through RDEV-17 and RDEV-28.

**PRD-DEVICE-005: One shared operation model.** UI, CLI, and agents use the existing journal, identity, policy, progress, cancellation, and reconciliation mechanisms. Use an authenticated, narrowly scoped command path to the selected Mac. Qualify an actual initiation path when the owner travels with only the phone and the Mini stays home. Reuse available supported remote agent access, or supply a small authenticated tailnet browser control surface within the existing service if that is needed to satisfy the scenario. Do not expose a dependency's unrestricted tunnel API or provide a general remote shell as the device interface. Resolve uncertain effects before retrying. Covers RDEV-13, RDEV-20 through RDEV-28, RDEV-33, and RDEV-34.

**PRD-DEVICE-006: Explicit device ownership.** Serialize incompatible Contribution operations and account for known Xcode/test activity. Switching hosts releases or reconciles the former session before the new host acquires authority. An expired lease alone cannot prove the old Mac stopped acting on the phone. Show an unconfirmed previous owner when necessary, preserve unrelated processes, and use the smallest specific recovery action. Covers RDEV-22, RDEV-23, RDEV-38, and RDEV-39.

**PRD-DEVICE-007: Qualified alternatives and no-client default.** Keep native Apple tooling as the established baseline and investigate a pinned go-ios adapter first for remote operations. A private OTA route is a separately qualified installation fallback with its missing capabilities visible. Do not add a permanent custom iOS client until an evidenced OS/API gap and a viable solution justify one. Tailscale plus ordinary Apple developer prerequisites is the baseline phone setup. Covers RDEV-29 through RDEV-32 and RDEV-36.

**PRD-DEVICE-008: Private, project-aware evidence.** Keep pairing and signing material out of Git, general synchronization, logs, and manifests. Store only the evidence needed for an operation under private retention. Reuse project authority and migration rules. A Roboty development update does not authorize robot motion, product actions, workspace-history merging, release distribution, or changing its product-to-Mac pairing. Covers RDEV-33 through RDEV-40.
