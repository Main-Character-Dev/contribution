# Contribution acceptance tests

> Maintained requirement baseline, imported from package revision 2. Product implementation remains planned. The current next step is [S0 repository setup](../REPOSITORY_SETUP.md), bounded by the [setup prompt](../SETUP_PROMPT.md). [Review amendments](../REQUIREMENTS_REVIEW.md) clarify this baseline. Private source material remains external; see [provenance](../SOURCE_PACKAGE.md).

## Purpose and release standard

These scenarios define the observable behavior required for the first complete version of Contribution. They test the workflow, retained evidence, and recovery guarantees. They do not prescribe a test framework or require unit tests that repeat the implementation.

The first version includes standalone local ownership, real push execution, GitHub monitoring, and optional pairing with durable Mini handoff. Both operating modes require proof. A log viewer or single-machine demonstration alone does not satisfy the complete scope.

State names below describe required meanings. Use the exact versioned CLI schema defined in [03-AGENT_CONTRACT.md](03-AGENT_CONTRACT.md). UI wording can be shorter, but must convey the same outcome. A check result, Git delivery, landing receipt, and PR readiness must remain independently inspectable.

## Test environments and evidence

Use three levels of evidence:

| Level | Environment | What it establishes |
|---|---|---|
| Fixture | Disposable repositories, controlled subprocesses, local SSH endpoints where available, and recorded or fake GitHub responses | Deterministic state transitions, Git behavior, error handling, and repeatable recovery |
| Mac | A real Mac with disposable projects and installed app services | Native UI, CLI packaging, process supervision, notifications, installation, and update behavior |
| Two Macs | The authorized MacBook and Mini, with disposable projects and an explicitly authorized GitHub test repository | Real Tailscale/SSH handoff, sleep and reconnect behavior, remote execution, and complete publication tracking |

Run fixture tests first. Use existing audited repository evidence to construct representative fixtures. Existing project branches, working files, hooks, CI rules, services, and production credentials are not disposable test resources. Do not push, merge, delete worktrees, change profiles, or disable services in real projects merely to demonstrate a test.

Real-host tests can proceed when the relevant hosts, credentials, and intended test operations are authorized and available. A missing prerequisite produces a **blocked** result with the exact missing evidence. It never becomes a passing test by substituting a mock without saying so.

Maintain a compact release evidence record containing:

- Test ID, result, environment level, date, app version, host role, and relevant runtime versions.
- Operation IDs and fixture commit/ref identities sufficient to reconstruct the result.
- Sanitized expected and actual outcomes, plus selected logs or screenshots where needed.
- For blocked or failed tests, the remaining action and affected release capability.

Compare working files, refs, and retained incoming commits before and after preservation tests. Check outcomes through the public CLI and visible app state. Do not establish success solely by inspecting an internal database flag.

## A. Agent interface and shared behavior

| ID | Prerequisites and action | Required outcome |
|---|---|---|
| AT-A01 | Register a fixture repository. Start an operation through the CLI, follow it in the app, then start another through the app and inspect it through the CLI. | Both clients report the same operation identity, host, code version, phase, and final result. Switching clients does not start another job. Essential operations remain available without the GUI. |
| AT-A02 | Invoke documented JSON commands with no terminal or interactive input. Exercise success, validation failure, waiting, and an unavailable host. | Output conforms to the advertised schema and exit-code contract. Machine output is not mixed with progress prose. Errors name the affected operation and useful next action. Routine operations require no model call. |
| AT-A03 | Submit the same operation request repeatedly, including concurrently and after completion. Reuse its idempotency key with different inputs. | Identical submissions return one accepted operation and one effect. Changed inputs with the same key return a conflict. An intentional retry creates a linked new attempt without overwriting the original. |
| AT-A04 | Request a mutation with an ambiguous repository, invalid destination, unsupported option, or unknown schema version. | The request fails before mutation with structured details. An agent can resolve the problem from supported commands. No hidden interactive prompt, arbitrary default repository, or accidental publication occurs. |
| AT-A05 | Change a supported repository policy or machine preference through each documented app and CLI configuration route. Include an invalid change and an active operation. | Both routes expose the same effective values and validation. Invalid changes have no partial effect. A setting change does not silently alter an accepted operation's source, destination, or policy, or reinterpret its historical evidence. |

## H. Handoff, ownership, and landing

