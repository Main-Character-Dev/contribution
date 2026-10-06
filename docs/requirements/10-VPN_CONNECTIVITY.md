# Contribution: VPN-compatible connectivity and safe recovery

**Date:** October 6, 2026  
**Type:** Additive requirements update for the existing Contribution repository  
**Status:** Authorized additive amendment, October 6, 2026. Source implementation and automated verification are authorized; live installation, enrollment and hardware/VPN approvals remain deferred.

**Provenance:** Reviewed against `b27a8038bec543e02b46a6796070db66e4dfd462`; original attachment SHA-256 `a6b7bd5eaee7ba15fb27a3580b74cdcf3bd0be9772e95dc41c1774e1b2ac1849`. This is the single maintained connectivity amendment. [Connectivity implementation and proof](../CONNECTIVITY.md) records actual behavior and remaining qualification.

## Decision and support boundary

Keep Contribution network-agnostic. Use its existing SSH/Git transport over the user's configured network. Add better connection diagnosis and safe recovery, not a VPN transport or VPN manager.

**Support contract:** Contribution must work over a functioning, authorized connection to a configured remote Mac, including Tailscale used alongside Proton VPN or another VPN when the user's OS, clients, and configuration permit coexistence. When that path is unavailable, Contribution must preserve work, report what is actually known, and recover safely when the path returns.

This does not promise that Contribution can make incompatible VPN configurations coexist. The networking products and operating system remain responsible for routing, DNS, tunnels, and network policy.

The intended path remains:

```text
Contribution shared engine
    -> existing SSH/Git transport
    -> configured SSH alias, hostname, or IP
    -> operating system networking
    -> authorized remote Mac
```

Implement only missing capabilities. Preserve the native Mac app, shared engine, background worker, agent-facing CLI, durable job history, existing enrollment/trust, and current repository coordination rules. Where the Mini is the canonical integration owner, a connectivity failure must never promote another Mac automatically. Local/single-Mac mode must remain independent of Tailscale.

## What the vendor documentation establishes

These facts were checked on October 6, 2026. The requirements below are engineering decisions based on those facts and the supplied Contribution discussion, not assertions about the current implementation.

| Finding | Consequence |
| --- | --- |
| Other VPNs can interfere with Tailscale through policy, platform constraints, or address conflicts. Proton appears in Tailscale's interoperability list. [S1, S2] | Diagnose a failed path. Do not promise universal coexistence or infer a specific culprit from a timeout. |
| Proton documents macOS split tunneling as experimental, paid, app-exclusion based, and supported with WireGuard or Stealth rather than IKEv2. [S3] | Split tunneling is conditional troubleshooting guidance, not a guaranteed repair. |
| Proton documents macOS local-network restrictions with kill switch enabled and split-tunneling incompatibility on most platforms. [S4] | Never disable protections or assume a LAN fallback is acceptable or effective. |
| Tailscale ping modes test particular network layers. They do not establish successful Contribution authentication and execution. [S5] | The real SSH connection and remote health response determine readiness. |
| Some macOS DNS utilities bypass system resolution and can disagree with MagicDNS-capable applications. [S6] | Diagnose through the real transport's resolver path. |
| On macOS, connecting another VPN can disable Tailscale's On Demand behavior until manual reconnection. [S7] | Include a stopped/disconnected-client recovery path, not only route-conflict guidance. |
| Tailscale has multiple macOS distributions, and its CLI JSON format can change. [S8, S9] | Treat provider diagnostics as optional, capability-aware evidence. |

## VPN-01: Inspect and extend the existing implementation

Read `AGENTS.md` and the current architecture, requirements, transport, enrollment, Git workflows, job lifecycle, background service, CLI, diagnostics, and tests before editing.

Produce a brief gap map with requirement ID, existing implementation, missing behavior, affected files, and planned tests. Reuse working behavior rather than rewriting it to match this document's terminology.

