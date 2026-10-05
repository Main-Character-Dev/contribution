# Contribution agent and configuration contract

> Maintained requirement baseline, imported from package revision 2. Product implementation remains planned. The current next step is [S0 repository setup](../REPOSITORY_SETUP.md), bounded by the [setup prompt](../SETUP_PROMPT.md). [Review amendments](../REQUIREMENTS_REVIEW.md) clarify this baseline. Private source material remains external; see [provenance](../SOURCE_PACKAGE.md).

## 1. Interface principles

The installed **`contribution`** executable is the primary agent interface. Its commands and the native app use the same local service, operation engine, policy, and durable records described in [02-ARCHITECTURE.md](02-ARCHITECTURE.md). No permanent MCP server, GUI automation, private Codex database access, or interactive shell wrapper is required.

Install a stable executable entry point in the user's configured command directory, normally `~/.local/bin/contribution`, with a supported PATH-independent discovery path recorded by installation. Repository adapters resolve that installed entry point. They must not import Contribution's editable source tree or select an arbitrary executable with a similar name. The installed engine version and repository runtime remain separate.

Every command supports `--help`. Top-level help lists command groups, and group help lists available operations. `version` reports the installed interface and engine versions, supported schema versions, and compatibility status. Advertise unavailable capabilities truthfully. An agent should begin with help or doctor when it encounters an unfamiliar installation rather than guessing commands.

The optional `devices` group uses this same executable and service. Its command set is staged by D0 through D4, with unavailable operations reported through version-aware help. Enabling Remote Devices does not alter the Git command meanings or select a different canonical repository owner.

`--json` produces one response envelope on stdout. Diagnostic progress, if emitted separately, must not corrupt that document. `--jsonl` produces newline-delimited event records for supported streaming commands. Plain output remains readable for a person. Stable identifiers and structured fields carry meaning, not colors, prose parsing, or log regular expressions.

## 2. Repository identity and defaults

Commands that accept `--repo` resolve either an enrolled repository UUID or a registered local path. When it is omitted, infer the repository from the current checkout's Git common-directory mapping only when that mapping is unambiguous. A linked worktree resolves to its enrolled clone. Independent clones and directories with matching names do not become interchangeable. Missing or ambiguous context returns a structured error instead of choosing the nearest project by guesswork.

Repository paths, host identities, integration branches, and publication destinations are distinct. The active branch need not be `main`. A command targeting a companion clone still resolves the canonical owner through enrollment. It must not mistake the local clone's HEAD for the Mini's current primary.

Existing enrollment retains its profile, gate activation, and availability unless a deliberate configuration change requests otherwise. A new repository defaults to `local-development`. After onboarding deliberately configures and pairs a primary/companion installation, new repositories default to `both-macs`. A standalone installation defaults to `this-mac`. An offline Mini leaves counterpart preparation queued, not reassigned to the laptop.

`this-mac` means deliberate local ownership and no expected peer handoff for that repo. It is not a failover flag. An existing companion repo cannot change canonical owner simply by being enrolled again with that value. Moving between availability modes requires the planned reconciliation and authority transition in [04-REPOSITORY_MIGRATION.md](04-REPOSITORY_MIGRATION.md).

## 3. Discoverable command surface

The forms below define the initial surface. Arguments described as IDs are stable identifiers, and OIDs are full commit object identifiers in the repository's supported object format. Commands must reject incompatible combinations and explain the correct form.

