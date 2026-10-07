# Contribution documentation

The S0 development foundation is recorded in [SETUP_STATUS.md](SETUP_STATUS.md). Use [BUILD.md](BUILD.md) for setup and verification commands. [REPOSITORY_SETUP.md](REPOSITORY_SETUP.md) and [SETUP_PROMPT.md](SETUP_PROMPT.md) retain the scope of that assignment. All M0–M6 and D0–D4 phases are now authorized with implemented foundations and incomplete qualification. See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for the current code and proof, and [PEER_PROTOCOL.md](PEER_PROTOCOL.md) for the two-host boundary. Live installation, project enrollment and hardware setup are deferred to the final handoff.

## Reading order

| Document | Purpose |
|---|---|
| [Vision](VISION.md) | Intended user outcome and product boundaries |
| [Architecture](ARCHITECTURE.md) | Component ownership and selected foundation |
| [Requirements review](REQUIREMENTS_REVIEW.md) | Resolved gaps, clarifications, and remaining evidence |
| [Current implementation](IMPLEMENTATION_STATUS.md) | Current capability/gap matrix and software proof |
| [Build](BUILD.md) | Pinned verification commands and payload tooling |
| [Interim agent workflow](INTERIM_AGENT_WORKFLOW.md) | Commit, local integration and native worktree ownership |
| [Roadmap](ROADMAP.md) | S0, core milestones, device track, and dependencies |
| [Diagnostic sharing](DIAGNOSTIC_SHARING.md) | Redacted summaries and controlled local details |
| [Power lifecycle](POWER_LIFECYCLE.md) | Explicit host preference and bounded idle-sleep requests |
| [Project settings](PROJECT_CONFIGURATION.md) | Reviewed configuration and preserved original policy |
| [Repository removal](REPOSITORY_REMOVAL.md) | Owned-hook removal, retained evidence and interrupted removal |
| [Verification](VERIFICATION.md) | Evidence levels and current incomplete cases |
| [Acceptance hardening](ACCEPTANCE_HARDENING.md) | Coverage of fifteen robustness checks and five focused additions |
| [Source package](SOURCE_PACKAGE.md) | Provenance and private-reference boundary |

## Detailed maintained requirements

| Document | Owns |
|---|---|
| [01 Product requirements](requirements/01-PRODUCT_REQUIREMENTS.md) | All 63 PRD requirements |
| [02 Architecture](requirements/02-ARCHITECTURE.md) | Execution, persistence, transport, recovery, and updates |
| [03 Agent contract](requirements/03-AGENT_CONTRACT.md) | Commands, states, responses, authorization, and configuration |
| [04 Repository migration](requirements/04-REPOSITORY_MIGRATION.md) | Sanitized policy-preservation and migration rules |
| [05 Implementation plan](requirements/05-IMPLEMENTATION_PLAN.md) | Baseline M0–M6 and D0–D4 requirements and dependencies |
| [06 Acceptance tests](requirements/06-ACCEPTANCE_TESTS.md) | All 54 original core cases plus five robustness additions |
| [07 Sources and decisions](requirements/07-SOURCES_AND_DECISIONS.md) | Technical sources and settled boundaries |
| [08 Remote iPhone development](requirements/08-REMOTE_IPHONE_DEVELOPMENT.md) | All 40 RDEV requirements, their crosswalk, and 24 physical cases |
| [Schemas](../packages/contracts/schemas/README.md) and [examples](../packages/contracts/examples/README.md) | Eighteen maintained schemas, including twelve preserved imports, and fourteen synthetic examples |

## Authority and maintenance

Current user instructions and applicable repository policies govern the task. The S0-only boundary describes the completed historical setup assignment. The dated [review amendments](REQUIREMENTS_REVIEW.md) clarify the detailed requirements; everything else in the baseline remains in force. Overview documents summarize the detailed documents and do not redefine their commands or wire states.

Schema validity proves data shape, not authorization, cross-record consistency, or device support. Keep semantics, schemas, examples, tests, and affected docs aligned when changing a contract. Record intentional behavioral departures with their reason and acceptance impact. Do not silently delete requirements to match a partial implementation.

S0 moved the twelve schema and fourteen example JSON files into `packages/contracts` as the single maintained source. Runtime validation, generated TypeScript types, and checked Swift projection coverage are described in the [contract package](../packages/contracts/README.md). There is no second editable schema/example copy under `docs`.