There must be one authoritative implementation of connection classification and recovery in the shared engine. Do not add a parallel manager, daemon, queue, database, networking framework, or provider registry. Do not change the app container or require a Codex plugin for networking.

Apply the contract to actual remote execution and Git-over-SSH operations, not just a new diagnostic screen. Keep any existing HTTP/API paths on their existing transports and security model.

## VPN-02: Preserve generic transport, configuration, and identity

Support configured SSH aliases, DNS hostnames, IPv4, and IPv6 through the existing transport. Do not require that a hostname end in a Tailscale domain or that an address fall in a Tailscale range.

Use the established SSH implementation and configuration precedence. Preserve applicable `HostName`, `User`, `Port`, identity, known-hosts, and trusted `ProxyJump`/`ProxyCommand` configuration. Do not build a second SSH-config parser or silently override user routing choices. OpenSSH already defines these capabilities. [S10]

Keep logical machine identity separate from its current network address. Reuse enrollment and host verification. A matching hostname, discovered peer, or successful ping is not sufficient authorization. Preserve approved bindings when addresses change, while rejecting an unexpected remote identity.

Remote operation must not depend on same-Wi-Fi detection, Bonjour discovery, a `.local` hostname, or public internet reachability. Discovery can remain a local enrollment convenience. A known configured remote must be usable without discovery.

Do not add implicit LAN, public-IP, alternate-account, or alternate-host fallback. Existing explicitly authorized alternatives may remain only within the established identity and endpoint policy. Tailscale changing its own direct/relay path to the same peer is not an app-level endpoint fallback.

Use safe argument construction and validate endpoint inputs. Do not interpolate untrusted hostnames, repository paths, diagnostic output, or remote messages into executable shell strings. Preserve deliberate trusted SSH configuration without accepting new executable configuration from discovery or diagnostic results.

### Clarification: destination syntax and owned SSH processes

Keep existing alias fields and CLI spelling compatible. Accept a single configured alias, DNS hostname, IPv4 literal or IPv6 literal as an argument, with documented bounded syntax; use SSH configuration for user, port and proxy settings. Reject options, control characters, shell fragments and ambiguous URI/user/port forms rather than interpreting them. Do not rewrite an alias into a resolved IP, which would change OpenSSH Host matching and host-key lookup.

Keep Contribution host identity, SSH host-key trust and authorization as separate checks. A user-approved endpoint change must verify the same enrolled identity before replacing its binding. Background health or discovery must not enroll, pair, rewrite endpoints or accept host keys. Treat user-owned multiplexing masters and trusted proxy processes as externally owned; recovery may cancel its own channel but must not issue control commands or delete sockets belonging to another owner.

## VPN-03: Determine readiness through the real connection

Run a bounded, non-mutating health operation through the same transport configuration and execution context used for real work.

Successful readiness requires verified SSH host identity, successful authentication, and the existing authenticated Contribution health/capability response. Distinguish transport health from remote helper/tooling availability and operation-specific repository prerequisites. A missing checkout must not be mislabeled a VPN failure.

A Tailscale status entry, ICMP response, open TCP port, or `tailscale ping` response is supporting evidence only. Conversely, failed optional diagnostics must not veto a successful real connection. Do not require a direct Tailscale path when a relayed path works. [S5]

For direct connections, use system resolution consistent with the transport. Never make `host`, `nslookup`, or another resolver-bypassing utility authoritative for application readiness. [S6]

An SSH alias is not necessarily a DNS name. For jump-host or proxy configurations, local resolution and direct target-port checks may be inapplicable. Mark such checks skipped or inconclusive rather than blocking a working SSH path. Never bypass the configured proxy to make a diagnostic succeed.

Test execution from the packaged app and background worker, not only an interactive terminal. Diagnose missing executable access, authentication-agent availability, permissions, or worker environment separately from network failures. Do not source a login shell as a hidden workaround.

### Clarification: health is read-only and scoped