| Command | Contract |
|---|---|
| `contribution help` | Discover groups and supported syntax. |
| `contribution version` | Report interface, engine, and schema compatibility. |
| `contribution doctor` | Read-only readiness and configuration diagnosis. Never repair implicitly. |
| `contribution hosts list` | List configured hosts and observed readiness. |
| `contribution hosts pair --ssh-alias ALIAS` | Pair through existing verified, noninteractive SSH access and record the intended relationship. |
| `contribution repos discover --root PATH` | Bounded read-only discovery, deduplicating linked worktrees. |
| `contribution repos add PATH [--profile local-development\|standard] [--availability this-mac\|both-macs]` | Enroll an existing repo with compatible adapters and preserved existing policies. |
| `contribution repos create PATH` | Preflight, create a minimal local Git repository and bootstrap commit, then enroll it with role-derived availability and Local development defaults. |
| `contribution repos initialize --repo REPO --request-id ID` | Explicitly initialize an enrolled unborn repository with only Contribution-generated metadata and guidance. |
| `contribution repos inspect --repo REPO` | Return effective configuration, revision, ownership, paths, and adapter state. |
| `contribution repos configure --repo REPO --file PATH --expected-revision REV --request-id ID` | Validate and apply the supplied repository configuration at a safe effective-policy boundary. |
| `contribution repos relocate PATH --repo REPO` | Reconcile an enrolled local path change after verifying identity. |
| `contribution repos remove --repo REPO` | Remove Contribution enrollment and its owned integration, preserving source and unresolved work. |
| `contribution status [--repo REPO] [--refresh]` | Return cached or explicitly refreshed workflow and publication state. |
| `contribution submit --repo REPO --source-path PATH --source-tip OID --base OID --request-id ID [--metadata-file PATH]` | Capture and durably queue exactly the completed committed source and applicable integration metadata. |
| `contribution push --repo REPO --preview` | Inspect publication scope, metadata, policy, and blockers without executing publication checks. |
| `contribution push --repo REPO --expected-tip OID --scope-token TOKEN --request-id ID [--wait]` | Request publication of the preview-bound source, destination, and policy. |
| `contribution checks run --repo REPO [--source-path PATH\|--canonical] [--check ID] [--fresh]` | Run focused checks against an explicit local source or the canonical owner checkout. Never publish. |
| `contribution runs list` | List retained operations with documented filters. |
| `contribution runs get OPID` | Inspect one operation and its outcomes. |
| `contribution runs follow OPID` | Subscribe to its events with reconnect support. |
| `contribution runs wait OPID` | Wait for completion or a bounded response interval. |
| `contribution runs cancel OPID` | Request cancellation of the owned operation, preserving completed effects. |
| `contribution runs pin OPID` | Protect the retained record and its associated available evidence against automatic eviction. |
| `contribution runs unpin OPID` | Restore normal retention eligibility without deleting the record immediately. |
| `contribution logs OPID [--tail N] [--follow]` | Read available retained output, optionally following new output. |
| `contribution repair-context OPID` | Return the focused failure context and supported next actions. |
| `contribution codex open --repo REPO [--run OPID]` | Open supported Codex context or return a copyable manual fallback. |
| `contribution settings get` | Return effective machine settings and their revision. |
| `contribution settings apply --file PATH --expected-revision REV --request-id ID` | Validate and apply the supplied machine settings without bypassing ownership transitions. |
| `contribution service status` | Inspect service registration and readiness. |
| `contribution service install` | Install or repair Contribution-owned service integration through supported macOS mechanisms. |
| `contribution service restart --when-idle` | Restart only after the required maintenance window is available. |
| `contribution service pause` | Pause new local job starts while retaining queued work and allowing active jobs to finish. |
| `contribution service resume` | Resume eligible local starts after readiness and policy revalidation. |
| `contribution update check` | Check for compatible installed-release updates. |
| `contribution update apply --when-idle` | Apply a verified release through the architecture's idle update workflow. |

`repos create` does not create a GitHub repository, choose an application framework, generate a marketing site, or activate CI. Discovery is not enrollment. Doctor is not repair. A focused check is not a completed publication gate. `--fresh` requests new applicable proof and never broadens publication authority.

### Bootstrap and check sources

An unborn repository has no commit usable as `--base`. `repos create` therefore preflights the configured Git identity and destination, then makes a minimal development bootstrap commit. For an existing unborn repo, `repos add` only enrolls it. `repos initialize` explicitly authorizes the bootstrap commit. Stage only Contribution-generated metadata and guidance, preserving unrelated files and index entries. Reject ownership collisions or missing identity without fabricating an author or committing application code.

For `both-macs`, retain and durably seed the exact bootstrap source on a verified empty Mini target through the dedicated initialization transaction. Its confirmed receipt is required before canonical admission or integration of normal tasks. The laptop may still capture and queue normal committed tasks offline using the retained bootstrap as their base. Reconnection processes bootstrap before those dependent submissions. An existing target history requires reconciliation, not replacement, and initialization never publishes to GitHub.

`checks run --source-path` selects a current-host local worktree. If neither source option is provided, use the current checkout only when unambiguous. `--canonical` explicitly requests the owner checkout. The options are mutually exclusive. Record execution host, input identity, and HEAD, including dirty-input proof where the adapter supports it. Reject unsupported dirty-source validation rather than silently switching to primary. Focused local results do not imply a publication gate pass.

## 4. Response envelope and exit codes

All nonstreaming structured responses conform to [response.schema.json](../../packages/contracts/schemas/response.schema.json). The normative envelope is:

```json
{
  "schemaVersion": 1,
  "requestStatus": "completed",
  "operationId": null,
  "operationState": null,
  "result": {},
  "error": null
}
```

`requestStatus` is `completed`, `accepted`, or `rejected`. `operationId` is a string or null. `operationState` is null or one of `queued_local`, `queued`, `waiting`, `running`, `succeeded`, `failed`, `cancelled`, `interrupted`, `outcome_unknown`, and `needs_attention`. `result` is an object or null. `error` is null or an object containing `code`, `message`, `retryable`, and `nextActions`.

These fields answer different questions. `requestStatus: completed` means the command response is complete. It does not mean all workflow stages passed. `accepted` means a request was durably accepted at the reported boundary. An asynchronously persisted laptop outbox returns `accepted` with `queued_local`. Only `result.acceptance` states whether the Mini actually accepted it. A Mini-queued submission requires both retained source and a durable request receipt. [Accepted submission example](../../packages/contracts/examples/accepted-submission.json)