Private audit evidence is dated background, not current code or executable instructions. See [SOURCE_PACKAGE.md](SOURCE_PACKAGE.md). Never copy the whole input archive into the repository.

The [durable resource lifecycle amendment](requirements/09-RESOURCE_LIFECYCLE.md) owns R1–R12 and the additive AT-LC01–21 acceptance extension. [RESOURCE_LIFECYCLE.md](RESOURCE_LIFECYCLE.md) records implemented behavior and qualification gaps. The [implementation receipt](RESOURCE_LIFECYCLE_RECEIPT.md) records source identities, verification and rollout/rollback.

The [connectivity amendment](requirements/10-VPN_CONNECTIVITY.md) owns VPN-01–11 and AT-VPN01–28. [Connectivity](CONNECTIVITY.md) records shared transport/recovery behavior, troubleshooting and qualification.

## Current implementation and operator guides

Each guide owns a distinct boundary; linked requirements define behavior and dated verification receipts define proof. Current compatibility and rollback live only in Update lifecycle.

| Guide | Owner |
|---|---|
| [Adapter Seams](ADAPTER_SEAMS.md) | Original project policy and adapter parity |
| [Adopted Checks](ADOPTED_CHECKS.md) | Original check routing |
| [Adopted Landing](ADOPTED_LANDING.md) | Captured/native task landing and independent resume |
| [Adoption](ADOPTION.md) | Reviewed reversible policy cutover |
| [Connectivity](CONNECTIVITY.md) | Shared SSH/Git recovery, evidence and troubleshooting |
| [Device Execution](DEVICE_EXECUTION.md) | Device execution, grants, retained effects and qualification |
| [Diagnostic Sharing](DIAGNOSTIC_SHARING.md) | Allowlisted sharing and private details |
| [Github Observation](GITHUB_OBSERVATION.md) | Current-head GitHub checks and observations |
| [Go Ios Backend](GO_IOS_BACKEND.md) | Pinned candidate backend and physical gaps |
| [Legacy Writer Fence](LEGACY_AUTHORITY_FENCE.md) | Original writer fencing |
| [Lifecycle](LIFECYCLE.md) | Verified payload and native parent/worker lifecycle |
| [Native Activity](NATIVE_ACTIVITY.md) | Native activity and scope presentation |
| [Native Devices](NATIVE_DEVICES.md) | Native device controls and retained requests |
| [Notifications](NOTIFICATIONS.md) | Retained delivery claims and native permission |
| [Power Lifecycle](POWER_LIFECYCLE.md) | Bounded active-work sleep prevention |
| [Project Configuration](PROJECT_CONFIGURATION.md) | Reviewed configuration and owner preservation |
| [Project Registry](PROJECT_REGISTRY.md) | Paired catalog and explicit local mapping |
| [Repository Removal](REPOSITORY_REMOVAL.md) | Owned removal and retained evidence |
| [Resource Lifecycle](RESOURCE_LIFECYCLE.md) | Resource intent, grants and exact release |
| [Storage Retention](STORAGE_RETENTION.md) | Retention caps and reviewed cleanup |
| [Update Lifecycle](UPDATE_LIFECYCLE.md) | Current migration/rollback floor and final checkpoint |

## Historical and planning records

[Implementation checkpoints](IMPLEMENTATION_HISTORY.md) preserve the former chronological implementation and seam records. [S0 setup status](SETUP_STATUS.md), [setup deliverables](REPOSITORY_SETUP.md), [setup prompt](SETUP_PROMPT.md), [initial storage design](STORAGE_BOUNDARY.md), [D0 inventory](D0_INVENTORY.md), [acceptance hardening](ACCEPTANCE_HARDENING.md), and [resource receipt](RESOURCE_LIFECYCLE_RECEIPT.md) retain dated scope/proof. They are not current assignments or installed acceptance. The [iPhone fixture](../apps/ios-qualification/README.md) and [backend prototype](../backends/go-ios/README.md) retain their separate unqualified boundaries.

The original eight requirement files keep their baseline bytes and IDs. Use the [review authority crosswalk](REQUIREMENTS_REVIEW.md) for historical status overrides and the resource/connectivity amendments for additive behavior. Historical counts remain in dated receipts; current command/inventory references follow the maintained source.