At the reviewed baseline, `hello` writes peer records and can establish an inbound pairing. Add a distinct authenticated, already-paired health action in the same peer protocol; it must not call the pairing route, exchange project catalogs, reconcile jobs or allocate resources on the remote host. Return the expected host identity, compatible protocol and supported capability identifiers without requiring a repository.

A successful authenticated real-work response can refresh connection evidence; a cached health result cannot authorize later work or override a current failure. Bind observations to the endpoint revision and check generation, invalidate them on context change, and discard late results from superseded checks.

The Contribution-helper health requirement applies to Contribution peers. For ordinary Git hosting over SSH, use the existing destination-bound read operation such as `ls-remote`, and preserve independent push/gate/delivery evidence. Public Git servers need no Contribution helper. HTTP/API paths remain separate. Never launch arbitrary repository commands as health probes.

## VPN-04: Return evidence-based, structured diagnoses

Extend existing result types rather than introducing a parallel state system. Keep connection status, remote capability status, and job outcome separate.

Expose a stable machine-readable reason code, observed failing stage, timestamp, retryability, sanitized evidence, and next action. Distinguish observations from suspected causes. Unknown, unavailable, skipped, and not applicable must not collapse into failure.

Cover at least these cases using existing names where available:

| Category | Required distinction |
| --- | --- |
| Configuration/execution | Invalid endpoint or SSH configuration, missing executable, permission failure, background-worker environment issue |
| Name resolution | Actual resolution failure on the configured path, not a failed lookup of an SSH alias |
| Connection establishment | Refused connection, timeout, unavailable route, or unknown connection failure |
| Trust and authentication | Unapproved host, changed host key, unexpected machine identity, missing credentials, authentication denial |
| Remote readiness | Remote Contribution helper unavailable, incompatible protocol/version, missing capability, malformed health response, repository prerequisite missing |
| Optional Tailscale evidence | Diagnostic unavailable, client reports stopped or login required, target absent from visible peer data, reported reachability, or unknown |
| Job reconciliation | Submission/operation outcome unknown after disconnect, independently of current connection health |

Do not infer that Proton is active because it is installed, that a virtual interface proves a second VPN exists, or that a timeout proves a firewall/ACL denial. An SSH failure code alone must not become a definitive VPN diagnosis. Likewise, lack of local visibility does not prove the remote Mac is powered off.

Use wording such as: "The SSH connection to Mac mini timed out. A VPN, firewall, or unavailable remote Mac could explain this." With additional evidence, report that evidence separately. "Another VPN may be interfering" is a hypothesis, not a verified root cause.

### Clarification: confidence, secrets and process outcomes

Record evidence source and confidence as well as stage. An OpenSSH exit of 255 is ambiguous. Recognized bounded stderr can support a classification, but unknown/localized/custom-proxy output stays inconclusive and cannot name a VPN culprit. Ambiguous authentication errors must not be reported as definitely missing keys. Never treat parsed success JSON as success after timeout, cancellation, output overflow or unresolved local process cleanup.

Do not collect raw SSH debug logs, resolved SSH configuration, authentication-agent contents, environment dumps or provider inventory for routine diagnosis. Select bounded categorical evidence before persistence. Private local detail and sanitized export remain separate, using the existing allowlist and report-local aliases.

## VPN-05: Add only a small, optional Tailscale diagnostic adapter

Where useful, add read-only Tailscale evidence behind the shared diagnostic boundary. The core must remain usable without this adapter, the Tailscale CLI, or Tailscale itself.

Discover a supported, trusted installed CLI or app-bundled command in the actual worker context. Do not assume a Homebrew path, an interactive shell's `PATH`, or one macOS distribution. Failure to locate or invoke the command means "Tailscale diagnostics unavailable," not "Tailscale disconnected." [S8]

Use documented read-only commands, such as status and a bounded target ping. Prefer machine-readable output where supported. Limit probes to the configured peer. Do not scan the network or install another Tailscale distribution.

Treat JSON fields, enum values, command support, and human-readable ping output as version-dependent. Tolerate unknown fields, missing optional fields, malformed output, and unsupported commands. Retain only the minimal local/target evidence needed for diagnosis, not the full tailnet inventory. Tailscale explicitly warns that status JSON can change. [S9]