| ID | Prerequisites and action | Required outcome |
|---|---|---|
| AT-H01 | Finish a task with committed changes and submit it from the MacBook. Inspect progress before transfer, after Mini receipt, after landing, and before publication. | Local queued, Mini received, landed, and GitHub delivered are distinct states. Mini receipt is acknowledged only after the request and necessary commits are durably retained. The receipt maps source commits to the resulting landed commits. Handoff does not accidentally invoke the GitHub publication gate. |
| AT-H02 | On two real Macs, submit a job, wait for durable Mini acceptance, then close the MacBook and both activity windows while the job runs. | The Mini finishes independently of the SSH session and UI. Reopening the laptop retrieves the same operation and retained result. A publication test includes actual Git delivery and subsequent GitHub monitoring. |
| AT-H03 | Disconnect before acceptance, during commit transfer, and after Mini persistence but before its acknowledgement reaches the client. Reconnect and resubmit. | The laptop never falsely claims remote receipt. Incomplete transfers can resume or restart safely. A durably accepted request is found by its identity and is not landed or pushed twice. Source work remains recoverable throughout. |
| AT-H04 | Keep the Mini unavailable while new tasks are committed and submitted. Restore connectivity. | Work stays queued locally, with visible host status and bounded retry behavior. The laptop does not become canonical owner automatically. Accepted work resumes in the intended order when the Mini returns. |
| AT-H05 | Interrupt the Mini worker before landing, during integration, and immediately after the destination ref changes but before the receipt is finalized. Restart it. | Recovery reconciles retained intent with actual Git state. Already-applied work is not applied again. Incomplete integration produces a recoverable state. An uncertain outcome is reported explicitly rather than guessed from process disappearance. |
| AT-H06 | Run landing and push requests concurrently for one repository, including an existing adapter using its legacy coordination lock. Also run a second independent repository. | One repository's conflicting operations serialize under compatible coordination. Other repositories can proceed within resource limits. An active legacy lock is respected. Lock reclamation requires valid owner evidence, not elapsed time alone. Shared simulator or build resources retain their own coordination. |
| AT-H07 | Create a new paired project, initialize an existing unborn repository explicitly, then interrupt and retry canonical seeding. Repeat against a destination with existing history. | Creation commits only generated Contribution configuration and guidance. Existing unborn enrollment does not commit until `repos initialize` is requested, and unrelated files stay untouched. Seeding requires an empty target, retained commits, and durable idempotent acceptance. Retries recover the same seed. Existing destination history is preserved. |
| AT-H08 | Submit one-commit and multi-commit tasks through the new-project generic adapter. Omit required combined metadata, change that metadata under a reused request ID, and repeat an already landed source. | Landing produces the documented provisional task commit and exact source receipt. Original author metadata and explicit messages follow the default policy. Missing metadata waits for input, changed request semantics conflict, and an already integrated source is not applied again. Adopted repository attribution remains unchanged. |

## M. Primary mirrors and worktree preservation

| ID | Prerequisites and action | Required outcome |
|---|---|---|
| AT-M01 | Give the MacBook a clean primary that is an ancestor of the canonical Mini branch. Land new work on the Mini and reconcile. | The intended mirror fast-forwards to the canonical version. Task worktrees remain independent. Git transfers objects and refs without copying Git metadata directories, lock files, or worktree administration between hosts. |
| AT-M02 | Repeat reconciliation with staged changes, tracked edits, and untracked files that conflict with incoming paths. Include ignored local assets. | Existing files and index state are preserved. Unsafe updates wait with an actionable reason. Contribution does not silently stash, commit, clean, reset, or discard user work. Ignored files are not treated as transferable project state. |
| AT-M03 | Create unique commits on both primaries, a locally ahead branch, and an unrelated history. Request reconciliation. | No force update, guessed winner, automatic rebase, or timestamp-based selection occurs. The app identifies the condition and preserves every history for a deliberate integration or configuration action. |
| AT-M04 | Test missing checkout paths, an unborn repository, a detached checkout, nondefault native worktree roots, and stale worktree registrations. | Each case has an explicit setup or repair outcome. Existing directories are not overwritten. A new repository can follow the documented initial-commit path. No task worktree or reachable commit is deleted merely because its path is missing, old, or unfamiliar. |

## P. Push execution and transport truth

