# Remote iPhone development in Contribution

> Maintained requirement baseline, imported from package revision 2. Product implementation remains planned. The current next step is [S0 repository setup](../REPOSITORY_SETUP.md), bounded by the [setup prompt](../SETUP_PROMPT.md). [Review amendments](../REQUIREMENTS_REVIEW.md) clarify this baseline. Private source material remains external; see [provenance](../SOURCE_PACKAGE.md).

## 1. Outcome and scope

Contribution will support authorized development operations between an iPhone and a selected MacBook Pro or Mac Mini over the owner's Tailscale network. Roboty is the first consumer. The reusable device capability belongs to Contribution, while each project retains its source, signing, app identity, build, data-migration, test-authority, and activation policy.

The first useful device outcome is a verified in-place update that retains meaningful app data. The full target also includes independently qualified launch, logs and diagnostics, tests and accessibility-based UI interaction, and interactive debugging. Native Xcode destination integration is a desired capability with its own proof. Fresh developer-session establishment after the phone is already on cellular, including restart recovery, is an early feasibility requirement. An installation link or a warm cellular tunnel does not establish that result.

The baseline phone setup is Tailscale plus the ordinary Apple developer and trust prerequisites. No permanent custom iOS client is required by this plan. USB may be needed for approved initial pairing or recovery on some versions. It is not the intended routine workflow.

This is an optional module in the same application, not a second product. The core M0 through M6 implementation can become usable and ship while the device track remains partly unqualified. Keep the device module's unavailable capabilities and remaining evidence explicit. Shipping Contribution's core does not complete the full remote-development target.

This document owns the remote capability's requirements, staged decisions, and requirement traceability. [02-ARCHITECTURE.md](02-ARCHITECTURE.md) owns shared process, persistence, transport, and ownership design. [03-AGENT_CONTRACT.md](03-AGENT_CONTRACT.md) and its schemas own exact commands and wire fields. [04-REPOSITORY_MIGRATION.md](04-REPOSITORY_MIGRATION.md) owns the Roboty seam. [05-IMPLEMENTATION_PLAN.md](05-IMPLEMENTATION_PLAN.md) owns the combined delivery sequence. This document also retains the complete original remote acceptance rows. [06-ACCEPTANCE_TESTS.md](06-ACCEPTANCE_TESTS.md) owns the core scenarios and integrated acceptance rules. [07-SOURCES_AND_DECISIONS.md](07-SOURCES_AND_DECISIONS.md) records source evidence and limitations.

No implementation or physical-device acceptance is claimed by this specification.

## 2. Ownership within the existing application

| Concern | Canonical owner | Remote-module responsibility |
|---|---|---|
| Hosts, projects, local paths, supported versions | Contribution registry and settings | Associate approved physical devices and independently provisioned host readiness with existing records |
| Durable requests, execution, cancellation, event history | The existing user service and operation journal | Add typed device operations and per-effect reconciliation, without a parallel scheduler |
| Source selection and product build | The project adapter | Resolve the exact allowed checkout/configuration and prepare a signed artifact under project policy |
| Pairing and developer transport | The selected, reviewed device backend | Prove device identity, establish the supported service path, and expose only qualified operations |
| Cross-Mac requests | The existing authenticated SSH entry point over Tailscale | Submit and inspect scoped device jobs through the same service admission path |
| Artifact movement | Contribution's retained artifact transfer | Verify immutable bytes and metadata when the build host differs from the installation host |
| Device-operation ownership | The engine's device ownership record and local resource coordination | Serialize conflicting device operations and reconcile explicit host transfers |
| Logs and private evidence | Existing operation storage, retention, and diagnostic export | Apply narrower capture scope and keep exact device/network details private |
| UI, packaging, background registration, updates | The existing app and installed release | Add compact device controls and compatible worker quiescence, without another login service |

The selected **development host** is independent of a repository's **canonical Git owner**. Selecting the MacBook to install an app does not authorize it to publish a paired repository's Git branch. Selecting the Mini to build does not silently land an unfinished MacBook worktree. Each request carries its approved source or artifact explicitly. Preserve the repository's current source-selection contract.

## 3. M0 compatibility and setup inventory

The actual supported range starts with the owner's observed devices and toolchains. Do not hard-code the historical Roboty Xcode observation as the compatibility range. Do not invent a phone OS version, assume the Mini matches the MacBook, or require an upgrade merely to obtain newer pairing behavior.

Populate the following record during M0/D0. Retain observation time, method, and private evidence reference. Unknown entries remain unknown and block only operations that depend on them.

| Inventory item | MacBook Pro | Mac Mini | iPhone or shared decision |
|---|---|---|---|
| Model, CPU architecture, stable Contribution host/device ID | Unknown in this package | Unknown in this package | Exact phone model and approved physical identity unknown |
| macOS / iOS version and build | Unknown | Unknown | Unknown |
| Xcode version, build, selected developer directory, available SDKs | Unknown | Unknown | Device compatibility unverified |
| Contribution version, request/schema compatibility, user-service status | To implement and observe | To implement and observe | No Contribution iOS client |
| Tailscale client variant/version, peer identity, relevant access rules | Unknown | Unknown | Phone client/version and authorized route unknown |
| SSH identity and noninteractive fixed-entry-point access | Reuse and verify existing setup | Reuse and verify existing setup | Not an iPhone prerequisite |
| Usable travel initiation path and actual caller | Verify available remote agent/client workflow | Verify authenticated service admission from that workflow | Phone-only invocation path unverified. If no supported existing route exists, qualify the narrow browser endpoint in section 10 |
| Apple trust and permitted bootstrap method | Existing pairing unverified | Independent pairing unverified | Developer Mode, unlock/trust prerequisites unverified |
| Project adapter, source identity, app identifier, approved team | Resolve current project configuration | Resolve current project configuration | Verify installed compatible app identity |
| Signing certificate/profile availability and expiry | Independently provision and verify | Independently provision and verify | Registered-device coverage where the chosen method requires it |
| Backend revision, dependency licenses, packaged runtime and privileges | Select after inspection | Qualify independently | Protocol compatibility unverified |
| Login, FileVault, Keychain and awake-state requirements | Observe | Observe | Required phone actions recorded per operation |
| Existing UI/test/debug sessions and named resource leases | Inspect without disruption | Inspect without disruption | Current device operation owner unverified |
| Direct and relayed route support, idle traffic and battery cost | Unmeasured | Unmeasured | Unmeasured |