For a push, operation success means the observed delivery operation completed successfully. GitHub checks and PR readiness are separate results. Agents must not translate `accepted`, exit zero, or a local gate pass into “pushed successfully.”

| Exit | Meaning |
|---|---|
| `0` | Successful query, accepted request, or completed successful operation. Inspect the envelope. |
| `2` | Invalid usage or configuration. |
| `3` | Unavailable dependency, host, or required setup. |
| `4` | Policy conflict, stale selection, dirty primary, divergent history, or conflicting request identity. |
| `5` | Actual check or operation failure. |
| `6` | Uncertain external outcome requiring reconciliation. |
| `130` | Confirmed cancellation of the observed operation or explicit foreground cancellation. |

Errors include the actual observed state in `result` when available, a stable machine code, a concise explanation, and allowed next actions. Never return only “failed.” A stale-tip response identifies expected and observed identities. Action arguments remain structured data. Do not manufacture a shell command by interpolating paths, remote text, or task content.

## 5. Acceptance, retries, waiting, and cancellation

Mutation requests that require `--request-id` use a stable caller-generated ID, preferably a UUID. Retrying the same logical request reuses it. Reusing it for different repository, source, base, destination, or applicable policy is rejected. Request identity and operation identity remain separate so retries can return the already-known operation.

Submission idempotence binds repository, source commits, base, integration metadata, and policy semantics. Bundle bytes are transport evidence, not the whole logical identity. A receiver may request a replacement bundle with additional prerequisites. Its digest can change while the captured task remains the same request. Repackaging must not create a second landing or silently recapture newer source commits.

`submit` does not stage or commit. It verifies the supplied source path and immutable identities, applies existing source-ownership policy, and persists the required retention before acknowledging a local queue. A completed task may wait offline without losing its recorded identity. Acknowledgment is not permission to delete its source or native worktree.

Optional `--metadata-file` reads JSON conforming to [submission-metadata.schema.json](../../packages/contracts/schemas/submission-metadata.schema.json), with `schemaVersion: 1` and optional `integrationMessage` string. See [submission-metadata.json](../../packages/contracts/examples/submission-metadata.json). Existing valid adapter-owned metadata may supply the same information when available. Capture validated metadata immutably and bind its canonical content digest and meaning into request idempotency and the transfer manifest. Its source filename is not its identity, and later file edits cannot change an accepted request.

The receiving adapter checks metadata against the captured source and current applicable contract. Mathy's multi-commit source requires an explicit combined integration message. If required metadata is missing or invalid, return a structured `NEEDS_INPUT` error with the actual adapter requirement and allowed next actions. A retained blocked operation is `needs_attention`. Contribution never guesses the message. Changed metadata requires a new request identity rather than mutating an accepted one.

Wait commands have bounded defaults documented in help. Returning because that interval elapsed does not cancel the job. Return the current envelope and operation identity so an agent can resume observation. `push --wait` waits for the terminal Git delivery operation, not indefinite CI or PR completion. `runs get`, `runs follow`, and subsequent bounded waits expose later state.

Pausing service processing is different from cancellation and from disabling its macOS registration. It keeps accepted work durable and does not kill active jobs. Disconnecting a stream or closing a viewer only detaches the client. Cancellation requires the cancellation command. It targets the owned job and reports whether effects already occurred. No cancellation can promise to undo remote ref acceptance. An interrupted or unknown transport outcome is reconciled before another publication is proposed.

## 6. Explicit Push and preview semantics

Noninteractive publication requires `--expected-tip`, `--scope-token`, and `--request-id`. Obtain the opaque `result.scopeToken` from Push preview. It binds repository identity, canonical branch and tip, resolved destination identity and ref, and effective policy revision. The token is not a credential and callers must not construct or reinterpret it. A caller cannot substitute “whatever is latest when you run.”

[push-preview.json](../../packages/contracts/examples/push-preview.json) illustrates the returned token and readable scope. The token is issued by the service, not constructed by a caller.

`push --preview` is metadata planning. It may perform bounded Git metadata reads and relevant remote observation, but it does not run `git push --dry-run`, hooks, check commands, build setup, model review, or publication. Report freshness and blockers rather than treating a plan as proof.

Validate both token and expected tip at admission and execution. Before execution, acquire the per-repository queue barrier and verify that the selection is still safely valid. A changed destination URL, destination ref, or policy invalidates the request even when its tip is unchanged. Report observed drift and require a new preview instead of widening scope. Never reset primary or invent a detached-snapshot engine. Once execution begins, further landing waits through validation and transport. Existing lease and adapter checks remain required.

Run the gate once within the actual managed Git invocation. A wrapper must not execute the full gate and then repeat it through pre-push. Preserve hook stdin, exact ref handling, runtime selection, and failure exits. Unsupported hook-only invocations report local gate outcome and delivery unobserved. Audit outcome boundaries (private reference; see [source package](../SOURCE_PACKAGE.md))