A ping must have a finite count/deadline and must not wait indefinitely for a direct connection. Provider probes run on failure or explicit diagnosis, not before every successful command. They must not delay reporting an already successful application connection.

Do not add a Tailscale SDK, API credential, private socket dependency, embedded tunnel, userspace networking stack, or Proton integration. Do not automatically run provider login, reconnect, routing, DNS, exit-node, update, or configuration-changing commands.

### Clarification: optional provider scope

Do not infer Tailscale usage solely from an installed executable or probe an SSH alias as though it were a Tailscale peer. Run automatic provider diagnosis only when existing explicit endpoint context makes the target applicable; otherwise use explicit diagnosis and mark target mapping unknown. Resolve any optional mapping using OpenSSH-owned effective configuration, if needed and safely bounded, without using that mapping for actual dispatch or authorization. Trusted SSH configuration can itself execute configured helpers; do not evaluate it repeatedly just for display.

Bound status output even though it can include the entire tailnet. Discard unrelated peer/account data before persistence. If command capabilities or target mapping are unclear, skip the targeted ping. A supported ping must have finite count/deadline and must not wait for direct connectivity.

## VPN-06: Recover automatically without hanging or thrashing

Reuse the existing scheduling and process lifecycle. Give connection attempts, health checks, and subprocesses finite deadlines, cancellation, and output-size limits. Use appropriate SSH liveness options supported by the installed version. [S10]

A connection deadline is not the runtime limit of a legitimate long-running job. Use separate operation policies. Killing a local SSH process must not be presented as proof that the remote operation stopped.

Use bounded exponential backoff with jitter for transient failures. Coalesce concurrent retries for the same target. Do not let the app, worker, CLI, and every queued job each start independent reconnect loops.

Respond to wake, network-path changes, meaningful endpoint changes, and explicit Retry. Invalidate stale health results and unusable app-owned connections without deleting enrollment or restarting healthy services. An OS network-change event triggers a new check, not an automatic declaration of success.

For a prolonged outage, show a durable waiting state with the last confirmed success and retry information. Keep low-frequency recovery active while authorized work is waiting, even when no new OS network event occurs. Avoid aggressive polling when idle. A trust/authentication/configuration blocker requires corrective action rather than endless retries.

Keep the app responsive. Cancel stale diagnostic attempts, clean up their subprocesses, and avoid repeated notifications for the same unchanged incident. Reconnect to the same logical machine and reconcile pending work when the actual path is restored.

Choose and document numeric timeout/backoff values using existing policy where possible. Tests must use a controllable clock and verify those limits rather than rely on real sleeps.

### Clarification: one retry owner, independent work and real background events

The retry budget must include registry exchange, completion acknowledgments, notification refresh, explicit status/diagnostics, remote reads and job dispatch, not only queued submissions. Coalesce interchangeable health checks; never combine different mutations. One failed target must not hold a global sequential loop ahead of healthy peers or local work. Preserve per-repository ordering and bound host-wide concurrency.

Use a monotonic clock for live deadlines/debounce and persist wall-clock retry timestamps with restart clamping. Inject both clocks and jitter. Coalesce repeated Retry clicks and network events; do not let them reset trust/auth/configuration blockers or bypass pause, maintenance or authorization.

Network and wake signals must reach the engine while the UI is closed. Use passive platform notifications through the existing native service boundary, with all classification/scheduling in the engine. No new independently installed service, retry loop or network transport is permitted. Notification loss leaves bounded periodic recovery for waiting authorized work. A missing event bridge is visible missing proof, not proof of background responsiveness.

## VPN-07: Preserve and reconcile interrupted jobs

Reuse durable job IDs, submission IDs, receipts, logs, and the existing remote worker. Connectivity loss must not erase queued work or imply failure, cancellation, success, or delivery without evidence.