Record the chosen minimum supported versions, actual qualified combinations, and unsupported combinations separately. A tool's documented version range is a candidate range until Contribution's relevant operations pass on the target hardware. Cable-free nearby pairing in Xcode 27 applies to devices on the documented newer OS versions and does not prove tailnet pairing. See the primary-source index in [07-SOURCES_AND_DECISIONS.md](07-SOURCES_AND_DECISIONS.md).

## 4. Initial backend decision

Keep Apple's native Xcode/CoreDevice path for local and other already supported Apple connections. The initial remote prototype and packaged-backend candidate is a **pinned go-ios adapter**, selected for its modular implementation, structured output, and permissive MIT license. This is a selection for investigation, not a claim that go-ios already provides Contribution's cold-cellular route or a native Xcode destination.

Resolve the exact version or commit and dependencies in D0. Do not install the latest global tool at application startup. A selected backend and its compatibility decision are part of the installed Contribution release. It must be replaceable without changing project-facing operations or losing historical receipts.

| Candidate | Planned role | Qualification and maintenance boundary |
|---|---|---|
| Native Xcode/CoreDevice | Standard local/USB baseline and remote native destination where a real compatible route exists | Use documented commands and current JSON output. Verify live schemas and actual connection state. Do not extend a transport allowlist and declare the missing route solved |
| go-ios, exact pinned revision | Initial remote protocol prototype and preferred packaged-backend candidate | Prove authenticated endpoint selection, tunnel establishment, per-operation support, required privileges, remoted coexistence, dependency notices, and removal/replacement boundary |
| pymobiledevice3, exact reviewed revision | Isolated diagnostic comparison or separately reviewed backend integration | Current project declaration is GPL-3.0-or-later. Its userspace path can avoid root in supported cases, while native mode can contend with remoted and other arrangements have different privilege requirements. Do not assume subprocess packaging resolves every redistribution question |
| Existing remote-Xcode bridge, including Nuticast as a candidate | Compare native destination and debugger behavior when its integration permits | Inspect license, purchase/embedding terms, interface, discovery conflicts, and network restrictions. Nuticast's documented remote-Wi-Fi workflow excludes cellular |
| Private HTTPS manifest/package route | Separate cellular installation fallback if qualified | Verify export/signing mode, iOS system-installer access, required taps, identity/data retention, revocation and installed-build confirmation. It does not provide developer services |
| Additional custom iOS client | No baseline dependency | Consider only at the decision gate in section 11, after a specific evidenced gap and an API-level proof |

The supplied handoff reports an ios-ota warm-cellular installation bridge, a Wi-Fi acquisition requirement, and no native Xcode Run destination. The repository/architecture URLs could not be retrieved in this review. Preserve those statements as handoff-reported claims pending inspection. Do not use them to qualify hardware or guarantee recovery.

Prototype commands must select their intended backend and transport explicitly. Do not allow an automatic fallback to change privilege, pairing, service ownership, or native Xcode interaction without recording that decision. In particular, do not let a diagnostic fallback silently evict an existing remoted session. If a dependency exposes a broad device-service API, keep it private and accessible only through Contribution's scoped dispatch. The documented pymobiledevice3 tunnel HTTP API is unauthenticated and is not Contribution's remote-control interface.

If a kernel interface requires privilege, first determine whether a supported userspace route can provide the required operation. If a helper remains necessary, specify the smallest fixed privileged operation and integrate it with the existing platform/service boundary. The app, engine, and agent-supplied commands must not run as root. Preserve normal local development when the remote backend is unavailable.

## 5. D0 through D4 delivery sequence

| Device phase | Core dependency | Required outcome and exit evidence |
|---|---|---|
| D0. Inventory, ownership, and prerequisites | During M0 | Complete the observed inventory, map project/source authority, identify the actual travel caller and remote initiation path, select the bounded prototype and pinned candidates, record existing trust and sessions, and identify only the missing prerequisites |
| D1. Remote Wi-Fi and cold-cellular feasibility | After M1 provides minimal journal and scoped dispatch. Read-only isolated protocol inspection may start earlier | Prove an authenticated remote-Wi-Fi operation, then distinguish warm cellular from new cellular sessions and restart recovery. Produce the evidence-backed backend decision and retain unresolved cases |
| D2. Verified build and in-place install | After M1/M2 shared execution and the relevant adapter parity proof | Prepare independently of phone reachability, select one immutable signed artifact, initiate from the actual travel setup, install in place, verify identity/version and meaningful retained data, and qualify the first useful route on both Macs |
| D3. Launch, logs, tests, UI, and debugging | After D2 | Qualify launch, bounded diagnostics, signed native tests/accessibility interaction, and actual debugger workflows independently. Keep native Xcode destination integration as a separately reported result |
| D4. Recovery, host transfer, retention, and release | Integrate with M6 packaging and update qualification | Complete interruption, restart, host-transfer, revocation, private evidence, direct/relayed path, compatibility and idle-cost proof for every claimed capability |

D0 through D4 reuse the core work and can proceed alongside unrelated M0 through M6 implementation. An unresolved D1 case does not block useful Git/handoff development, but it prevents a claim that the full remote target has passed. D3 capabilities do not disappear when D2 ships. Record each unfinished requirement in Contribution's canonical deferred-work record with its phase, blocker, next proof, and acceptance IDs.

### D1 bounded physical feasibility gate

Start with one approved fixture app containing persisted local records, a Keychain-dependent value, a draft/configuration value, and an observable build identifier. Use a compatible signed update. An empty app does not establish data-retention behavior. Record which fixture actions are authorized before changing a valuable product.

Qualification is an explicit, bounded investigation intent. It may exercise an unverified capability on the approved fixture to obtain its first evidence. That does not make the capability available for ordinary operation. Bind the investigation to its AT case, exact device/host/context, declared plan and attempt budget through the shared journal. Preserve all trust, signing, app-identity, caller authorization, ownership, and project guards. Document 03 owns the exact qualification entry point and receipt fields. There is no general force flag or automatic exemption when a routine operation encounters an unverified capability.