Pairing, task completion, handoff, checks, repair-context generation, and Codex opening never imply GitHub publication. The app and CLI share the same user authorization semantics. An already authorized request may continue without repeated confirmation, but a changed source or destination does not inherit that authorization automatically. There is no generic force or bypass flag in this contract.

## 7. Repository configuration

The tracked `contribution.json` conforms to [repository.schema.json](../../packages/contracts/schemas/repository.schema.json). See [repository.json](../../packages/contracts/examples/repository.json). The normative keys are:

| Key | Meaning |
|---|---|
| `schemaVersion` | `1`. |
| `repositoryId` | Stable UUID for the logical repository. |
| `name` | Human-readable project name. |
| `integration.branch` | Configured canonical active branch. |
| `integration.adapter` | Installed integration adapter identifier. |
| `publication.remote` | Remote alias or null when unconfigured. |
| `publication.branch` | Intended destination branch or null. |
| `publication.pullRequestBase` | Intended PR base or null. |
| `publication.mode` | `explicit`. |
| `validation.profile` | `local-development` or `standard`. |
| `validation.gate` | `enabled` or `inactive`, independent of profile. |
| `validation.adapter` | Installed validation adapter identifier. |
| `validation.builtins` | Selected built-in check identifiers. |
| `validation.checks` | Repository-defined check records. |
| `runtime.node` | `repository`. |
| `runtime.packageManager` | `repository`. |

Each check contains `id`, `profiles`, `argv`, `cwd`, `timeoutSeconds`, and `reuse`. `argv` is an argument array executed without implicit shell evaluation. `cwd` resolves within the intended repository context. `reuse` is `never` or `adapter`. The latter delegates reuse to the verified adapter contract, not a cache hit inferred from a filename or commit alone.

Adapter IDs include `generic-v1` and the installed repository adapters. Preserve existing gate selection and receipt invalidation semantics during migration. A profile does not automatically activate Glass Alpha's inactive gate. Do not store machine absolute paths, host credentials, tokens, or mutable installed-source references in this tracked file.

`repos inspect` and `settings get` return `result.revision` for optimistic concurrency. Revision tokens describe effective service configuration and are not additional fields in the configuration files. Configure/apply validates the supplied file against the corresponding schema and checks `--expected-revision`. The explicit request authorizes that proposed configuration, not hidden overrides. Return its diff and safe rejection when prerequisites are unmet.

Apply changes only at an idle, reconciled effective-policy boundary. Active-branch, availability, or authority changes require their supported transition and cannot happen through raw field editing. In particular, machine settings cannot grant canonical ownership by changing `role` or `primaryHostId`. Preserve pending work and expose required reconciliation instead of quietly adopting the edited value.

## 8. Machine configuration

Private machine configuration conforms to [machine.schema.json](../../packages/contracts/schemas/machine.schema.json). See [machine.json](../../packages/contracts/examples/machine.json). Its keys are `schemaVersion`, `hostId`, `label`, `role`, `primaryHostId`, `primarySshAlias`, `projectRoots`, `repositories`, `notifications`, `retention`, optional `contributionSourcePath`, and optional `remoteDevices`.

`hostId` and `primaryHostId` are UUIDs. `role` is `primary`, `companion`, or `standalone`. `primarySshAlias` is a configured alias or null. `projectRoots` contains local discovery roots. Each repository mapping contains `repositoryId`, `path`, and `availability`, whose value is `this-mac` or `both-macs`. These machine paths and account associations remain private and untracked.

`notifications` contains `preferredHostId`, `success`, and `failure`. `retention` contains `rawLogDays`, `summaryDays`, and `maxLogBytes`, with defaults `30`, `365`, and `2147483648`. Retention and pinned-record behavior follow the product requirements and architecture. The schema does not authorize deleting unresolved source or transfer evidence.

`contributionSourcePath` is a registered absolute local directory string or null. Absent means unregistered. Doctor reports this source checkout's availability and identity without executing its code or requiring its HEAD to equal the installed release. Missing or incorrect registration produces a settings-apply repair action. Doctor remains read-only. An agent can then locate the correct source repo and follow its own development workflow without changing installed behavior.

Pairing verifies the intended peer and supported service through the supplied SSH alias. Send structured requests to the fixed installed entry point. Do not interpolate project paths or task text into an SSH shell expression. Missing credentials produce an actionable setup result, not a hidden prompt waiting forever.

`remoteDevices` contains `enabled` and `maintainSession`, both booleans defaulting to false. Absence means the module is disabled. These are private per-host settings applied through the existing Settings and `settings apply` path. `maintainSession` permits bounded maintenance of an explicitly approved session while enabled. It never authorizes an install, launch, capture, or test. Disabling stops future privileged work and automatic recovery, invalidates current readiness, and reconciles any already-dispatched effects before reporting shutdown complete. Device identities, grants, ownership, pairing-secret references, and operation records remain service-owned private state. They are not additional tracked `contribution.json` fields. Older peers may continue supported Git work without gaining Remote Devices capability.

