# Contribution documentation

The S0 development foundation is recorded in [SETUP_STATUS.md](SETUP_STATUS.md). Use [BUILD.md](BUILD.md) for setup and verification commands. [REPOSITORY_SETUP.md](REPOSITORY_SETUP.md) and [SETUP_PROMPT.md](SETUP_PROMPT.md) retain the scope of that assignment. All M0–M6 and D0–D4 phases are now authorized and under implementation. See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for the current code and proof, and [PEER_PROTOCOL.md](PEER_PROTOCOL.md) for the two-host boundary. Live installation, project enrollment and hardware setup are deferred to the final handoff.

## Reading order

| Document | Purpose |
|---|---|
| [Vision](VISION.md) | Intended user outcome and product boundaries |
| [Architecture](ARCHITECTURE.md) | Component ownership and selected foundation |
| [Requirements review](REQUIREMENTS_REVIEW.md) | Resolved gaps, clarifications, and remaining evidence |
| [Repository setup](REPOSITORY_SETUP.md) | Exact scope and exit criteria for the next chat |
| [Roadmap](ROADMAP.md) | S0, core milestones, device track, and dependencies |
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
| [05 Implementation plan](requirements/05-IMPLEMENTATION_PLAN.md) | Later M0–M6 and D0–D4 implementation assignment |
| [06 Acceptance tests](requirements/06-ACCEPTANCE_TESTS.md) | All 54 original core cases plus five robustness additions |
| [07 Sources and decisions](requirements/07-SOURCES_AND_DECISIONS.md) | Technical sources and settled boundaries |
| [08 Remote iPhone development](requirements/08-REMOTE_IPHONE_DEVELOPMENT.md) | All 40 RDEV requirements, their crosswalk, and 24 physical cases |
| [Schemas](../packages/contracts/schemas/README.md) and [examples](../packages/contracts/examples/README.md) | Twelve initial schemas and fourteen synthetic examples |

## Authority and maintenance

Current user instructions and applicable repository policies govern the task. The S0-only boundary describes the completed historical setup assignment. The dated [review amendments](REQUIREMENTS_REVIEW.md) clarify the detailed requirements; everything else in the baseline remains in force. Overview documents summarize the detailed documents and do not redefine their commands or wire states.

Schema validity proves data shape, not authorization, cross-record consistency, or device support. Keep semantics, schemas, examples, tests, and affected docs aligned when changing a contract. Record intentional behavioral departures with their reason and acceptance impact. Do not silently delete requirements to match a partial implementation.

S0 moved the twelve schema and fourteen example JSON files into `packages/contracts` as the single maintained source. Runtime validation, generated TypeScript types, and checked Swift projection coverage are described in the [contract package](../packages/contracts/README.md). There is no second editable schema/example copy under `docs`.

Private audit evidence is dated background, not current code or executable instructions. See [SOURCE_PACKAGE.md](SOURCE_PACKAGE.md). Never copy the whole input archive into the repository.