1. Demonstrate the native/local baseline and read back the named device and installed app identity.
2. Put the phone and chosen Mac on different working Wi-Fi networks. Use the tailnet route without a shared LAN or USB dependency. Establish an authenticated operation and verify one in-place signed update.
3. Keep that session, move the phone to cellular, and repeat the named operation. Record whether the same outer developer session survived. This is warm-cellular evidence only.
4. Close the prior outer developer session, verify that it is absent, and leave the phone on cellular with no usable Wi-Fi/cable path. Attempt a fresh authenticated session and the named operation.
5. Repeat after a phone restart and any required unlock, then after a selected Mac/utility restart while the phone remains on cellular. Reconcile preceding effects before repeating a mutation.
6. Record direct or relayed Tailscale routing, actual device service observations, selected backend/version, user actions, deadlines, and readback. Preserve the distinction between discovery, IP route, Apple trust, phone service, tunnel negotiation, and operation failure.

Use a declared bounded investigation. The initial planning budget is two focused engineering days and one assisted device session of up to 90 minutes, adjustable before testing when the owner's availability requires it. Within each case allow at most three connection attempts under a recorded deadline. These are investigation limits, not measured product timing guarantees. Stop repeated experiments when they no longer test a different evidenced hypothesis. Deliver the partial findings and next decisive experiment when the budget is exhausted.

A timeout by itself is not proof that iOS requires Wi-Fi. Capture the missing observed stage and avoid a more specific cause than the evidence supports. Do not reset trust, reinstall the app, change network policy, or introduce public exposure to manufacture a successful case.

D1 ends with one recorded decision:

| Decision | Permitted next step | Work that remains open |
|---|---|---|
| Direct backend meets the tested remote and cellular cases | Integrate that exact backend in D2 and continue operation qualification | Every untested operation, version, host and recovery case |
| Direct backend works for remote Wi-Fi and possibly warm cellular | Ship only qualified capabilities and investigate private OTA for independent cellular installation | RDEV-19 and AT-08 through AT-10 where cold/restart developer access is missing, plus later unqualified capabilities |
| An identified backend gap has another plausible reviewed implementation | Run one bounded comparison that can distinguish the gap | Original target and current failure evidence remain intact |
| A precise gap may require an iOS component | Apply section 11 before implementing that component | No assumption that an ordinary app can override developer-service restrictions |
| No qualified route within the investigation budget | Keep the affected capability unavailable with evidence and a specific next experiment | Full remote target remains incomplete, core delivery continues |

A warm result, hotspot use, a tailnet ping, a Safari download, or a successful subprocess exit cannot substitute for AT-08 through AT-10. Reproduce the selected route on the second Mac before D2 claims dual-host support. No further hardware experiments are implied when only fixture or source inspection is available.

## 6. Routine interaction and truthful status

The module is disabled by default through `machine.remoteDevices.enabled: false`, with persistent session maintenance separately disabled through `machine.remoteDevices.maintainSession: false`. Enable only the selected supported behavior through the shared settings contract.

The owner chooses the approved Mac, physical phone, project, and intended operation. Preselect only an already explicit, unambiguous saved choice. The UI shows the selected artifact/build before installation and its qualified network/method context. Agents see the same identity and availability in structured results.

Use the command family in [03-AGENT_CONTRACT.md](03-AGENT_CONTRACT.md). It includes `devices list`, `devices status`, `devices pair`, `devices authorize`, `devices revoke`, `devices prepare`, `devices install`, `devices launch`, `devices logs`, `devices test`, `devices ui`, `devices debug`, `devices capture`, `devices disconnect`, `devices transfer-host`, and `devices reconcile`. The `devices artifacts transfer` operation moves an approved immutable build explicitly. Shared run commands own following, inspection, and cancellation. Discover exact supported flags and schemas through installed version-aware help rather than inferring them from this list.

Show separate **Prepare build**, **Install**, and **Install and launch** actions. Disable unavailable operations with the actual prerequisite and a useful next action. Preparing an artifact can remain available when the phone is offline. An existing install link is **Delivery prepared** until documented verification establishes installation. If installation passes but launch fails, retain both results and offer a launch-specific action.

The compact device view shows the chosen host and phone, current operation, last contact, usable capabilities, and the most useful next action. Put detailed identities, service probes, diagnostics, and evidence in the existing dismissible diagnostic sheet with copy/export. Do not show a global green badge that implies every developer operation is available.

## 7. Capability, readiness, and operation contracts

### Five independent dimensions

| Dimension | Required meaning |
|---|---|
| Host and tailnet availability | Is the approved execution host available, and can the selected private route be used? |
| Physical-device identity and trust | Is this the specifically approved phone with the required Apple trust, rather than a peer with a matching name? |
| Apple service/session readiness | Does the required device service/tunnel exist and meet unlock, Developer Mode and developer-resource prerequisites? |
| Capability qualification | Has this operation been qualified for this backend, host/toolchain/device version, and network context? |
| Ownership and result certainty | Who owns incompatible work, what effect is in progress, and what has actually been observed? |

The `device-capability` contract retains the qualification values `unverified`, `supported`, `unsupported`, and `requires_action`. A capability claim names its operation, backend revision, device/toolchain versions, network context, evidence reference, and known limits. Current availability and observation freshness are separate fields. An offline phone does not invalidate historical proof, and historical proof does not make the phone currently reachable.

The agent contract maps stable reason codes for offline host, denied tailnet access, absent device service, unlock/Developer Mode/trust requirements, incompatible tools, busy device, invalid signing, pending verification, and uncertain effects. Preserve the original handoff categories without creating a second lowercase wire-code vocabulary. Exact codes, object fields and enum spellings live in the shared schemas.

Use the existing response envelope. In particular, a mutation whose device effect is uncertain uses `operationState: outcome_unknown` with the `OUTCOME_UNCERTAIN` reason and the remote effect's certainty fields. Do not add an incompatible `outcome_uncertain` value to the core operation-state enum. A display label may say “Outcome uncertain.”

### Accepted request and receipt

Before privileged work, durably bind the operation ID, approved caller, host, physical device, project, selected backend/method, relevant configuration revision, and exact artifact or installed app identity. Artifact references include the prepared source/configuration identity and digest. Do not permit an agent to substitute an arbitrary shell command or package path after admission.