Persist the operation identity before dispatch. When acceptance or completion is uncertain, retain the same identity and reconcile with the authoritative remote job state before considering re-execution. Duplicate delivery of the same authorized request must not create another mutation. Reject reuse of an operation identity with different input.

Where remote work has been accepted, its lifecycle must not depend on the UI or monitoring SSH session remaining connected. Extend the existing worker's durability if needed. Do not create a second job runner to solve this.

After reconnection, consult durable receipts and relevant Git state using the established workflow. Cover loss before acceptance, loss after acceptance but before acknowledgement, loss during execution, and loss after completion but before the client receives the result.

Never blindly replay commit, merge, rebase, reset, push, deployment, or another side-effecting command. Where an external side effect cannot be safely reconciled, keep an explicit outcome-unknown/action-required state. Do not claim a universal exactly-once guarantee.

Preserve existing committed/received/landed/delivered semantics where used. Keep attempt logs separate from logical job state. Never mark a handoff delivered just because the peer becomes reachable. Do not auto-stash, discard, reset, delete worktrees, bypass approval gates, or transfer canonical ownership as network recovery.

A disconnected cancellation request remains unconfirmed until the authoritative worker acknowledges it. Preserve the existing authorization policy for whether an expired, cancelled, or stale queued request may resume.

### Clarification: acceptance lookup, policy and cancellation

Persist a local immutable request before the first remote dispatch for every effectful route, including canonical checks. Existing request IDs and peer receipts remain authoritative. Add a read-only, sender/repository/request-bound acceptance lookup where the remote operation ID is unknown. It must distinguish a durably absent request from in-progress admission, accepted work, a prior cancellation tombstone and an unavailable/unsupported lookup. A disconnected lookup is never evidence of absence.

Serialize lookup/admission against the existing receiver boundary, bind the complete immutable payload, and retain deduplication evidence long enough that delayed messages cannot replay an old effect. Idempotent transfer begin/offset/finish receipts remain reusable; do not restart an entire bundle or create a new operation identity after losing an acknowledgment. If safe observation is unavailable on an older peer, preserve uncertainty and require action instead of downgrading to blind replay.

Recheck the existing operation-specific authorization, policy revision, owner, source selection and approval scope before dispatch. Do not invent a universal authorization expiry or extend an expired grant. Cancellation intent, remote acknowledgment and observed cancellation outcome are distinct; a cancellation response that still shows running or uncertain work is not confirmed cancellation. Transport cancellation alone never cancels the remote job.

## VPN-08: Preserve privacy and user control

Contribution must not alter VPN clients, routing tables, DNS servers, firewall rules, kill switches, split-tunneling exclusions, exit-node selection, or SSH trust to restore connectivity. Do not add a privileged helper for this feature.

Do not recommend disabling protection as the default fix. A manually chosen VPN comparison test must explain the privacy tradeoff and must not be triggered by an agent automatically. Avoid broad exclusions such as all SSH/Git traffic or entire private address ranges as generic recommendations.

Do not assume excluding the Contribution UI from a VPN also covers its worker, SSH/Git child processes, or Tailscale. Treat that as a real-process-path test requirement, not a claim about all VPN implementations. Excluding Contribution from Proton is not itself a way to create a Tailscale route.

A successful private-peer check does not certify that all internet traffic uses Proton or that a VPN is leak-free. Do not display that assurance.

Keep diagnostic collection local by default. Redact credentials, auth URLs, tokens, private keys, repository credentials, and unnecessary account/peer details before logging or export. Offer an inspectable, sanitized support bundle through the existing export mechanism. No automatic third-party uploads, packet capture, or full environment/configuration dumps.

## VPN-09: Expose the same behavior to people and agents

Use existing app and CLI surfaces. Keep the main UI compact: remote status, one factual explanation, affected work, and the smallest useful next action. Put detailed evidence in the existing diagnostics view or dialog.

Suitable actions include Retry, View diagnostics, Open connection settings, and Copy sanitized report. Offer Open Tailscale or vendor documentation only when relevant and supported. Opening an application must not silently change its configuration.

