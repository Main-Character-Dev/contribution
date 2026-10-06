# Connectivity implementation and validation

The authorized [connectivity amendment](requirements/10-VPN_CONNECTIVITY.md) is
canonical. This implementation record explains the existing engine's behavior
and proof; it does not qualify particular VPN products, machines or networks.
The original eight detailed requirements and their 26 schema/example imports
remain unchanged. The amendment clarifies the earlier Tailscale setup wording:
Contribution needs its configured SSH/Git route, with Tailscale diagnostics optional.

## Requirement-to-code gap map

Baseline: clean primary `main` at `b27a8038bec543e02b46a6796070db66e4dfd462`.
The original task checkout was detached at `429b116`; implementation refreshed
to that primary baseline on `codex/vpn-connectivity`, retaining the intervening
resource-cleanup repairs. No user-created state was migrated during development.

| Requirements | Reused functionality | Additive implementation |
| --- | --- | --- |
| VPN-01–03 | Engine, private IPC, ordinary SSH, paired host IDs, strict trust | Repository-independent paired `health`, IPv6 destinations, identity/protocol verification and fresh/stale host evidence |
| VPN-04 | Faults, bounded process runner, diagnostics allowlist | Bounded SSH failure stages, evidence confidence, independent helper/Git outcomes and private process-release evidence |
| VPN-05 | Existing runner and diagnostic boundary | Explicit optional trusted Tailscale status/ping; effective SSH mapping; proxies/unknown targets skip ping; provider facts cannot change readiness |
| VPN-06 | Existing service tick, journal and native launchd helper | One host retry budget across peer callers, monotonic in-process timing, four-target bound, serialized same-host exchanges, parallel independent repository/registry/receipt progress, native passive hints |
| VPN-07 | Request IDs, exact transfers, cancellation fences, remote receipts | Canonical-check intent before send; immutable request lookup before repeating uncertain checks, publication or device admission |
| VPN-08–10 | Existing local operations, CLI and Swift IPC client | Same host snapshots and explicit check/retry/diagnose/reconcile commands; native status/actions; separate actual Git destination evidence |
| VPN-11 | Canonical schemas and migration preflight | Additive connectivity result schema; journal v3 before new semantics; resource allocation never lowers its version; old-reader refusal fixture |

No additional connection service, durable queue, VPN transport or networking
framework was introduced. Enrollment, selected-host device policy, ownership,
original integration adapters, approval scopes and Local/Standard validation
continue to use their existing implementations.

## Operational contract

`hosts list` reads cached observations. `hosts check --host UUID`, `hosts retry
--host UUID` and `hosts diagnose --host UUID` promptly return structured snapshots;
the existing worker owns their bounded execution. Duplicate concurrent checks or
diagnoses coalesce. The native app uses these same commands and the generated
connectivity enums, showing observation freshness, last success and retry time.
A cached success after restart or expiration is previous evidence, not current
readiness. There is no DNS-utility, ICMP, provider-ping or direct-path readiness gate.

The read-only health request requires an already-paired sender, intended receiver
identity and compatible protocol, accepts no repository/command input, and cannot
pair hosts, enroll repositories, update catalogs or reconcile operations. Older
peers without this capability remain usable for ordinary authenticated exchanges.
An unsupported uncertain-admission lookup instead preserves `OUTCOME_UNCERTAIN`;
it never grants permission to resend. Historical operations without an immutable
peer-request scope also require reconciliation. Lookups and cancellation fences
are bound to both sender and repository.

| Policy | Bound |
| --- | --- |
| OpenSSH connection establishment | 8 seconds, one connection attempt |
| Read-only health | 10 seconds, 64 KiB output |
| Peer exchange | 45 seconds, 2 MiB output |
| SSH liveness | 10-second interval, two unanswered messages |
| Existing local process release | 1.5-second TERM grace and 2.5-second final cleanup; policy allows 4.5 seconds to settle a cancelled boundary |
| Provider diagnostics | 8-second total cancellation deadline; commands at most 3 seconds; status 256 KiB, config 64 KiB, help/ping 16 KiB |
| Peer retry | 2-second exponential base, jitter, final clamp at 300 seconds |
| Explicit Retry / platform hints | At most one expedited invalidation per host per 2 seconds; native event debounce 500 ms |
| Health freshness | 30 seconds using monotonic elapsed time while running; stale after service restart |
| Peer concurrency | Four exchanges across targets, one exchange per target |
| Idle registry exchange / running operation observation | 5 minutes / existing 1.5 seconds |
| Process-release observation | One bounded 3-second `ps` query, 16 KiB output, at most 64 retained exact identities |