| ID | Prerequisites and action | Required outcome |
|---|---|---|
| AT-P01 | Test equal local/remote refs, unpublished commits, a new remote branch, no configured destination, stale remote observations, and an integration branch without an upstream. | The app shows Up to date, Push with a count, Publish branch, a freshness indication, or a configuration action as appropriate. A configured destination works without assuming `main` or an upstream. Stale information cannot imply freshly confirmed equality. A no-op does not run a full gate or claim new delivery. |
| AT-P02 | Push through Contribution with the repository hook installed. Count calls to the configured validation commands. | The wrapper and hook correlate to one attempt. The full gate runs once. The wrapper observes actual transport completion. Gate outcomes and Git delivery are recorded separately under the same operation. |
| AT-P03 | Queue a push for a captured integration tip. Submit new work while that push waits for its lock and while validation is running. | The accepted publication scope follows the documented snapshot contract. New work cannot silently enlarge the push. Validation, final ref checks, and delivery cover the same intended code. Later work remains visibly queued or unpublished. |
| AT-P04 | Advance the GitHub destination from another actor while the gate is running. Separately alter the local primary outside Contribution's lock protocol. | Final identity checks detect relevant changes. Stale validation is not used to publish different code or a different outgoing range. The attempt stops or revalidates through the documented policy, with no force overwrite of the remote. |
| AT-P05 | Make Git fail before the hook runs. Separately fail a gate, then pass a gate while the remote rejects delivery. | Pre-hook failure shows that checks did not run. A failed gate prevents delivery. Remote rejection after a passing gate shows both facts and keeps the unpublished-work indication. No failure is flattened into a generic passed or completed label. |
| AT-P06 | Drop the connection after sending a push but before receiving the final result. Test both a remote that accepted it and one that did not. | Delivery is initially unknown. Recovery observes the intended remote ref before deciding the next action. It does not blindly replay the push. Later evidence is identified as remote observation, including intervening remote movement that prevents certainty. |
| AT-P07 | Cancel while queued, while a check runs, and during Git transport. Include a child process spawned by the check. | Queued work does not begin. Active processes receive the documented cancellation and bounded termination behavior. Other jobs survive. Cancellation during transport can remain uncertain until reconciled. No cancellation deletes retained source commits or is reported as a validation pass. |
| AT-P08 | On the canonical owner, push through an external Git client that runs only the installed hook. Test passing and failing gates, then independently observe the remote. | The hook supplies reliable gate evidence. A passing hook alone does not claim delivery. Later remote evidence remains distinguishable from observing that client's command exit. Contribution's own push has the stronger end-to-end result. |
| AT-P09 | Request unsupported multi-ref publication through Contribution. Supply an observed external push with mixed per-ref outcomes. | Unsupported scope is rejected before mutation. If external partial results are available, preserve them per ref and show a partial or uncertain result. Never claim every ref succeeded because one did. The implementation does not expand its supported push scope accidentally. |
| AT-P10 | After paired authority cutover, attempt raw publication from the companion through its installed hook, including a repository with an inactive validation gate. | The ownership guard refuses before transport and points to Contribution's managed Push action. It neither enqueues a second publication nor activates inactive validation. Canonical-owner external pushes retain AT-P08 behavior. |
| AT-P11 | Obtain a preview `scopeToken` and matching `--expected-tip`. Change the resolved destination, active branch, or policy while keeping the commit unchanged, then submit the old selection. | Each same-tip drift is rejected before execution. The token binds the displayed publication scope, not just its commit. An unchanged valid selection succeeds, and accepted scope remains fixed through waiting and retries. |

## V. Profiles, selection, and reusable validation evidence