Examples of required distinctions:

- "Mac mini unavailable. Your submitted work is saved and waiting to be sent."
- "Connection lost after submission. Checking whether the job was accepted before retrying."
- "SSH is reachable, but Contribution's remote helper is unavailable."
- "The remote host key changed. Verify this Mac before continuing."

Use these only when the supporting state is known. Do not label an uncertain submission as definitely unsent.

Expose the same facts, reason codes, timestamps, retry state, and safe actions through the existing structured CLI/API. Schema-version changes must follow current compatibility rules. Agents must not have to scrape UI text or guess commands from error prose. Noninteractive checks must not hang on passwords, host-key prompts, or login pages.

## VPN-10: Keep unrelated workflows independent

A private-peer outage must not disable local editing, local validation, job-history access, or other operations that do not require that peer. Local-only mode must work with no VPN tooling installed.

Track public Git hosting/API failures separately from private-Mac connectivity. GitHub can be unavailable while the Mini is reachable, or vice versa. Do not use a public website ping as a mandatory prerequisite for private work.

Independence does not override workflow authority. If a push or integration step requires the Mini or explicit approval, preserve that requirement rather than treating another working connection as permission to bypass it.

Preserve existing Local/Standard validation behavior and push policies. This update must not add expensive diagnostics to every local command or silently change synchronization targets.

## VPN-11: Documentation and migration

Update existing requirements, architecture notes, troubleshooting, CLI documentation, and agent instructions rather than creating conflicting parallel specifications. Any configuration/schema migration must preserve existing host bindings, credentials, job history, and defaults.

Keep provider-specific guidance in documentation or the existing help mechanism, not transport logic. Date it and cite official sources. Cover Proton's conditional split-tunneling support, kill-switch tradeoffs, Tailscale On Demand, stopped/login-required states, access-policy possibilities, and remote sleep/unavailability. Do not imply these are automatically detectable.

For Proton and other providers, record tested OS/client versions and configurations. Do not require a hardcoded list of supported VPN brands. Do not promise universal compatibility or recommend a VPN replacement as part of this implementation.

### Clarification: canonical amendments, compatibility and evidence

The repository preserves its original eight requirement documents and 26 imported JSON schemas/examples byte-for-byte. Integrate this update as one dated requirements amendment, cross-reference it from existing indexes/review/architecture/help documents, and update the existing acceptance ledger/checker with additive IDs. Do not rewrite historical hashes to hide a contract change or maintain a second schema tree.

Use the existing response envelope and job states with a canonical, versioned connectivity result schema. Separate wire capability negotiation from journal-version compatibility. New persisted dispatch semantics must fence older engines before they can read and replay them, and every version write must preserve that fence rather than lowering the journal version; preserve host IDs, aliases, enrolled repositories, operation IDs, receipts, cancellation tombstones and raw evidence. Unsupported optional diagnostics never disable otherwise safe existing peer work. Rollback must use a compatible reader or an explicitly reviewed recovery procedure, never a database restore that discards post-backup effects.

Implementation, automated acceptance, packaged/GUI validation and actual two-Mac connectivity are separate completion levels. Lack of live installation/hardware authority permits completing source and automated proof, but not claiming full live compatibility.

## Acceptance tests

Use the current test framework, injectable transport/process boundaries, disposable repositories, and fake clocks. Automated tests must not change the developer's real VPN settings or production repositories.