An idempotency key deduplicates the same immutable request. Reusing it with changed device, project, artifact or operation semantics is a conflict. An explicit retry is linked to the earlier attempt and begins with reconciliation when effects are uncertain. Repeated observation of an operation must not create another mutation.

Receipts record the requested artifact and separately record what the phone actually disclosed. Include source/configuration and artifact digest, bundle/team/version/build, host/device references, backend/toolchain versions, delivery method, network case, timestamps, observed readback, certainty, and missing proof. Keep pairing keys, signing keys, control credentials and bearer URLs out of receipts. Do not invent a phone-side artifact hash when only bundle/version fields can be measured.

Use the remote status, capability, operation, ownership, artifact-provenance, and device-test-evidence schemas linked from the agent contract. Keep one source of runtime types and schema validation. Validate current Apple JSON before mapping it. Version-aware handling must replace deprecated fields when necessary.

## 8. Build, installation, recovery, and data continuity

The project adapter prepares the artifact under the project's source-selection, toolchain, identity and activation rules. Preserve exact inputs and signature/provisioning checks. An artifact prepared while the phone is offline can be selected later only if its retained metadata and bytes remain valid. If another Mac installs it, move the immutable artifact through authenticated retained transfer and verify integrity at receipt. Do not sync signing or pairing secrets, a build directory, or arbitrary native caches.

Before installation, validate the intended physical phone, compatible app identifier and team, relevant entitlements/provisioning, required device state, foreground/pending-operation policy, and ownership. Install over the compatible existing app. Never uninstall to repair connectivity. Keychain access, app data, drafts, saved preferences and product pairing identities are explicit retention proof. Project-owned irreversible schema migrations and downgrade policy remain authoritative. A retained old artifact is not automatically a safe rollback.

Report the actual backend stages, including preparation, artifact verification, device/session checks, transfer, installation, installed-identity verification, and optional launch. Supply bytes and counts only where observed. Do not fabricate percentages or completion estimates. Cached status remains responsive while a build runs. Explicit refresh, connection attempts and stage waits have documented finite deadlines. Use the core performance targets for local overhead and calibrate backend deadlines from D1/D2 measurements, recording any version-dependent limit.

Persist intended effects before execution. If a connection drops during transfer, install, launch or tests, distinguish what is proven from what may already have happened. Reconnect and query the installed app or session before offering a retry. Cancellation cannot retract an installation already accepted by iOS. Closing a window or losing the initiating SSH connection does not cancel the service's accepted operation.

A persistent developer session is allowed only while enabled. Measure idle CPU, tailnet traffic, phone battery impact and recovery behavior. Pause, disable, deliberate sleep and revocation invalidate current availability and stop unauthorized reconnection. Inner log/test/debug streams can fail independently of the outer session. Release only the affected utility-owned resources.

## 9. Two-Mac device ownership and transfer

Reuse the device ownership primitive defined in the shared architecture. It is distinct from repository Git ownership and named build/simulator resources. Each host admits only its explicitly authorized operations, serializes local conflicts, and honors known project/Xcode/test sessions. An advisory local lock does not fence another computer or an unmanaged Apple process.

A normal transfer records the old and new host, blocks new conflicting work, reconciles active effects, releases the old Contribution-owned session, records durable relinquishment, and checks the new host's independent trust/readiness before granting it work. A release may be durably prepared while the destination host is offline and admitted there later through the supported release reference and expected ownership revision. Lost acknowledgments recover through the same transfer ID and retained release/admission records. Do not generate new pairing identities or revoke unrelated pairings during a transfer.

After a clean recorded handoff, the previous host may be offline. No steady-state requirement keeps both Macs running. If the former owner is unreachable before relinquishment can be established, the state is `previous_owner_unconfirmed`. Do not start a conflicting operation solely because a lease expired, a PID is absent on this Mac, or a heartbeat stopped. These observations cannot prove that a device-side effect or another host's session ended.

An unresolved former owner needs the documented evidence-based reconciliation route. A manual recovery may be required to establish that prior work is stopped and the device state is known. Do not invent a timeout-based election, use Git sync as a distributed lock, or silently force takeover. If automatic takeover is later requested, first prove an authority and fencing mechanism that can enforce it on the relevant operations.

Check known local Xcode/test conflicts before admission and recheck at the relevant boundary. Surface busy/ownership conditions without killing unrelated processes. Explicitly record the limits of detecting unmanaged external activity. Qualify those limits in AT-15 rather than promising complete control over every Apple tool.

## 10. Authorization, private OTA, and evidence

Use local IPC for same-Mac agents and the existing fixed authenticated SSH entry point over Tailscale for cross-Mac initiation. The receiving service validates the approved device, project, operation and artifact. Tailnet membership alone does not authorize installation, debugging, arbitrary app-data access, or product actions. Keep control and private state under the same application authorization and OS/private storage model as the core.

D0 must identify a usable initiation path from the actual travel setup, including a phone traveling while the Mini remains at home. Prefer an existing supported Codex/agent remote-access workflow that invokes the same Contribution CLI and service on the selected Mac. Verify that actual caller and its authentication, rather than assuming remote agent access is present. D2/AT-04 must demonstrate the real remote invocation, status and result from that setup.

If no supported existing caller can initiate the required travel workflow, a narrowly scoped authenticated tailnet browser/control endpoint is part of satisfying RDEV-26. It is not automatically deferred as optional future work. The existing user service owns that handler and routes its named device/project/artifact operations through the same admission, authorization, journal and events. Use the shared app identity and fixed operation set with the actual browser authentication/session protections, request validation and scope checks. Do not add another service owner, a generic remote shell, raw backend APIs, public Funnel or an unrelated distribution channel. A browser is the interface, not a permanent custom iOS client. Qualify this path in AT-04 and AT-20 if OTA is selected.

OTA is an optional separate feasibility track. A private HTTPS manifest/package endpoint must serve only an approved artifact with bounded retention and revocation. Verify certificate trust and the actual iOS system installer's access to both resources. A browser login or successful Safari fetch is insufficient because the installer may use a different request context. Use an authorization method the real installer can complete. Do not silently expose the artifact publicly when that method fails.

