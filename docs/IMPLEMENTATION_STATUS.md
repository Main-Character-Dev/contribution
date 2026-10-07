# Current implementation and proof

Current software implements the M0–M6 and D0–D4 foundations authorized on October 5, 2026, plus the resource and connectivity amendments. Partial automated proof does not complete the milestones or establish everyday installed use. Live installation, enrollment, peer/phone setup, signing, VPN changes and publication remain deferred.

The [checkpoint history](IMPLEMENTATION_HISTORY.md) retains previous source identities, counts and investigations. It is historical evidence, not the current work list. [Verification](VERIFICATION.md) owns proof levels and all 132 acceptance identities; [update lifecycle](UPDATE_LIFECYCLE.md#journal-compatibility-and-rollback) owns the current journal compatibility floor.

| Capability and owner | Implemented behavior | Remaining qualification or gap |
|---|---|---|
| [Lifecycle](LIFECYCLE.md) / [updates](UPDATE_LIFECYCLE.md) | One journal worker, verified immutable payload, private IPC, durable admission, drain and exec restart | Installed launchd, signed release, real updates, GUI |
| [Configuration](PROJECT_CONFIGURATION.md) / [removal](REPOSITORY_REMOVAL.md) | Explicit enrollment and immutable reviewed writes/removal with crash recovery | Live enrolled projects and cutover |
| [Adopted seams](ADAPTER_SEAMS.md) / [adoption](ADOPTION.md) | Compatible original leases, flights, hooks, reporting and captured-source landing; reversible cutover | Full live original-policy parity and adopted cross-host writer fencing |
| [Peer protocol](PEER_PROTOCOL.md) / [registry](PROJECT_REGISTRY.md) | Scoped transfer, authority transitions, safe mirrors, receipt retention and immutable admission lookup | Intended two-Mac SSH and adopted migration |
| [Connectivity](CONNECTIVITY.md) | Authenticated health, fair bounded tick, monotonic recovery, durable host process grants and consistent offline evidence | Hardware/VPN/resolver/proxy/worker-context matrix |
| [Resources](RESOURCE_LIFECYCLE.md) | Intent before effects, exact process identity, shared grants, dependent cleanup and conservative restart observation | Actual Simulator/provider/native ownership and isolated installed pilot |
| [Storage](STORAGE_RETENTION.md) | Raw-log and managed-data caps; reviewed owned-output, backup and Git retention cleanup | Remaining producer bounds, summary/reference compaction, unknown-output cleanup |
| [GitHub](GITHUB_OBSERVATION.md) / [notifications](NOTIFICATIONS.md) | Current-head checks and retained delivery claims with uncertainty | Live GitHub and native notification interaction |
| [Devices](DEVICE_EXECUTION.md) / [backend](GO_IOS_BACKEND.md) | Scoped grants, qualification validation, retained artifacts/effects and bounded candidate backend | Actual phone, trust/signing, fresh cellular routes and independent operations |
| [Native activity](NATIVE_ACTIVITY.md) / [devices UI](NATIVE_DEVICES.md) | Shared authenticated client, retained requests, explicit scope/action presentation | Visual/accessibility and real device interaction |

## Connectivity audit repair — October 6, 2026

The reviewed repairs retain the same engine, journal, resource owner and transport. Local SSH/provider commands now retain host-scoped process intent/identity before grant, without inventing repository enrollment. Unconfirmed release remains a fence even when timeout, cancellation or generation invalidation initiated it. Saturated waiters release capacity on every exit; maintenance waits for observations and unresolved ownership.

Queued remote work, registry exchange and completion receipts progress independently, with bounded rotating selection and existing repository/domain order. Monotonic in-process retry deadlines survive wall-clock correction; persisted wall deadlines reconstruct a delay clamped to five minutes after restart. Legacy feature negotiation preserves ordinary supported exchanges and uncertain-admission safety. App, CLI and sanitized reports share current freshness; optional provider evidence has its own observation time. Git evidence follows its configured destination and remains independent of gates/delivery.

The native parent reports categorical bridge availability, supervises one immutable worker, and retains its private event pipe across exec restart. Compile-time-isolated fixtures exercise the real parent and real engine. [Connectivity repair verification](verification/connectivity-repair.json) records the final commands, source and limits. Real MacBook Pro/Mini, Proton/Tailscale, signing, installed launchd and physical acceptance remain not run.

## Next qualification boundary

Continue the [interim agent workflow](INTERIM_AGENT_WORKFLOW.md). The next operational step requires separate authorization for a disposable, isolated, installed one-repository pilot. Use exact payload/context evidence; keep real projects and other chats intact. Signing, live enrollment, hardware/VPN/device experiments and publication each retain their existing approval boundaries. No fixture is promoted to observed authority.