| ID | Scenario | Required result |
| --- | --- | --- |
| AT-VPN01 | Configured plain SSH without Tailscale installed | Connection and supported work succeed without provider diagnostics. |
| AT-VPN02 | Configured Tailscale target, no Bonjour/same-LAN discovery | Known target works. No discovery gate. |
| AT-VPN03 | Working relayed Tailscale path, no direct path | Ready when the real health operation succeeds. No direct-path requirement. |
| AT-VPN04 | SSH alias with nondefault user/port, IPv4/IPv6, or trusted jump/proxy configuration | Real configuration is respected. Inapplicable local DNS/TCP probes do not veto it. |
| AT-VPN05 | MagicDNS-compatible SSH succeeds while a separate DNS utility fails | Ready. No false DNS failure. |
| AT-VPN06 | Tailscale CLI absent, inaccessible, timed out, or returns changed/malformed JSON | Diagnostics degrade safely. A working SSH path still works. |
| AT-VPN07 | Tailscale ping succeeds but SSH is refused, denied, or remote helper is missing | Correct failing stage. Never false ready. |
| AT-VPN08 | ICMP/provider ping fails while authenticated remote health succeeds | Ready with optional evidence marked appropriately. |
| AT-VPN09 | Connection timeout with insufficient cause evidence | Unknown/suspected cause, not "Proton blocked it" or "Mac is off." |
| AT-VPN10 | Unapproved or changed host key, unexpected remote machine, or auth failure | Work is blocked appropriately. No trust bypass or retry storm. |
| AT-VPN11 | Wi-Fi/hotspot change, sleep/wake, VPN reconnect, or stale SSH connection | Bounded recovery to the same identity without re-enrollment. |
| AT-VPN12 | Hanging resolver, proxy, SSH command, provider probe, or oversized output | Documented deadline/resource bounds and responsive cancellation. No leaked probes. |
| AT-VPN13 | Many jobs and simultaneous app/CLI checks during an outage | Coalesced retries, bounded rate, no duplicated logical work. |
| AT-VPN14 | Disconnect before submission and around remote acceptance/acknowledgement | Durable state and reconciliation determine whether dispatch is safe. |
| AT-VPN15 | Disconnect during work or after a side effect before its result arrives | No blind mutation replay. Remote result reconciled or outcome remains unknown. |
| AT-VPN16 | Worker/app restart while offline, duplicate request, changed payload under same ID | History survives. Duplicate mutation prevented. Conflicting request rejected. |
| AT-VPN17 | Lost cancellation acknowledgement or stale/expired queued authorization | No false cancellation or unauthorized resumption. |
| AT-VPN18 | Mini unavailable while local work/public Git works, and the reverse | Dependency-specific statuses. No ownership or approval bypass. |
| AT-VPN19 | Packaged app/worker environment differs from terminal credentials or executable access | Correct local-context diagnosis, not generic VPN blame. |
| AT-VPN20 | Sanitized bundle and structured CLI output | Stable schema, useful evidence, secret redaction, no unsolicited upload. |
| AT-VPN21 | Recovery code is exercised across all failure paths | No VPN, DNS, route, firewall, trust, or implicit endpoint changes. |
| AT-VPN22 | Existing enrollment/job-store migration and Local/Standard workflows | Existing bindings/history retained and unrelated behavior unchanged. |

### Additional review acceptance cases

Retain T01–T22 unchanged and add these cases to the same test framework. During repository integration use additive ledger IDs AT-VPN01–AT-VPN28; do not renumber existing core, device or lifecycle cases.

| ID | Scenario | Required result |
| --- | --- | --- |
| AT-VPN23 | Health on an already-paired, unpaired, wrong-identity or repository-less peer | Health cannot pair, enroll, mutate catalogs, reconcile work or grant authority. Correct identity and capability distinctions. |
| AT-VPN24 | Older probe completes after endpoint/network change, Retry, cancellation or service restart | Superseded evidence cannot restore ready, clear a newer blocker or authorize work; restart preserves last-known success as stale. |
| AT-VPN25 | Failed peer plus healthy peer, with registry, notifications, receipts, diagnostics and queued jobs competing | One shared target retry budget, bounded fair progress for the healthy peer, and unchanged local responsiveness/order. |
| AT-VPN26 | Public Git-over-SSH, custom trusted SSH selection, proxy/multiplexing and uncertain push | No Contribution-helper prerequisite, no transport configuration replacement, no termination of user-owned master, no blind push replay. |
| AT-VPN27 | Upgrade/restart/downgrade with old peer capabilities and new pending operation semantics | Existing bindings/history survive; incompatible old engines refuse before effects; unsupported safe observation preserves uncertainty. |
| AT-VPN28 | Packaged service is running with the UI closed; platform-event source restarts or becomes unavailable | Passive wake/network hints reach the same engine; bounded fallback recovery continues; no second daemon or retry owner; process/payload ownership is retained. |