| ID | Prerequisites and action | Required outcome |
|---|---|---|
| AT-V01 | Enroll representative Mathy, Main Character, Roboty, and Glass Alpha configurations, plus a new project. | Existing behavior is preserved: the substantial gates remain substantial, Roboty retains its cheap local policy, and Glass Alpha remains inactive. The new project defaults to Local development. Enrollment does not silently weaken or activate existing policy. |
| AT-V02 | Push a Local development fixture with expensive commands instrumented to reveal accidental execution. Run its configured inexpensive checks. | Only the configured local gate and necessary Git protections run. The result names the profile and checks performed. It makes no claim that a release suite passed. Measure orchestration overhead separately from check runtime. |
| AT-V03 | Exercise representative changed-file selections, cumulative validation ranges, policy-only landing, and final pushed-tree verification using the migration fixtures. | Selection and enforcement match the repository's recorded policy. Landing completion is not presented as full validation. Unexpected selection drift blocks that adapter's migration until explained and accepted. |
| AT-V04 | Reuse valid evidence, then change its declared source inputs, configuration, check version, dependency/runtime environment, and host compatibility conditions individually. | Reuse follows the declared evidence contract. Relevant changes invalidate it. Always-live checks remain live. Evidence copied from another host is not trusted without the required compatibility proof. Reused evidence remains visibly different from newly executed checks. |
| AT-V05 | Exercise inactive, unselected, skipped, reused, passed, failed, interrupted, and optional diagnostic outcomes. Include a command that prints the word "failure" but succeeds by policy. | Results follow structured command and policy outcomes. Disabled or unexecuted checks do not turn green as executed passes. Text matching does not override exit status or explicit optional-check semantics. Notifications retain the correct gate scope. |
| AT-V06 | Give a local task and canonical checkout different contents. Run checks with `--source-path` while the Mini is offline, then request `--canonical`. | Source checks run against the selected local checkout and record its actual identity and dirtiness. Canonical checks use the owner or report its unavailability. Neither silently substitutes the other checkout or treats local task proof as completed publication validation. |

## G. GitHub checks and PR readiness

| ID | Prerequisites and action | Required outcome |
|---|---|---|
| AT-G01 | Return successful checks for an old PR head and pending checks for the current head. Also supply a valid GitHub test-merge SHA association. | Old results cannot establish current readiness. GitHub's actual head or test-merge association is respected. Missing, stale, or ambiguous associations stay unknown or checking instead of inheriting an old green result. |
| AT-G02 | Fail a CI attempt, rerun it successfully, then send delayed events from the failed attempt. | Current state follows the correct workflow run and attempt. The old failure remains in history but stops marking the repository as currently blocked. Delayed observations do not regress the current state or duplicate notifications. |
| AT-G03 | Vary draft state, required checks, review rules, unresolved conversations, conflicts, and branch freshness. Include zero required approving reviews and unavailable rule information. | Readiness follows the repository's actual applicable rules. No universal reviewer count is assumed. Allowed skipped or neutral outcomes are handled correctly. Unknown required information cannot produce Ready to merge. New unpublished local work is shown independently. |
| AT-G04 | Fail a nonblocking CI job while required jobs pass. Test repositories with no active CI or no PR. | The failure is visible and notifies when failure notifications are enabled, without inventing a merge blocker. No configured CI is shown as not configured, not as a passing suite. No PR is a distinct state rather than a monitoring error. |
| AT-G05 | Observe an existing PR automation flow, an externally initiated push, a newly merged PR, and a closed historical PR on the integration branch. | Contribution associates current activity without creating duplicate PRs or guessing branch rotation. It follows the repository's branch policy. Ready, merged, closed, and deployed remain different outcomes. GitHub status and available logs link to the correct run or job. |
| AT-G06 | Leave an enrolled repository idle with no tracked operation or PR. Trigger an external, manual, or scheduled workflow failure through a controlled GitHub response. | Slow idle discovery finds the new activity without requiring a Contribution push. The failure appears and notifies under current preferences, with its external origin and correct run. Polling remains bounded and rate-aware. |

## O. Logs, notifications, and status usability

| ID | Prerequisites and action | Required outcome |
|---|---|---|
| AT-O01 | Start two attempts close together, with one rejected by an occupied primary lock. Open the first attempt's live log during the second. | Each attempt has its own retained log and identity from request creation onward. The second attempt cannot truncate the first attempt's display. Latest is a query over attempts. Retries preserve previous evidence. |
| AT-O02 | Stream substantial output, switch between all-repository and per-repository views, scroll backward, reconnect, and reopen a completed run. | Logs remain associated with the correct operation. Selection and useful viewing position are retained. Scrolling pauses live following. Search, copy, and export work. Counts and elapsed time reflect evidence, without fabricated percentages or completion estimates. |
| AT-O03 | Generate gate success/failure, transport success/failure, blocking and nonblocking CI failures, and PR readiness on both Macs. Repeat observations. | Notifications contain the correct repository, result, and destination action. Required successes and failures are supported, with sensible grouping. Repeated polling does not repeat notices. The selected notification device is honored and other devices retain history. |
| AT-O04 | Disconnect the laptop while events arrive. Resolve an old failure before reconnecting. Disable notification permission and exercise an OS delivery failure. | Reconnection presents current actionable results with occurrence and observation times. It avoids replaying a stale notification flood. Notification failure never changes gate enforcement or job success. Unresolved problems remain visible in the app. |
| AT-O05 | Apply the configured log age and disk limits, pin a failure, fill the offline cache, and request an older uncached log while the Mini is absent. | Retention is bounded and explicit. Pinned evidence follows documented limits. Missing remote logs show an availability reason. Cleanup never removes source worktrees, active-operation evidence, or incoming Git refs still needed for recovery. |