Keep Development and ad hoc/export choices explicit. Inspect actual identifiers, team and relevant entitlements before changing method. Roboty's current local-development activation does not authorize ad hoc distribution or TestFlight. Apply actual project/session authority to a concrete selected method. Preparing a candidate or investigating its feasibility does not activate that distribution method.

A manifest request, package transfer, successful install-page tap or backend exit is not installed-version proof. Prefer device readback. If the candidate OTA route has no developer readback, D1/D2 must define and prove a documented device-side confirmation, such as a narrowly scoped project-owned build receipt after the user launches the app. That optional project receipt must bind the observed app build and approved device/project context, describe its trust limits, and retain required taps. A download token alone does not prove physical device identity. Until confirmation succeeds, report verification pending and delivery prepared. Do not add a permanent iOS utility merely to make the status green.

Capture screenshots, video, logs and UI interactions only for the named authorized purpose with bounded scope and private retention. They are independent capabilities, not prerequisites to installation proof. Cleanup targets only Contribution-owned sessions, temporary artifacts and approved test runners. Removing a device entry is not permission to uninstall apps or reset global Apple trust. Revocation stops future privileged operations and invalidates cached readiness without silently repairing authorization through a new pairing.

## 11. Additional-client decision gate

Retain the no-client default. A proposal for a custom iOS component must document the specific missing system capability, the evidence that a Mac-only route cannot supply it in the target case, and the exact API, entitlement, foreground/background, and permission model that the component can use.

Require a small distinguishing proof before product implementation. Explain coexistence with Tailscale if a second VPN or Network Extension is proposed. An ordinary app cannot be assumed to override developer-service restrictions. A signed XCTest/accessibility runner is an operation-specific testing dependency with a defined lifetime and cleanup policy. It is not a decision to add a permanent companion product.

The resulting decision is one of: no additional client needed, a specific optional component justified by evidence, or the capability remains unresolved. An inability to prove a route does not by itself justify building a client.

## 12. Qualification and release integration

The original AT-01 through AT-24 rows in section 15 remain the single canonical physical acceptance contract. [06-ACCEPTANCE_TESTS.md](06-ACCEPTANCE_TESTS.md) links them into the combined acceptance plan. The existing 54 core scenarios are preserved. Device fixtures validate admission, event/state transitions, capability mapping, identity mismatch, cancellation and uncertainty logic. They do not establish cellular networking, Apple trust, signing, actual install, app-data continuity or debugger behavior.

D3 must retain all four capability areas after the first verified installation:

1. Launch, including install-success/launch-failure separation and project foregrounding rules.
2. Logs and diagnostics, including source, timestamps, bounded collection and teardown.
3. Native tests and accessibility-based UI interaction, including approved signed-runner lifetime and scope.
4. Interactive debugging, including actual attach, breakpoint, inspect, resume, disconnect and cleanup. Report native Xcode destination integration separately from an explicit debugger bridge.

Keep capabilities qualified by operation, device, host, exact versions and network case. Repeat applicable proof on both Macs. AT-08 through AT-10 require a record that the prior developer session was absent and the phone actually used cellular. AT-20 cannot close AT-19 or count as a full developer connection.

Integrate dependency updates, toolchain changes, background registration, pause/quit behavior and service quiescence into M6. An update drains or reconciles device mutations under the same maintenance window as other operations. Preserve retained artifacts, receipts, pairing, project data and future authorization. Revalidate affected physical cases after relevant backend, Xcode, iOS or Tailscale changes. Keep unaffected local workflows usable when qualification expires.

Completion reports must distinguish implementation, fixture proof, one-Mac physical proof, both-Mac proof, and unresolved network/operation cases. Core release, qualified remote subset and full remote-development acceptance are separate statements. Keep remaining D work in the canonical release/deferred record with acceptance links, not in an untracked parallel backlog.

## 13. Original requirements retained verbatim

The following RDEV requirements are incorporated unchanged from the owner's attached handoff. The ownership and phase mapping in section 14 integrates them into Contribution. Descriptive references to existing utility mechanisms resolve to the canonical documents linked above. Proposed terminology in the handoff does not supersede the exact shared wire schema.

### Host and device management

- **RDEV-01 — Two independent hosts.** Support the Mac Mini and MacBook Pro as independently provisioned utility installations. Either can be selected as the execution host. No requirement for both Macs to be running concurrently.

- **RDEV-02 — Explicit identities.** Bind each operation to an approved host, physical device, project, bundle identifier, signing team, and requested artifact/build. Resolve ambiguity explicitly; do not guess by display name or use the first reachable device.

- **RDEV-03 — Protected pairing.** Establish and retain the Apple device trust required by the chosen backend. Explain any Developer Mode, unlock, trust/PIN, cable, or shared-network bootstrap step. Preserve normal Xcode pairings and unrelated device approvals.

- **RDEV-04 — No routine trust reset.** Reconnect with existing approved identities. Do not reset all trust, generate new pairing identities on every launch, or export private Apple pairing records through the utility's general sync mechanism.

- **RDEV-05 — Reachability and readiness.** Distinguish an offline Mac, unavailable Tailscale route, denied access, unreachable phone service, locked phone, missing Developer Mode, trust failure, incompatible developer resources, and a busy operation.

- **RDEV-06 — Network coverage.** Target shared-LAN Wi-Fi, different Wi-Fi networks, isolated guest Wi-Fi with working internet, phone cellular, Mac internet supplied through tethering, and mixed Ethernet/Wi-Fi/cellular arrangements. Tailscale cannot replace completing a captive portal or obtaining an actual internet connection.

### Build, signing, installation, and launch

- **RDEV-07 — Project adapters.** Keep source selection, project/scheme/configuration, build numbers, toolchain requirements, entitlements, and repository policies in a project adapter or the existing project workflow. The shared utility owns the reusable device operation.

- **RDEV-08 — Build separately from transfer.** Allow preparation of a signed artifact even when the phone is offline. Reuse only artifacts whose exact source/configuration/toolchain inputs and signature/provisioning have been checked.

- **RDEV-09 — Preserve signing authority.** Use the owner's approved Apple team/account and the project's distinct app identity. Each Mac uses independently authorized signing assets. Do not copy credentials from another app or silently synchronize private signing material.