### Real-machine compatibility validation

Add a short reproducible manual checklist. Record **passed, failed, blocked, or not run** for each case, with date, macOS versions, Contribution build, SSH version, Tailscale version/distribution, and VPN version/protocol/settings where known. Unknown metadata stays unknown.

Validate the packaged app, actual background worker, and CLI on the MacBook Pro and Mini. Use an isolated test repository and the existing handoff workflow. Validate the direction(s) that the real workflow uses, including relevant peer checks from both Macs when available.

| Case | Required observation |
| --- | --- |
| Tailscale baseline with no second VPN | Authenticated health and a test handoff work. |
| Tailscale plus Proton in the user's normal configuration | Either the real workflow works, or the app reports an honest, bounded failure with preserved work. Record configuration incompatibility separately from product defects. |
| User-controlled Proton split-tunneling or protocol comparison, only when available and acceptable | Document what was actually tested. Do not assume UI exclusion covers every process or weaken protections automatically. |
| Proton kill switch, Tailscale On Demand interaction, and a stopped Tailscale client | Actionable diagnosis and preserved protections. No app-driven network changes. |
| Travel-like network transition and interrupted handoff | Recovery and reconciliation without duplicate side effects. |
| Another VPN, when a real environment is available | Same generic contract. Otherwise record not run, not implied coverage. |

An OS/client combination that cannot establish the underlying connection is a compatibility limitation, not permission to bypass protections. A handled failure does not mean that combination has passed end-to-end connectivity validation.

Do not disconnect a remotely administered Mac's only management path to run a test without explicit user coordination and a recovery path. Lack of hardware access must not block implementation and automated tests, but it must block claims that live compatibility was verified.

## Completion criteria and implementation report

Implement this as an additive change to the current engine. Report the gap map, changed files, requirement-to-test coverage, test commands/results, migration impact, and any meaningful dependency additions.

Separate automated verification from real-Mac testing. Clearly identify untested Proton/Tailscale combinations and remaining human actions. Do not report "VPN support complete" solely because a diagnostic command or a mocked connection passed.

The feature is complete when supported real transport paths remain usable, failed paths are explained without invented certainty, authorized work is preserved and reconciled safely, app/worker/CLI share the same behavior, and privacy/trust/workflow invariants remain intact.

## Official references

Sources checked October 6, 2026. Recheck version-dependent guidance during implementation and live validation.

- **S1:** [Tailscale: Can I use Tailscale alongside other VPNs?](https://tailscale.com/docs/reference/faq/other-vpns)
- **S2:** [Tailscale: Interoperability with other software](https://tailscale.com/docs/reference/interoperability)
- **S3:** [Proton VPN: How to use split tunneling, macOS section](https://protonvpn.com/support/protonvpn-split-tunneling)
- **S4:** [Proton VPN: How to use kill switch](https://protonvpn.com/support/what-is-kill-switch)
- **S5:** [Tailscale: Ping message types](https://tailscale.com/docs/reference/ping-types)
- **S6:** [Tailscale: MagicDNS](https://tailscale.com/docs/features/magicdns)
- **S7:** [Tailscale: Using VPN On Demand for iOS and macOS](https://tailscale.com/docs/features/client/ios-vpn-on-demand)
- **S8:** [Tailscale: Three ways to run Tailscale on macOS](https://tailscale.com/docs/concepts/macos-variants)
- **S9:** [Tailscale: CLI reference](https://tailscale.com/docs/reference/tailscale-cli)
- **S10:** [OpenSSH: ssh_config reference](https://man.openbsd.org/ssh_config)