## E. Enrollment and native Codex boundaries

| ID | Prerequisites and action | Required outcome |
|---|---|---|
| AT-E01 | Enroll through both the app and CLI using different absolute paths on each Mac. Discover multiple native worktrees and two distinct repositories with similar names. | One repository has one identity with separate host-path mappings. Worktrees group correctly. Names alone do not merge unrelated projects. Enrollment reuses existing settings and reports missing prerequisites without silently changing publication policy. |
| AT-E02 | Use verified Codex capabilities for opening a project, repair context, and native Handoff. Test a version where saved-project mirroring has no documented interface. | Supported actions work with correctly encoded paths and prompts. A clear manual Add Project step handles the unsupported case. No private Codex database edits, undocumented session manipulation, or fragile click automation is introduced. |
| AT-E03 | Perform native Handoff and Contribution submission around the same task. Also run the utility where a supported optional Codex integration is unavailable. | Native session movement does not falsely establish canonical landing or durable Mini receipt. Reconciliation prevents duplicate effects. The utility's supported CLI workflow remains usable, with a capability-specific fallback rather than a global workflow failure. |
| AT-E04 | On one Mac with no Mini pairing or Tailscale, create and enroll a standalone repository, land a task, check publication status, and push to a disposable remote. | The local Mac owns its queue, canonical branch, checks, publication, and monitoring. No peer prerequisite blocks those operations. Deliberate `this-mac` ownership is never confused with automatic failover of an existing companion repository. |

## U. Installation, updates, and independent execution

| ID | Prerequisites and action | Required outcome |
|---|---|---|
| AT-U01 | Install a distributable build on a real Mac and invoke its bundled CLI. Edit Contribution's source checkout while a job runs. | Signed/notarized release verification succeeds for a release build. The installed engine and runtime are self-contained as specified. Source edits do not change installed behavior or in-flight jobs. A development build is clearly distinguished from release distribution evidence. |
| AT-U02 | Stage an update while operations are queued and running, then complete the update and resume work. | Accepted source, destination, and policy remain frozen. Each attempt pins its executable at start. Active attempts drain before installation. Queued work survives and revalidates compatibility before starting, without adopting changed publication scope. Updates do not strand subprocesses, lose logs, or leave incompatible locks. |
| AT-U03 | Connect Macs running supported adjacent versions and an incompatible protocol version. Retry an accepted old-version request. | Compatible versions preserve request and receipt semantics. Incompatible operations wait with an actionable update requirement. No destructive partial execution occurs. Previously accepted work and idempotency identities remain recognizable. |
| AT-U04 | Exercise an update failure, executable rollback, and a data migration that cannot be read by the older version. | Rollback follows an explicit schema compatibility policy. The app does not silently run an old binary against incompatible state. Migration recovery preserves acknowledged jobs and evidence. Restoring a database does not pretend external Git effects were undone. |
| AT-U05 | Run with the GUI closed, restart the worker, restart the Mac, and inspect the documented pre-login and post-login behavior. Also break a service executable path in a disposable installation. | Headless jobs and monitoring follow the advertised startup boundary. Unsupported pre-login operation is stated accurately. Recovery preserves accepted work. Missing services produce a bounded retry and useful diagnostic, not an endless rapid restart loop. No test disables device security to manufacture availability. |

## Release traceability and completion

| Requirement area | Acceptance coverage |
|---|---|
| Agent-native interface and app parity | AT-A01 through AT-A05 |
| Mini authority, bootstrap, durable handoff, offline recovery | AT-H01 through AT-H08 |
| Safe primary updates and native worktree preservation | AT-M01 through AT-M04 |
| Push initiation, accurate scope, delivery, and cancellation | AT-P01 through AT-P11 |
| Local development profile, check location, and policy preservation | AT-V01 through AT-V06 |
| GitHub monitoring and readiness | AT-G01 through AT-G06 |
| Persistent logs, notifications, and consolidated views | AT-O01 through AT-O05 |
| Standalone ownership, enrollment, and supported Codex integrations | AT-E01 through AT-E04 |
| Packaging, updates, version compatibility, and background service | AT-U01 through AT-U05 |