- **RDEV-10 — In-place update.** Install over the existing compatible app. Preserve its data container, Keychain access, local configuration, and paired product identities. Never uninstall as a connectivity repair. Decline an incompatible identity migration until a project-specific migration is approved.

- **RDEV-11 — Verify actual result.** After installation, verify the target device, bundle identity, version/build, and other supported readback. A completed upload, served manifest, successful subprocess exit, or install-link tap alone is insufficient. Keep artifact provenance separate from what can actually be measured on the phone.

- **RDEV-12 — Launch is distinct.** Offer install-only and install-and-launch. Report launch failure separately from installation success. Respect a project's pending-operation/foregrounding guard; no implicit force-quit, app reset, or execution of product actions.

- **RDEV-13 — Explicit operation intent.** Every mutation has a specific device/project/artifact and an operation identifier. No generic remote shell, arbitrary bundle uninstall, or automatic activity triggered merely by a phone appearing on the tailnet.

### Diagnostics, tests, and debugging

- **RDEV-14 — Useful diagnostics.** Provide available app logs/diagnostics through the qualified backend, with timestamps, source, bounded capture, cancellation, and private retention. Missing log support must be reported per backend rather than hidden.

- **RDEV-15 — Tests and UI interaction.** Permit scoped native tests and supported accessibility interaction over a qualified developer connection. Distinguish an optional signed test runner from a permanent companion iOS product. Runner provisioning, installation, lifetime, cleanup, and authority must be documented.

- **RDEV-16 — Debugging qualification.** Investigate both native Xcode destination integration and an explicit debugger bridge. Prove attach, breakpoint, inspect, resume, disconnect, and cleanup. Record unsupported operations and version combinations; do not weaken Apple signature or developer protections.

- **RDEV-17 — Private visual evidence.** Screenshots or screen capture are explicit capabilities with owner-controlled scope and retention. They are not required to establish installation success. Product-specific camera/privacy restrictions remain authoritative.

### Recovery and multiple Macs

- **RDEV-18 — Persistent session when appropriate.** The selected host may maintain a session while the feature is enabled to support network changes. Measure its reliability and idle cost. The owner can pause/disable it; reconnection respects that choice.

- **RDEV-19 — Cold cellular feasibility.** Establish whether a new session can be opened entirely on cellular on the owner's target OS versions. Test both connection after a deliberate session close and connection after phone/Mac restart. Preserve an unresolved requirement if only a warm path works.

- **RDEV-20 — Bounded recovery.** Use configurable deadlines and bounded retries/backoff. Distinguish waiting for network/service availability from an exhausted recovery budget. Report the concrete next action instead of an indefinite spinner or generic "connection failed."

- **RDEV-21 — Reconcile uncertain effects.** If a connection drops during install/launch, record an uncertain result and query the device before retrying. Do not blindly replay a launch or queue multiple updates because a reply was lost. Cancellation must report what might already have happened.

- **RDEV-22 — Single operation owner.** Serialize incompatible operations for a phone, including across the two utility hosts and known local Xcode/test sessions. Prefer the existing utility's coordination primitive. A host transfer must not terminate unrelated Apple daemons or another host's work.

- **RDEV-23 — Explicit host transfer.** Switching the selected development host releases or reconciles the old session and rechecks trust/readiness on the new host. Handle an unreachable former host without pretending that local lease expiry guarantees the phone-side session disappeared.

- **RDEV-24 — Lifecycle boundaries.** Integrate with the utility's existing supervised background lifecycle. Explain whether availability needs login and an awake Mac. Respect OS background permission changes, deliberate sleep, pause, quit, and update behavior. Do not promise unattended availability through shutdown.

### Shared interfaces and integrations

- **RDEV-25 — Common UI and CLI/API.** Expose the same operation model to humans and agents. Use structured, versioned results and stable reason codes; provide progress/events and a status/reconcile operation. Local callers should not need to scrape a GUI or unversioned Apple console text.

- **RDEV-26 — Remote initiation.** Reuse the utility's existing authorized remote-control mechanism for starting work on the home Mac. If none exists, plan a narrowly scoped tailnet-only control surface. Protect it with application authorization in addition to network membership.

- **RDEV-27 — Artifact movement.** If one Mac builds and the other installs, transfer the selected immutable signed artifact through the utility's existing artifact/sync mechanism, preserving integrity, identity, and provenance. Do not transfer private signing/pairing keys to accomplish this.

- **RDEV-28 — Versioned integration.** Project adapters negotiate backend capabilities and schema versions. An unsupported OS/toolchain/backend must fail with a specific reason. Revalidate Apple's actual JSON schema before mapping fields; do not rely on deprecated fields without version-aware handling.

### OTA candidate and possible iOS client

- **RDEV-29 — OTA feasibility track.** Evaluate a private HTTPS package/manifest route if a direct developer session cannot meet cellular installation needs. Validate provisioning, installer access over Tailscale, user prompts, identity continuity, and real installed-version readback.

- **RDEV-30 — Honest fallback semantics.** OTA may satisfy installation while launch/logs/tests/debugging remain unavailable. Expose its method and interaction requirements. Do not silently change a development signing identity, activate a public distribution channel, or count fallback installation as full cellular development acceptance.

- **RDEV-31 — No-client default.** The baseline phone requirement is Tailscale plus the ordinary iOS developer/trust prerequisites. Use a browser page for optional install/status interactions where suitable. No permanent custom iOS utility app is a baseline dependency.

- **RDEV-32 — Client decision gate.** If a custom iOS client is proposed, document the exact missing OS capability, why a Mac-only solution cannot supply it, the client's viable API/permission/background model, and a distinguishing proof. A custom app cannot simply override system developer-service restrictions. Account for coexistence with Tailscale if a second Network Extension/VPN is proposed.

### Security, privacy, and data retention

- **RDEV-33 — Layered authorization.** Tailnet membership is transport access, not authorization to install, debug, read arbitrary app data, or control a product. Approve devices/projects/operations through the utility's existing policy. Deny unpaired devices, mismatched identities, revoked hosts, and unauthorized callers.