## 9. Status and event interpretation

Repository status conforms to [status.schema.json](../../packages/contracts/schemas/status.schema.json). The [repository-status.json example](../../packages/contracts/examples/repository-status.json) shows the response form. Its result contains `repositoryId`, `canonicalHostId`, `canonicalBranch`, `canonicalTip`, `publication`, and `pending`.

`publication` contains `remote`, `branch`, `remoteTip`, `relation`, `ahead`, `behind`, `observedAt`, `freshness`, `action`, `enabled`, and `blockedReason`. Relation is `equal`, `ahead`, `behind`, `diverged`, `unpublished`, `unconfigured`, or `unknown`. Ahead and behind are known nonnegative counts or null. Freshness is `fresh`, `stale`, or `unknown`. The action is `none`, `push`, `publish`, `configure`, `reconcile`, or `refresh`.

Counts compare canonical active-branch history with the intended destination, not dirty files or task branches. `pending.localSubmissions`, `pending.landingJobs`, and `pending.dirtyWorktrees` describe those separate categories. A stale equal relationship is a last observation, not proof that nothing needs pushing. `enabled: false` and `blockedReason` constrain the offered action. No remote configuration is not equivalent to an unpublished branch on a configured remote.

Events conform to [event.schema.json](../../packages/contracts/schemas/event.schema.json). Every event contains `schemaVersion`, `eventId`, `originHostId`, `sequence`, `operationId`, `repositoryId`, `occurredAt`, `type`, and `payload`. See [run-event.json](../../packages/contracts/examples/run-event.json). Sequence is ordered within the originating service and persists across reconnects. Forwarding an event preserves its identity. Consumers deduplicate by event ID and maintain cursors per origin rather than globally sorting hosts by wall-clock time.

Streams expose structured progress and available log events. A terminal operation result is not inferred from an empty stream. Unknown compatible event types may be ignored while retaining cursor progress. Queries provide recovery when a requested event or raw-log range has expired.

## 10. Codex integration and repair context