Before calling the first version complete, retain evidence of one full authorized two-Mac workflow: register a disposable project, complete a committed task on the laptop, submit it, sleep the laptop after durable acceptance, land on the Mini, run the selected gate, deliver to GitHub, observe CI and PR readiness, then reconnect and inspect the same history. Also demonstrate a failing gate and an uncertain transport result through the recovery paths above.

Each real repository migration additionally requires its profile and validation parity evidence. A successful Roboty local-mode demonstration does not establish Mathy or Main Character parity. Glass Alpha enrollment must demonstrate that its inactive gate remains inactive unless a separate policy change was requested.

Report **implemented**, **fixture-verified**, **Mac-verified**, and **two-Mac-verified** separately. A working implementation with blocked real-environment proof can be handed over with a precise remaining checklist. It must not be labeled fully verified or ready for unattended use across all repositories until the relevant acceptance evidence exists.

## D. Remote iPhone development acceptance

This section integrates the remote module's complete original acceptance matrix, whose single canonical copy is [section 15 of 08-REMOTE_IPHONE_DEVELOPMENT.md](08-REMOTE_IPHONE_DEVELOPMENT.md#15-original-remote-acceptance-matrix-retained-verbatim). The 54 core scenarios above remain unchanged. The 24 device rows in that document bring the combined plan to 78 unique acceptance scenarios. Core release qualification and remote capability qualification remain separate.

### Environment, evidence, and release meaning

Run applicable physical-device cases on both Macs. Fixture/unit tests complement them and exercise the shared admission, identity, capability, event, cancellation and reconciliation contracts. They do not establish network, Apple trust, signing, installation, data-retention, test-runner or debugger acceptance. Use an owner-approved test app/data fixture before changing a valuable product when a route could affect identity or data.

Each physical result must include the following private evidence, with redacted summaries suitable for ordinary logs and reports:

- Test ID, operation ID, selected host and physical phone identity, source/artifact reference, and exact app bundle/team/version/build.
- Actual Mac, Xcode, phone/iOS, Tailscale and backend versions, plus signing/export mode and current authorization.
- The phone's real underlay and usable connections, chosen route, direct or relayed path, warm or cold session history, and observation times.
- What was requested, the actual named operation performed, device-side readback or observed test/debug behavior, effect certainty, and missing proof.
- Required owner actions, meaningful persisted-fixture state before and after, scoped cleanup, and links to controlled logs/evidence.

Classify each case as not exercised, fixture verified, physically verified on one named host, physically verified on both named hosts, blocked, or failed. Record unsupported combinations with their evidence and leave the corresponding target requirement open. A reported upstream success or a compiled prototype is not a physical pass. Do not inherit a passing result across hosts, versions, backends, signing modes or network contexts without the relevant proof.

The core M0 through M6 product can ship with a clearly reported remote subset or with the module disabled. The full remote target is incomplete while required cellular access, operations, data continuity or recovery evidence is missing. Installation-only or OTA qualification cannot silently remove the planned launch, logs, tests/UI or debugging work.

### Original device acceptance matrix