- **RDEV-34 — Private exposure.** Device-management/control traffic remains private by default. Prefer local IPC for same-Mac agents and an authenticated tailnet-only endpoint for remote callers. No public Funnel, router port forwarding, publicly readable build links, or unauthenticated developer-service API.

- **RDEV-35 — Secret isolation.** Keep pairing credentials, signing secrets, control tokens, and sensitive diagnostics in the approved OS/private store. Do not place them in Git, ordinary command output, an install manifest, public logs, or general-purpose synchronization. Pairing and signing assets have different owners and must not be conflated.

- **RDEV-36 — Safe artifact serving.** OTA endpoints, if used, serve only the approved artifact/manifest, with compatible HTTPS trust, access controls, retention, revocation, and bounded exposure. Verify authentication works with the system installer; a browser-only login flow may not be transferable to package fetches.

- **RDEV-37 — App data protection.** Qualify retention of real local records, credentials, drafts, and any pending operation state. Preserve the app's supported identity and migration rules. Keep irreversible schema migrations and rollback policy project-owned; an older artifact is not automatically safe to reinstall.

- **RDEV-38 — Scoped cleanup.** Clean up only utility-owned sessions, temporary artifacts, and approved test runners. Preserve unrelated apps/processes and valuable user files. Removing a utility device entry is not permission to uninstall the product or revoke all system trust.

- **RDEV-39 — Observable revocation.** Removing authorization or disabling background availability stops future privileged operations and invalidates cached readiness. Do not silently recover a revoked identity by creating a new pairing.

- **RDEV-40 — Private evidence.** Keep exact device/network details and screenshots in controlled local evidence. Share redacted summaries by default. Capture only what is needed to prove the named acceptance case.

## 14. Requirement traceability

Every original requirement retains its ID and has a canonical implementation owner, phase and acceptance coverage. The named owner is a responsibility inside the existing engine/app, not a mandate for another service. Cross-cutting core tests also apply as described in the acceptance document.

| Requirement | Canonical owner | Device phase | Acceptance and required proof |
|---|---|---|---|
| RDEV-01 | Host registry and selected-host dispatch | D0, D2, D4 | AT-04, AT-14, AT-22 on independently provisioned hosts |
| RDEV-02 | Device/project identity and request admission | D0, D2 | AT-01, AT-13, AT-14 with exact approved identities |
| RDEV-03 | Pairing backend and setup UI | D0, D1 | AT-01, AT-12, AT-13, AT-24 with actual bootstrap prerequisites |
| RDEV-04 | Trust storage and recovery | D1, D4 | AT-07, AT-09, AT-10, AT-14, AT-23 without routine trust reset |
| RDEV-05 | Status and readiness model | D0, D1, D4 | AT-12, AT-13, AT-22, AT-24 with actionable layered reasons |
| RDEV-06 | Backend network qualification | D1, D4 | AT-01 through AT-10 and AT-21 with actual underlay/route recorded |
| RDEV-07 | Project build adapter | D0, D2 | AT-01, AT-04, AT-16, AT-24 with preserved source and project policy |
| RDEV-08 | Artifact preparation and retained provenance | D2 | AT-04 extended by offline preparation proof, AT-11, AT-24 |
| RDEV-09 | Project signing adapter and private host stores | D0, D2 | AT-13, AT-16, AT-20 with independently authorized signing assets |
| RDEV-10 | Installation adapter and project data policy | D2 | AT-01, AT-16, AT-20 with in-place identity/data continuity |
| RDEV-11 | Device readback and operation receipts | D2 | AT-01, AT-11, AT-17, AT-20 with measured installed evidence |
| RDEV-12 | Launch adapter and project foreground guard | D2, D3 | AT-04, AT-17, AT-18 with separate install and launch effects |
| RDEV-13 | Scoped request admission and authorization | D1, D2 | AT-13, AT-15, AT-23 plus the shared idempotency/input tests |
| RDEV-14 | Diagnostics backend and private retention | D3, D4 | AT-04, AT-18 with bounded capture, cancellation and teardown |
| RDEV-15 | Project test/UI adapter and signed-runner lifecycle | D3 | AT-18 with individually qualified native test and UI operations |
| RDEV-16 | Debugger/native-destination backend | D3 | AT-19 with actual debugger workflow and supported-version record |
| RDEV-17 | Scoped visual-evidence adapter | D3, D4 | AT-18 with explicit capture authority and private retention |
| RDEV-18 | User-service session lifecycle | D1, D4 | AT-06, AT-07, AT-22 with measured persistence and idle cost |
| RDEV-19 | Cellular feasibility decision and evidence record | D1, D4 | AT-08, AT-09, AT-10 without a prior live developer session |
| RDEV-20 | Supervisor deadlines and recovery budgets | D1, D4 | AT-10, AT-11, AT-12, AT-22 with bounded terminal/waiting outcomes |
| RDEV-21 | Operation journal and effect reconciliation | D2, D4 | AT-11, AT-17 with readback before any repeat mutation |
| RDEV-22 | Device ownership and named resource coordination | D0, D2, D4 | AT-14, AT-15 with no competing utility owner or unmanaged takeover |
| RDEV-23 | Explicit device-host transfer | D4 | AT-14, AT-15 with old-owner release or unresolved ownership |
| RDEV-24 | App/service lifecycle and updater | D0, D4 | AT-10, AT-22 with actual login, sleep and restart boundaries |
| RDEV-25 | Shared CLI/API schemas, UI and events | D0 through D4 | AT-01, AT-11, AT-17, AT-18 plus AT-A01 through AT-A05 |
| RDEV-26 | Existing remote caller/SSH admission or same-service authenticated browser handler | D0, D1, D2 | AT-04, AT-13, AT-23 and AT-20 if selected, initiated from the actual travel setup |
| RDEV-27 | Immutable artifact transfer and provenance | D2, D4 | AT-04, AT-11, AT-14 with different build/install hosts and integrity checks |
| RDEV-28 | Versioned contracts and backend compatibility | D0, D4 | AT-24 plus AT-U03 with current Apple-schema inspection |
| RDEV-29 | Private OTA feasibility adapter | D1, D2 if selected | AT-20 with real installer fetch and installed-build confirmation |
| RDEV-30 | Capability/method presentation and activation policy | D2, D3 if selected | AT-17, AT-19, AT-20 with fallback limits and signing method explicit |
| RDEV-31 | Product dependency boundary | D0 through D4 | All claimed physical cases run without a permanent custom client unless RDEV-32 changes the decision |
| RDEV-32 | Evidence-backed additional-client decision | D1 only if needed | Decision record plus the specific AT case the API-level proof resolves |
| RDEV-33 | Device/project/operation authorization | D0, D2, D4 | AT-13, AT-15, AT-23 with denied callers and revoked identities |
| RDEV-34 | Local IPC, SSH and private endpoint exposure | D1, D4 | AT-02, AT-04, AT-13, AT-20 with private route and listener inspection |
| RDEV-35 | OS/private secret stores and redaction | D0, D2, D4 | AT-13, AT-14, AT-20, AT-23 with no secret synchronization or receipt leakage |
| RDEV-36 | Approved OTA artifact serving | D2, D4 if selected | AT-20, AT-23 with real installer authorization, expiry and revocation |
| RDEV-37 | Project identity, migration and retention policy | D2, D4 | AT-16, AT-20 with meaningful fixture data and rollback constraints |
| RDEV-38 | Scoped backend/session/test-runner cleanup | D3, D4 | AT-15, AT-18, AT-19, AT-22 with unrelated resources preserved |
| RDEV-39 | Revocation and cached-readiness invalidation | D4 | AT-22, AT-23 with no silent repaired authorization |
| RDEV-40 | Private evidence and sanitized export | D1 through D4 | AT-08 through AT-10, AT-18 through AT-21 with controlled exact evidence and redacted summaries |