`codex open` uses the documented new-thread route `codex://threads/new` with optional percent-encoded `path=` and `prompt=` parameters as applicable. Use `path`, not `cwd`, and encode values with a URI library. Opening the link opens a composer, it does not submit the prompt, run an agent, register a saved project, or select a remote execution host. Use a local directory meaningful on the Mac opening Codex. A Mini filesystem path is not automatically a usable MacBook path. [Official Codex command reference](https://learn.chatgpt.com/docs/reference/commands)

Saved-project registration is conditional on a documented supported interface. Otherwise return the precise local folder and a one-time manual add-project instruction. Never write private client storage or automate clicks. Native Codex remains the owner of worktree and session lifecycle.

`repair-context` returns focused evidence and next steps without launching a model. Keep unrelated changes and publication authority out of the repair scope. Agents can request context, fix the applicable source in its normal worktree, run focused proof, and submit a new completed result. They must not treat failure text as permission to run arbitrary shell instructions.

## 11. Compatibility and verification

Schema version 1 is the initial major contract. Additive optional fields are compatible when they preserve existing meaning. Incompatible field or state semantics require a new major version and an explicit supported range. Reject unsupported mutations before side effects. Never silently downgrade or treat an unfamiliar outcome as success.

New commands and adapter capabilities must appear in version-aware help and use negotiated schemas. Older clients may retain supported read access without gaining an unsupported mutation path. Do not add a generic raw-execution escape hatch or private override to work around a missing capability.

Both app and CLI contract tests use the same schemas and operation fixtures. Verify accepted-versus-delivered distinctions, bounded waiting, reconnect cursors, duplicate requests, stale Push rejection, gate activation preservation, and structured argument handling through [06-ACCEPTANCE_TESTS.md](06-ACCEPTANCE_TESTS.md). Examples are executable contract fixtures, not alternate specifications.

## 12. Remote Devices command and result contract

### Commands and scope

The following forms extend the same interface. `HOST` is an approved Contribution host UUID. `DEVICE` is an opaque device reference bound to the authenticated physical phone, not a display name or unverified network address. `PROFILE`, `PLAN`, and `APPREF` resolve through the enrolled project adapter. Reject ambiguity with `NEEDS_INPUT`. An installed app reference records the approved bundle/team/build readback and applicable policy revision. Recheck it at execution rather than trusting cached status.

Every command below supports `--json`. Streaming observation remains `runs follow --jsonl` and `logs`, using the existing event envelope. Requests sent to a different host use the existing verified SSH entry point and that host's service. No generic remote command or device-protocol forwarding endpoint is added.

For phone-only travel, D0 must establish a supported remote agent route that can invoke this interface on the home Mini. If unavailable, the integrated private browser control surface dispatches this same allowlisted operation model and response/event schemas through the Mini's existing service. Its authenticated API must preserve caller, host/device/project scope, request identity, revocation, and bounded status semantics. It cannot accept arbitrary CLI argument arrays or raw shell/backend requests. Adding this browser entry point does not create a second jobs API or permanent iOS application.

| Command | Contract |
|---|---|
| `contribution devices list [--host HOST] [--repo REPO]` | Bounded inventory of approved devices and observed pairing candidates, with opaque references and redacted details. Discovery does not grant trust or operation authority. |
| `contribution devices status --host HOST --device DEVICE --repo REPO [--refresh]` | Return the five readiness dimensions, current context, ownership, and per-operation capability evidence. Refresh is bounded and cannot start a build or mutation. |
| `contribution devices pair --host HOST --device DEVICE --repo REPO --method existing\|wireless\|usb --request-id ID` | Verify or establish the selected host's Apple trust through the qualified bootstrap method. Return concrete phone-side actions when required. Preserve unrelated pairings. |
| `contribution devices authorize --host HOST --device DEVICE --repo REPO --operation OP [--operation OP] --request-id ID` | Record the explicit approved operation scope against the adapter's app identity. Pairing alone does not grant every operation. |
| `contribution devices revoke --host HOST --device DEVICE --repo REPO --operation OP [--operation OP] --request-id ID` | Revoke the named scope, stop future privileged starts, and invalidate cached readiness. Reconcile active effects without promising to undo them. |
| `contribution devices connect --host HOST --device DEVICE --repo REPO --request-id ID` | Attempt one qualified developer-session establishment with bounded recovery. Report the actual warm/cold network context. No install or launch is implied. |
| `contribution devices qualify --host HOST --device DEVICE --repo REPO --plan PLAN --request-id ID` | Execute a registered, explicitly authorized physical qualification plan against its approved test-app/data fixture and exact context. It can investigate unverified support within recorded attempt/time bounds while retaining all trust, signing, identity, and session guards. |
| `contribution devices prepare --host HOST --device DEVICE --repo REPO --build-profile PROFILE --source-tip OID --request-id ID` | Use the project-owned exact source/configuration/signing route and return verified immutable artifact provenance. The selected device may be offline. |
| `contribution devices artifacts transfer --repo REPO --artifact ID --from-host HOST --host HOST --request-id ID` | Transfer the approved immutable signed artifact and provenance through the retained private transport. Revalidate at receipt. Transfer no signing or pairing private keys. |
| `contribution devices install --host HOST --device DEVICE --repo REPO --artifact ID --request-id ID [--launch]` | Request an in-place update of the selected approved identity. `--launch` adds a separately reported launch effect and project foregrounding guard. |
| `contribution devices launch --host HOST --device DEVICE --repo REPO --app-ref APPREF --request-id ID` | Launch the explicitly verified installed app if the project allows foregrounding. No force-quit, reinstall, or product action is implicit. |
| `contribution devices logs --host HOST --device DEVICE --repo REPO --app-ref APPREF --duration-seconds N --max-bytes N --request-id ID` | Collect the approved log source within explicit bounds and private retention. Return its operation and evidence references. |
| `contribution devices test --host HOST --device DEVICE --repo REPO --plan PLAN --request-id ID` | Run the adapter's scoped native test selection with its qualified runner, provisioning, session guard, and teardown. |
| `contribution devices ui --host HOST --device DEVICE --repo REPO --plan PLAN --request-id ID` | Execute the approved accessibility action plan through a qualified native/test connection. It is not an arbitrary device-control script. |
| `contribution devices debug --host HOST --device DEVICE --repo REPO --app-ref APPREF --session-profile PROFILE --request-id ID` | Establish the approved native destination or explicit debugger session and retain its method and lifecycle. Support requires real debugger evidence. |
| `contribution devices capture --host HOST --device DEVICE --repo REPO --app-ref APPREF --kind screenshot\|screen --request-id ID [--duration-seconds N]` | Explicitly capture the approved visual scope. Screen capture requires a duration. Project privacy and private retention apply. |
| `contribution devices disconnect --host HOST --device DEVICE --repo REPO --request-id ID` | Release only the utility-owned session after accounting for active effects and pause its automatic maintenance. A later explicit connect/operation can request a new session while the module remains enabled. |
| `contribution devices transfer-host --device DEVICE --repo REPO --from-host HOST --host HOST --expected-revision REV --request-id ID [--release-ref REF]` | Apply a verified ownership transition. An existing retained release may be consumed after the former Mac goes offline. Unconfirmed former ownership blocks conflicting work. |
| `contribution devices reconcile OPID --host HOST --request-id ID` | Observe the named operation's possible effects and update its retained receipt. Reconciliation does not replay the mutation. |

`runs get`, `runs follow`, `runs wait`, `runs cancel`, `runs pin`, and `repair-context` work for device operations without a second jobs API. Pairing, authorization, app-data migration, OTA distribution, debugging, and actual product behavior remain separate scopes. The normal command request supplies authority where already authorized. Do not insert repeated confirmation for a continuation of the same accepted request.

The installed adapter defines supported profiles, plans, tool versions, and app identity. `prepare` still follows its repository source policy. Selecting the MacBook as device host never grants it canonical Git integration authority. Independent preparation and artifact transfer do not run the publication gate, invoke GitHub push, or activate a release distribution method.

### Admission, execution, and certainty

Bind idempotency to operation type, execution host, authenticated device, repository, bundle/team identity, artifact or installed-app reference, source/configuration where applicable, approved operation scope, and adapter/policy revision. A different target or artifact requires a new request. Duplicate delivery returns the retained original operation. It does not reinstall because a client lost the reply.

Routine operations require the applicable qualified capability. First proof runs use the separate `devices qualify` entry point, whose registered plan binds the original AT case, approved test-app/data fixture, exact expected context digest, allowed operations, maximum attempts, and maximum duration. The plan is data selected through the installed adapter, not a caller-supplied executable. Qualification can investigate `unverified` support. It cannot override trust, signing, host/device/app identity, known incompatibility, ownership, project action guards, or uncertain-effect reconciliation. No generic force or raw execution flag is available.

The retained device intent includes `mode: routine|qualification` and `qualification`, which is null for routine work. Qualification metadata contains `acceptanceId`, `planId`, `fixtureId`, `expectedContextDigest`, `authorizedOperations`, `maxAttempts`, and `maxDurationSeconds`. Compare the actual context before dispatch, persist the budget, and stop on material drift or exhaustion. A qualification result does not automatically mark support as established. Only its reviewed observed evidence can promote the exact capability context. This route supports D1/D3 first proof without pretending the phone has already passed acceptance.

Device admissions report the actual boundary in `result.acceptance`: `localDurable`, `executionHostAccepted`, `executionHostId`, and `acceptedAt`. These device fields are distinct from Git submission's existing `canonicalHostAccepted`/`canonicalHostId`. A sender outbox can return `queued_local`. Accepted work on the selected execution host can return `queued`. Neither means that the app is installed.

Use the existing response schema and operation states without alteration. An interrupted external effect becomes `operationState: outcome_unknown` with reason `OUTCOME_UNCERTAIN` and exit 6 when returned as an unresolved result. In the source brief, `outcome_uncertain` describes the semantic category. It is not an additional wire-level operation state.

Record actual stages such as `preparing`, `verifying_artifact`, `connecting`, `checking_device`, `transferring`, `installing`, `verifying_install`, `launching`, and `reconciling`. Stage is separate from operation state. Each stage has a bounded timeout, progress/cancellation behavior, and retained attempt. Show bytes when measured. Do not synthesize a percentage from elapsed time.

The device receipt records independent effect entries. Install and launch never share a single success flag. Confirmed install plus failed launch yields a failed composite operation, a succeeded install effect, and a failed launch effect. A delivery link or upload without device confirmation remains `delivery_prepared` or `verification_pending` in the stage/readback result. It is not a succeeded install effect. In-place installation does not prove app-data retention without the relevant project fixture evidence.

When an effect may have happened, reconciliation must inspect the exact device and intended installed identity/process before any retry. If the backend cannot observe enough to decide, retain uncertainty and missing proof. Setting `retryable: false` means automatic replay is unsafe, even if a later reconciliation or explicit action may resolve it. Cancellation confirms only the cancellation behavior actually observed and preserves earlier effects. It cannot promise rollback, uninstall, or termination of an unrelated session.

### Versioned device records

| Schema | Normative use |
|---|---|
| [device-status.schema.json](../../packages/contracts/schemas/device-status.schema.json) | Completed status envelope, including `executionHostId` separately from `canonicalHostId`, freshness, readiness, ownership, and capabilities. |
| [device-capability.schema.json](../../packages/contracts/schemas/device-capability.schema.json) | Support for one named operation in one explicit toolchain/device/backend/network context. Current reachability is separate. |
| [device-operation.schema.json](../../packages/contracts/schemas/device-operation.schema.json) | Retained operation receipt returned as `runs get` result's `deviceOperation`, with exact intent, independent effects, readback, and reconciliation. |
| [artifact-provenance.schema.json](../../packages/contracts/schemas/artifact-provenance.schema.json) | Verified prepared artifact identity and build/signing evidence. Preparation is independent of physical-device acceptance. |
| [device-ownership.schema.json](../../packages/contracts/schemas/device-ownership.schema.json) | Per-device current owner, transfer/release evidence, revision, and whether conflicting mutations are permitted. |
| [device-test-evidence.schema.json](../../packages/contracts/schemas/device-test-evidence.schema.json) | Physical-case plan/result for an RDEV acceptance ID with exact context and evidence limits. |

New device records use `schemaVersion: 1` and `recordMode: observed|fixture`. Fixtures are explicitly non-live contract examples and cannot be ingested as production authority, a usable artifact, an accepted host release, or passing physical evidence. A `supported` device capability requires qualifying observed physical evidence, its exact context, and a current compatible revision. Host-only `prepare` can qualify through exact-input build/signing evidence while the phone is offline. It never establishes device support. A schema-valid record alone cannot grant permission or establish hardware support.

Capability support is `unverified`, `supported`, `unsupported`, or `requires_action`. `requires_action` records an explicit prerequisite to qualification/use, not an inferred network diagnosis. Runtime availability separately lists `callable` and stable `reasonCodes` per operation. A callable routine device mutation requires valid authorization, qualified capability, current readiness, and a permitted ownership state. A scoped qualification plan can investigate an unverified capability under the separate constraints above. Build preparation can remain callable while the phone is offline when the adapter's signing prerequisites are available.

The context includes known host/toolchain/device/Tailscale/backend versions, signing/export mode, bootstrap method, host and phone underlays, network scenario, direct/relay route, and whether the developer session was fresh or already established. Unknown values remain explicit. Changing a material qualification input invalidates reuse until the relevant case is reviewed or rerun. A warm-cellular result never fills a cold-cellular key.

Status keeps five dimensions visible: host/tailnet, physical trust, Apple service/session, per-context operation capability, and ownership/result certainty. General output uses opaque device references. Private receipts can link controlled local evidence. Do not print private keys, pairing records, bearer tokens, raw account details, full environments, or sensitive app logs in routine status.

Artifact provenance and device readback are different fields. The artifact record can contain its verified SHA-256 and signing metadata. Installation readback contains only values actually available from the phone, including bundle/build and team identity only where observable. A null phone-side team observation does not erase the separately required artifact/team checks. Do not invent a phone-side artifact hash.

Ownership state includes `unowned`, `owned`, `transfer_pending`, `previous_owner_unconfirmed`, `busy_external`, or `blocked`. `leaseExpiresAt` is diagnostic metadata only. A transfer revision and acknowledged release protect cooperating service transitions but do not constitute Apple-side fencing. An unreachable former host without sufficient release/recovery proof keeps `mutationsPermitted: false`. Normal status polling cannot reassign it. The architecture owns the required reconciliation and safe recovery boundary.

### Stable reason categories

Use the following wire categories for the source requirements. Include observed facts and a concrete allowed next action. Do not guess an OS restriction from a generic timeout.

| Code | Meaning |
|---|---|
| `HOST_OFFLINE` | The selected Mac/service is unavailable. |
| `TAILNET_ROUTE_UNAVAILABLE` | No usable private route was observed. |
| `TAILNET_ACCESS_DENIED` | Tailnet access was explicitly denied. |
| `DEVICE_OFFLINE` | The selected physical device cannot currently be reached. |
| `DEVELOPER_SERVICE_UNAVAILABLE` | The required Apple service was not available through the observed route. |
| `UNLOCK_REQUIRED` | The chosen operation requires the phone to be unlocked. |
| `DEVELOPER_MODE_REQUIRED` | The chosen operation requires Developer Mode. |
| `PAIRING_REQUIRED` | The selected host lacks required approved Apple trust. |
| `PAIR_VERIFICATION_FAILED` | Verification of the expected physical-device trust failed. |
| `AUTHORIZATION_DENIED` | The caller/host/device/project/operation scope is not approved or was revoked. |
| `TOOLCHAIN_INCOMPATIBLE` | The requested operation is incompatible with the observed OS/toolchain/backend combination. |
| `CAPABILITY_UNVERIFIED` | No qualifying proof exists for this operation and context. |
| `OPERATION_UNSUPPORTED` | Evidence or the implemented backend establishes that this operation is unavailable in the stated scope. |
| `DEVICE_BUSY` | A conflicting utility or known external session is active. |
| `PREVIOUS_OWNER_UNCONFIRMED` | The former host's effects/session/automation have not been safely released or reconciled. |
| `SIGNING_INVALID` | Artifact identity, signature, provisioning, or authorized signing context failed validation. |
| `VERIFICATION_PENDING` | Delivery may be prepared or completed, but required installed-state proof is missing. |
| `OUTCOME_UNCERTAIN` | A dispatched effect may have occurred and must be reconciled before retry. |

Project-specific guards may add compatible codes such as `PROJECT_OPERATION_PENDING`. Unknown compatible reason codes remain visible and cannot be interpreted as success. Device events use names such as `device.operation.accepted`, `device.install.verified`, `device.launch.failed`, and `device.operation.reconciliation_required`. Preserve the existing event envelope, origin sequence, operation identity, and initiating `repositoryId`. Device resources are still serialized across all repositories, regardless of which repository initiated the event.

The example fixtures deliberately show unverified cold-cellular support, a host transfer with unresolved prior ownership, independent install/launch results, and an unrun physical acceptance case. Their dates, identities, versions, and observations are invented for contract validation. No fixture closes D1 through D4 or any physical acceptance case.