These are connection/observation limits. Legitimate checks, Git gates and remote
jobs retain their own existing runtime policies. Killing a local SSH exchange is
not evidence that a remote mutation stopped. Retained transfer chunks, checks,
publication and device requests continue to reconcile their original identities.
Queued jobs retain repository ordering; unrelated local work stays available.

The existing native service launcher supervises one immutable verified Node
payload. Its private inherited pipe carries only `launch`, `wake` or `network`
categories. Passive NSWorkspace/SystemConfiguration notifications operate with
the UI closed. Missing events fall back to the existing worker tick and retained
retry deadlines. CLI launch remains direct execution. Shutdown forwards signals
to the owned engine child and preserves its drain/restart behavior. No service
registration or second daemon was added.

Actual Git fetch/push/ref observations keep configured `core.sshCommand`,
`ssh.variant`, `GIT_SSH_COMMAND`, `GIT_SSH` and `GIT_SSH_VARIANT`. Only the default
selection receives noninteractive strict OpenSSH defaults. SSH configuration
continues to own user, port, identity agent, resolver, ProxyJump/ProxyCommand and
multiplexing. Custom wrappers retain their configuration and the runner's outer
deadline/closed stdin; users must configure their authentication accordingly.
Git results describe that exact destination and never require a Contribution
helper. Existing publication gates and uncertain-push reconciliation are unchanged.

## Troubleshooting

1. Read `hosts list --json` or Settings → Setup → Remote connections. Check
   freshness, failure stage, last success and retry information. A timeout does
   not identify Proton, another VPN, a firewall or an unavailable Mac as its cause.
2. Use `hosts check --host UUID --json` for authenticated helper health. To expedite
   retained transient recovery, use `hosts retry --host UUID --json`. A Retry
   does not approve SSH trust or credentials; a new authenticated observation is
   required. Re-enrollment is not a connectivity repair.
3. For changed/unapproved host keys, verify the intended Mac independently and
   use your existing SSH connection settings. For authentication failures, check
   the background worker's actual credentials/agent context. Contribution never
   edits known_hosts, VPN protections, DNS, routes or firewall rules.
4. Use `hosts diagnose --host UUID --json` for optional provider evidence. CLI
   absence/permissions, login state, malformed/changed output, unknown target
   mapping or an unsupported bounded ping degrade diagnostics safely. Direct and
   relayed provider paths are evidence; neither overrides real helper health.
5. If process release is unconfirmed, `doctor --json` retains bounded private
   exact process identities. `hosts reconcile --host UUID --json` observes their
   absence without stopping any live process. Incomplete or inaccessible evidence
   stays blocked. Retry cannot bypass this fence; endpoint changes preserve it.
6. After connectivity returns, use the existing operation-specific reconciliation
   for `outcome_unknown`/attention states. Current host health does not resolve a
   job's uncertain outcome or restore expired authorization. Use the original
   request identity; never submit a new mutation merely to discover the old result.
7. Inspect publication status separately when public Git fails. A working peer
   helper does not prove access to the configured public Git destination.

Shared diagnostics project only categorical connection facts and valid timestamps.
Raw SSH configuration, agent/environment contents, provider inventory, endpoints,
process identities and free-form errors remain outside the sanitized report.
There is no upload. Local CLI host/doctor output remains private detailed output.

## Migration and qualification

New connectivity observations/dispatch semantics fence the existing journal to
v3. Older v2 payloads refuse before opening a writer or dispatching effects. This
is forward migration, with no automatic downgrade or destructive reset. Existing
bindings, operations, request IDs, receipts and resources are retained. The
resource lifecycle only raises versions and cannot lower v3 back to v2. Back up
state through the existing maintenance workflow before a separately authorized
installation; use a compatible payload when returning to retained v3 state.

The [machine-readable verification record](verification/connectivity.json) lists
commands, outcomes and the changed-file inventory. The [acceptance ledger](verification/acceptance-status.json)
keeps all 28 connectivity identities separate from hardware qualification.
Automated fixtures cover actual disposable Git, process ownership, private IPC,
verified worker/CLI/native clients, schema drift, simulated peer/provider failures
and native immutable-launcher behavior. Those results do not prove actual
MacBook Pro/Mini, Proton/Tailscale coexistence, MagicDNS, relayed routing,
ControlMaster/proxy authentication, Wi-Fi/hotspot changes or real sleep/wake.

Remaining owner-controlled validation requires both intended Macs, their approved
installed payloads/host trust and worker authentication contexts. Run the amendment's
hardware matrix, including plain SSH without Tailscale, configured direct/relay
Tailscale, the user's existing Proton protections, resolver/proxy/IPv6 cases,
UI-closed launchd/wake/network recovery, disconnects around acceptance and actual
public Git publication gates. Record exact versions and observations. Changes to
VPN settings, installation, live pairing/enrollment and publication require their
own authorization and were not performed here.
