# Configuration and interface examples

These examples describe the application Codex will implement. They do not configure this computer or claim that the Contribution commands are already installed.

| File | Interpretation |
|---|---|
| [repository.json](repository.json) | A new lightweight project on `dev`, with no GitHub destination or invented validation commands |
| [machine.json](machine.json) | Private companion configuration with a paired Mini and local project-path mapping |
| [accepted-submission.json](accepted-submission.json) | Source retained locally and queued, with no false claim of Mini acceptance |
| [repository-status.json](repository-status.json) | Canonical history is freshly known to be ahead of the destination, with separate pending landing work |
| [run-event.json](run-event.json) | A stable event announcing durable Mini acceptance, distinct from landing or publication |
| [push-preview.json](push-preview.json) | Opaque scope token and readable publication snapshot, with no check execution |
| [submission-metadata.json](submission-metadata.json) | An explicit combined integration message, captured with the immutable source |
| [device-status.json](device-status.json) | Unverified cold-cellular installation and blocked prior ownership, with the selected Pro separate from the canonical Mini |
| [device-capability.json](device-capability.json) | Explicitly unqualified operation context with unknown actual versions |
| [device-ownership.json](device-ownership.json) | Lease expiry with an unconfirmed former owner, which does not permit takeover |
| [artifact-provenance.json](artifact-provenance.json) | Simulated signed build metadata from one host that can be verified on another, without private signing keys |
| [device-operation.json](device-operation.json) | Simulated confirmed installation and separate launch failure, retained as a failed composite operation |
| [device-operation-uncertain.json](device-operation-uncertain.json) | A simulated bounded AT-08 qualification intent with a lost install reply requiring device readback before retry |
| [device-test-evidence.json](device-test-evidence.json) | An unrun AT-08 cold-cellular proof plan with no acceptance claims |

The UUIDs, commit IDs, paths, dates, and event IDs are illustrative. Generate real identities and use observed Git object IDs in the implementation. Configuration and status files show different lifecycle moments and are independent fixtures, not a single live repository snapshot.

The repository example deliberately contains no broad check command and uses only its declared generic safety checks. It does not reconfigure Mathy, Main Character, Roboty, or Glass Alpha. Existing repositories use the migrated adapters and effective policy described in [04-REPOSITORY_MIGRATION.md](../../../docs/requirements/04-REPOSITORY_MIGRATION.md).

`result.acceptance` in the accepted-submission fixture identifies the boundary that has actually been crossed. In the event fixture, Mini acceptance means the receiver retained the request and source durably. Neither fixture says that source has landed or reached GitHub.

The status example offers Push only for the displayed canonical state. Actual execution first obtains a preview scope token and submits that token with the expected canonical tip, as specified in [03-AGENT_CONTRACT.md](../../../docs/requirements/03-AGENT_CONTRACT.md). Cached status by itself is not publication authority.

The preview token is illustrative and cannot authorize a real operation. Real tokens are issued by the service and validated against the current repository, source, destination, and policy. The metadata example supplies an intentional message for an adapter that requires it. The engine must not guess missing required candidate metadata.

All new device examples have `recordMode: fixture`. They are independent non-live scenarios. They are not a shared live timeline, real host-release receipts, installable artifacts, or evidence that a backend worked. In particular, the successful install effect is a simulated result shape. The AT-08 record remains `not_run`, with no asserted versions, observations, claims, or device-side proof. Its unknown values must be replaced by observed inventory during D0/D1, not guessed from a historical checkout.

The fixture app and team are deliberately fictitious. They do not change Roboty's identity or authorize its installation. App update/data-migration authority remains with each project adapter. No example includes private signing/pairing material or a claimed phone-side artifact digest.

The new fixtures map to the same-named schemas, except that both device-operation JSON files use `device-operation.schema.json`. Old submission/preview fixtures continue to use `response.schema.json`. `run-event.json` uses `event.schema.json`, and `repository-status.json` uses `status.schema.json`. Resolve all schema URNs locally when validating them.