Execute every applicable [AT-01 through AT-24 row in the canonical remote matrix](08-REMOTE_IPHONE_DEVELOPMENT.md#15-original-remote-acceptance-matrix-retained-verbatim). Preserve those IDs in evidence records and completion reports. Do not copy the table into another maintained test specification or omit a row because only an earlier capability shipped.

AT-08 through AT-10 require proof that the prior developer session was absent and the phone actually used cellular. A warm tunnel, hotspot use, ping or successful Safari fetch cannot substitute. Use actual device readback or the relevant observed test/debug behavior for the named operation.

### Integrated phase coverage

| Device phase | Core dependency | Acceptance focus |
|---|---|---|
| D0. Inventory, ownership, and prerequisites | M0 | Establish the actual compatibility, signing, trust, session and host facts needed to run the rows. No acceptance is inferred from inventory |
| D1. Remote Wi-Fi and cold-cellular feasibility | M1 journal and scoped dispatch. Earlier isolated read-only investigation is allowed | Baseline AT-01/AT-02, then early AT-06, AT-08, AT-09 and AT-10. Retain AT-03/AT-05 route variants and AT-20 fallback investigation where relevant |
| D2. Verified build and in-place install | M1/M2 execution and project adapter parity | AT-01 through AT-05, AT-11 through AT-13, AT-16/AT-17 and AT-20 if selected, with independent evidence on both Macs |
| D3. Launch, logs, tests, UI, and debugging | D2 | AT-04/AT-17 for launch, AT-18 for separately named logs, native tests and accessibility interaction, and AT-19 for actual debugging |
| D4. Recovery, host transfer, retention, and release | M6 release integration | AT-06 through AT-15 and AT-21 through AT-24, plus teardown/data/privacy/revocation proof for every claimed backend and selected OTA route |

The exact RDEV-01 through RDEV-40 mapping to these rows is maintained in [08-REMOTE_IPHONE_DEVELOPMENT.md](08-REMOTE_IPHONE_DEVELOPMENT.md). Every incomplete row stays visible in the canonical verification/deferred-work record, including cases that fail an early feasibility gate.

### Required cross-cutting assertions

Apply these assertions within the listed rows and shared contract tests. They add specificity without replacing or weakening any original row.

| Assertion | Coverage |
|---|---|
| App and CLI select the same host, physical device, project and immutable artifact, and observe one durable operation | AT-A01 through AT-A05, AT-01, AT-13, AT-17 |
| Preparing a signed artifact works with the phone temporarily unavailable. Installing it later verifies the retained inputs, bytes and signing metadata | AT-04, AT-11, AT-24 |
| A build prepared on one Mac can be explicitly transferred to the other for installation without copying signing/pairing secrets or changing Git publication ownership | AT-04, AT-14, AT-16 |
| The actual travel caller initiates work, observes progress and reads the result on the home Mini through a supported existing remote agent route or the narrowly scoped authenticated same-service browser handler. A command issued locally at home is insufficient | AT-04, AT-13, AT-20 if selected |
| Duplicate requests return one accepted operation. Changed inputs under the same request ID conflict. Lost replies do not duplicate installation or launch | AT-A03, AT-11, AT-17 |
| An uncertain remote effect uses the existing `operationState: outcome_unknown`, the `OUTCOME_UNCERTAIN` reason, and per-effect evidence. Installation and launch results remain separate | AT-A02, AT-11, AT-17 |
| Lost former-host contact leaves `previous_owner_unconfirmed` where release/reconciliation is unproven. Lease expiry does not authorize takeover | AT-14, AT-15 |
| A documented released ownership record supports later admission on the new Mac while the old one is offline. It does not prove an unknown unmanaged Apple session is absent | AT-14, AT-15, AT-22 |
| No silent backend fallback changes privilege, pairing, remoted behavior, or distribution method. A broad dependency API is not exposed as the control surface | AT-12, AT-13, AT-15, AT-20, AT-24 |
| OTA tests exercise the actual system installer and a documented installed-build confirmation. Browser downloads alone leave verification pending | AT-20 |
| A meaningful fixture retains local records, Keychain-dependent access, drafts/configuration and product-specific pending-operation state. A downgrade follows project migration policy | AT-16, AT-20 |
| Every claimed later capability has separate proof. A test runner's provisioning, permissions, lifetime and cleanup are recorded | AT-18, AT-19 |
| Disabling session maintenance or the module, pausing work, and revoking authority prevent unsolicited reconnection or privileged activity. Normal local Git operations still work | AT-22, AT-23, AT-E04 |
| Contribution and backend updates preserve in-flight semantics and retained evidence, and recheck the actual current Apple output schema | AT-U02 through AT-U05, AT-24 |
| Logs and screenshots are scoped and privately retained. General diagnostic export omits keys, tokens, exact private network identifiers and unnecessary app data | AT-O05, AT-18 through AT-23 |

Measure cached-status responsiveness, bounded refresh/connection waits, transfer volume, session idle CPU/network use, phone battery impact and recovery budgets during applicable cases. These are measured product qualifications, not fabricated benchmark promises. A direct path and a relayed path are separate AT-21 observations.

### Device completion record

Report core completion and device completion independently. For the device module, list the actual host/device/version combinations, delivery methods, network cases, operations, acceptance evidence and remaining blockers. Keep native Xcode destination integration distinguishable from an explicit debugger bridge. Keep a warm cellular route distinguishable from a new cellular session.

No test result in this planning package establishes hardware acceptance. No wider release, production distribution, unattended automation or physical robot action is authorized merely by adding these requirements.

## R. Focused robustness additions

Added after the 2026-10-04 coverage review. These five cases close gaps in explicit proof of existing behavior; they do not replace the original 54 core or 24 device cases, change project policy, or expand backend support. The [coverage audit](../ACCEPTANCE_HARDENING.md) maps all fifteen requested checks to existing or added cases. Implement these tests with their owning milestones, after S0; all are currently unrun.

| ID | Prerequisites and action | Required outcome |
|---|---|---|
| AT-R01 | In an enrolled repository, use an owned native task worktree with detached HEAD and eligible committed work. Submit its exact tip/base through the normal completion route, including disconnect/retry and a later local HEAD advance. | Detached HEAD alone does not require creating a branch or switching checkout. Resolve the enrolled common directory and actual source ownership, retain the captured commits before acknowledgment, and land the eligible immutable snapshot once. The receipt identifies that source; later commits remain newer work. Missing ownership or unsupported topology returns the existing specific blocker without deleting, switching, or rewriting the worktree. |
| AT-R02 | Submit eligible committed task work from a checkout that also has unrelated staged changes, unstaged tracked edits, untracked files and ignored assets. Compare the index and file contents before and after capture, handoff, landing receipt and retry. Exercise a project adapter that disallows dirty task submission as well as one that permits committed-only capture. | A permitted submission includes only the selected committed snapshot and required metadata. An adapter requiring cleanliness rejects before admission with its policy reason. Neither path stages, commits, stashes, resets, cleans, overwrites or transfers unrelated working-directory state. Preserve index entries and local bytes; do not mark unrelated or newer work complete. This does not relax adopted source-ownership or cleanliness rules. |
| AT-R03 | Parameterize handoff fixtures for a shallow clone with missing ancestry/prerequisites, a repository with a submodule, and one with Git LFS pointers whose content is unavailable at the receiver. Test both a declared unsupported adapter and any adapter claiming support; retry the same source after its documented prerequisite repair. | Detect incomplete history or unsupported external-object requirements and retain an actionable waiting/rejection outcome, never a false complete landing or materialized-source claim. Do not infer ancestry from a shallow boundary or treat Git pointers as complete submodule/LFS contents. A supported route verifies its required history and exact referenced content before dependent work; repair preserves source/request identity and does not duplicate landing. No silent history rewrite, recursive credential-bearing fetch or general filesystem sync is introduced. Explicit unsupported results satisfy the baseline's support boundary; this case does not require adding submodule/LFS support. |
| AT-R04 | Through controlled GitHub API fixtures, fail authentication, deny repository/check/rules access, hide a resource behind an ambiguous not-found response, inject transport/server/malformed-response errors, and exercise primary/secondary rate limiting. Repeat after cached success and during an uncertain push's remote-ref reconciliation, then restore valid observations. | Authentication, permission, API availability and throttling produce distinct actionable structured observations where the evidence distinguishes them. Do not turn an unreadable response into an empty successful check set, confirmed absent branch, no configured CI, delivered push or Ready to merge. Preserve timestamped last-known evidence without presenting it as fresh; uncertainty remains until a qualifying observation resolves it. Honor supplied retry/reset guidance with bounded backoff, no busy loop or hidden credential prompt, and no secret output. Recovery updates the correct commit/run without replaying publication or sending duplicate success notices. A previously confirmed Git delivery remains confirmed even when subsequent CI observation fails. |
| AT-R05 | Reconfigure canonical ownership/availability with queued work, an active legacy or Contribution writer, and outstanding receipts. Interrupt the transition at each authority-changing boundary, including while one host is unreachable; restart/reconnect both hosts and attempt mutations from the old and new routes. Include direct role-field edits and rollback of migration-owned configuration. | Reject or defer the transition until histories, pending effects and writer authority are reconciled. At no stage may both Contribution/cooperating legacy routes admit canonical writers. Disable/refuse the old route before enabling the new one; preserve the authority guard across restart and rollback. An unreachable/unreconciled former owner blocks transition rather than electing a replacement. Raw role edits cannot grant ownership. Retain queued request IDs/source/destination/policy, and revalidate or explicitly block them rather than silently redirecting or duplicating effects. This proves the documented operational controls, not protection against a user deliberately bypassing Git hooks. |

AT-R01–03 use real disposable Git fixtures and the public submission/adapter boundary during M4/M5. AT-R04 uses deterministic API fixtures during M2/M3 and existing real-environment qualification where required. AT-R05 starts with crash/partition fixtures during M5 and also requires the actual two-Mac authority-cutover proof before that topology is declared verified. These additions inherit the evidence, privacy and recovery rules above.