## 15. Original remote acceptance matrix retained verbatim

This is the single canonical copy of the owner's AT-01 through AT-24 rows. [06-ACCEPTANCE_TESTS.md](06-ACCEPTANCE_TESTS.md) owns the combined acceptance process, evidence/result rules, phase coverage and cross-cutting assertions. It references these rows rather than maintaining a second table.

Run applicable physical-device cases on both Macs. Fixture/unit tests complement them; they do not establish network, signing, installation, or retention acceptance. Use an owner-approved test app/data fixture before changing a valuable product if the route could affect identity or data.

| ID | Scenario | Required proof |
| --- | --- | --- |
| AT-01 | Existing paired phone on suitable same-LAN Wi-Fi, no cable | Exact approved signed build installs; identity/version and retained fixture data are verified. |
| AT-02 | Mac and phone on different Wi-Fi networks | Tailnet-only route works; no shared local network or USB dependency; installation verification passes. |
| AT-03 | Guest/hotel Wi-Fi with device isolation and usable internet | Route works without relying on guest-LAN Bonjour or direct client communication; portal/internet state recorded. |
| AT-04 | Home Mac Mini on Ethernet/Wi-Fi, phone traveling on remote Wi-Fi | Prepare, install, and separately launch/log supported operations succeed. |
| AT-05 | MacBook Pro with tethered/cellular internet | Same supported operations work; record the phone's actual service/underlay state rather than treating hotspot use as proof of cold cellular support. |
| AT-06 | Established session moves Wi-Fi to cellular | Actual operation completes after transition; retained session is identified as warm; compare before/after app data. |
| AT-07 | Established session moves cellular to Wi-Fi | Connection and operation recover without resetting pairing or product state. |
| AT-08 | New session started while phone is already on cellular | Close the prior developer session, confirm no usable Wi-Fi/cable path, establish a fresh session, perform and verify the named operation. No warm-session result substituted. |
| AT-09 | Phone restart followed by cellular-only connection | Re-establish after required unlock; prove which operations work and what user actions were needed. A required return to Wi-Fi leaves this case open. |
| AT-10 | Selected Mac/utility restart while phone remains on cellular | Recover or report a specific unresolved blocker; preserve pairing and reconcile prior activity. |
| AT-11 | Temporary tailnet/network loss during transfer or installation | Record uncertainty, reconnect, read back installed state, and avoid an unverified duplicate mutation. |
| AT-12 | Phone locked/Developer Mode unavailable | Correct actionable reason; no trust reset, uninstall, or false success. Test the actual restrictions of the chosen operation. |
| AT-13 | Wrong phone, wrong app/team, invalid signature, revoked trust or denied access | Fail before privileged operation; correct reason; unrelated data untouched. |
| AT-14 | Switch Mini to Pro and back | Correct host/device ownership, retained host approvals, no parallel conflicting operation, and retained app data. |
| AT-15 | Conflicting Xcode/test/second-host activity | Explicit busy/ownership outcome; no kill of unrelated process or silent takeover. |
| AT-16 | In-place app update with meaningful persisted fixture | Verify local records, Keychain-dependent access, drafts/configuration, and project-specific pending-operation behavior. Do not use an empty app as the only retention proof. |
| AT-17 | Install succeeds but launch fails | Report installed result and launch failure independently; no repeated reinstall. |
| AT-18 | Logs, tests, and UI interaction | Prove each selected operation through each claimed backend/network context; verify bounded collection and teardown. |
| AT-19 | Interactive debugging | Native destination or explicit bridge supports real attach, breakpoint, inspect, resume, and disconnect. Installation-only proof does not pass. |
| AT-20 | OTA on remote Wi-Fi and cold cellular, if selected | Phone's system installer fetches the manifest/package; intended build is installed; identity/data survive; confirmation method and required taps recorded. |
| AT-21 | Direct tailnet route and relayed route | Record the actual path and operation evidence, or document a confirmed backend limitation. |
| AT-22 | Pause, disable, quit, background permission loss, sleep/wake | Only authorized availability returns; no unsolicited install/launch and no inaccurate promise while the Mac is asleep/offline. |
| AT-23 | Revocation and reconnection | No cached session bypasses revoked authority; explicit renewed authorization is required. |
| AT-24 | Protocol/toolchain/client upgrade and unsupported combination | Compatibility is rechecked; structured unsupported result preserves normal local workflows. |

For AT-08 through AT-10, retain a test record showing the phone was genuinely on cellular and the previous developer session was absent. A Wi-Fi toggle, tailnet ping, successful Safari fetch, or warm tunnel alone cannot prove the cold developer path. Confirm the build/operation through actual device readback or the relevant observed debugger/test behavior.
