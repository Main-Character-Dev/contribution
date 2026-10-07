# Roadmap

S0 now supplies the development foundation described in [SETUP_STATUS.md](SETUP_STATUS.md). Application and connectivity repairs have partial automated proof; full acceptance and hardware qualification remain incomplete. This roadmap adds S0 before the supplied implementation milestones; it removes none of them.

## Foundation and current qualification

**S0 — Repository foundation implemented.** The reproducible build, native shell, shared packages, schema validation, focused checks, privacy exclusions, short agent guidance and toolchain records are present. Visual window/menu inspection remains explicitly pending with available GUI access. See [SETUP_STATUS.md](SETUP_STATUS.md) for proof. S0 is a subset of M0 preparation. The owner separately authorized all phases on 2026-10-05.

Implementation continues across the remaining milestones. [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) records verified behavior and outstanding work without treating partial fixtures as complete acceptance.

## Core product

| Milestone | Outcome | Depends on | Status |
|---|---|---|---|
| M0 | Buildable app/CLI/engine with one identity, installed-payload boundary, initial storage migration and maintained instructions | S0 | Unsigned immutable payload implemented; release qualification pending |
| M1 | Durable service, admission, journal, events, logs, cancellation and recovery foundation | M0 | Implemented foundation with fixtures; hardening ongoing |
| M2 | First useful explicit push workflow, exact preview scope, one gate, observed delivery | M1 | Generic real Git fixtures passing |
| M3 | GitHub/PR observation, information design, logs and notifications | M2 | Observation and native client implemented; qualification ongoing |
| M4 | Shared mechanics extracted with repository-specific policy and migration parity | M1–M3 foundations | Local adoption, checks and captured landing have fixture proof; complete cross-host cutover remains in progress |
| M5 | Durable two-Mac enrollment, bootstrap, handoff, authority cutover and safe mirrors | M4 and real host access | Generic protocol fixtures passing; adopted/live proof pending |
| M6 | Signed packaging, safe updates, lifecycle and complete core qualification | Core behavior and release credentials | Maintenance, immutable payload and signed-release tooling implemented; actual signed release and update proof pending |

M2 should use a generic disposable fixture before migrating real repositories. M4 begins with reporting parity, then extraction, then one-repository-at-a-time adoption. Neither these milestones nor repository setup authorizes GitHub publication or changing unrelated live project configuration.

## Remote Devices

| Phase | Outcome | Dependency and timing | Status |
|---|---|---|---|
| D0 | Observed inventory, ownership, independently approved trust/signing, backend/license/privilege review and actual travel caller | Read-only setup inventory begins in S0; complete alongside M0 | Local read-only toolchain recorded; peer/phone/trust/signing/caller unknown |
| D1 | Bounded native baseline, remote Wi-Fi, warm cellular, fresh cellular and restart experiments | Start as soon as M1 provides journal, authorization and scoped dispatch; do not wait for M4/M5 | Unverified |
| D2 | Offline preparation, immutable artifact transfer, verified in-place installation and meaningful data continuity on each Mac | M1/M2 plus relevant project adapter parity and qualified route | Unverified |
| D3 | Independently qualified launch, logs, native tests, UI interaction and debugging | D2 and per-operation backend proof | Unverified |
| D4 | Two-host ownership, uncertainty, recovery, revocation, compatibility, retention and release proof | D2/D3 coordinated with M6 | Unverified |

D1 starts with at most three connection attempts per recorded case under a finite deadline. The package's initial investigation budget is two focused engineering days plus one assisted session up to 90 minutes, adjusted before testing to owner availability. A new experiment needs a distinct hypothesis. This budget applies to future authorized investigation, not an instruction to wait or experiment during setup.

AT-08, AT-09 and AT-10 remain open until fresh cellular and restart evidence exists. An experiment that correctly reports a blocker may verify error handling while leaving the intended remote capability unresolved. OTA fallback never silently closes the direct developer-session target.

## Completion and continuation

Track each original case in [the acceptance ledger](verification/acceptance-status.json). Add evidence per context; do not replace the overall case with one success from a different host or operation. Track core release, enabled capability availability, and full remote-target completion separately.

The [acceptance hardening review](ACCEPTANCE_HARDENING.md) adds AT-R01–05 to the existing plan: 59 core and 24 device cases now remain tracked. Implement these with M2/M3 or M4/M5 as assigned, reusing existing scenarios for already-covered checks. S0 and approved product scope are unchanged.

Missing hardware, signing, unlock/trust prompts, or network switching blocks only dependent proof. Continue authorized independent work. Preserve every unresolved requirement with its blocker, next decisive proof, and relevant IDs. See [VERIFICATION.md](VERIFICATION.md) for the current access matrix and later evidence standard.

## Resource lifecycle extension

The [resource lifecycle amendment](requirements/09-RESOURCE_LIFECYCLE.md) adds R1–R12/AT-LC01–21. Source work follows durable process/Simulator ownership; repository/session admission; independent Git recovery; persistent services/cross-host/limits; disposable actual-host qualification; incremental adoption. [RESOURCE_LIFECYCLE.md](RESOURCE_LIFECYCLE.md) owns current implementation and limitations. Actual installation and live enrollment remain deferred. Existing retention and device/writer qualifications remain open until independently proved.

The resource lifecycle deferred owners and remaining case variants are explicit in [the current gap matrix](RESOURCE_LIFECYCLE.md#current-requirement-gap-matrix). Adoption/installation/platform/peer owners must qualify live bridges and legacy registration receipt adoption before expansion; Git owners must qualify partial/promisor and large topology recovery. No source fixture closes these owners.

Connectivity and host-resource repairs are implemented in the shared engine. [Current status](IMPLEMENTATION_STATUS.md), [connectivity qualification](CONNECTIVITY.md#migration-and-qualification) and [verification](VERIFICATION.md) distinguish source/fixtures from intended two-Mac/VPN and installed-service acceptance.
