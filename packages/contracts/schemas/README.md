# Contract schemas

These are JSON Schema draft 2020-12 definitions for the proposed version-one interface. They are local implementation inputs, not live endpoints at contribution.dev. Their `urn:contribution:schema:*:v1` identifiers resolve within this package.

| Schema | Validates |
|---|---|
| [storage-policy.schema.json](storage-policy.schema.json) | Private managed-data cap, separate from the original raw-log policy |
| [device-profile.schema.json](device-profile.schema.json) | Private project app identity and explicit offline Xcode build configurations |
| [repository.schema.json](repository.schema.json) | Tracked repository configuration |
| [machine.schema.json](machine.schema.json) | Private host configuration |
| [response.schema.json](response.schema.json) | Nonstreaming CLI and service response envelope |
| [status.schema.json](status.schema.json) | Completed single-repository status response |
| [event.schema.json](event.schema.json) | Durable event stream record |
| [submission-metadata.schema.json](submission-metadata.schema.json) | Explicit candidate message metadata captured with a task submission |
| [device-status.schema.json](device-status.schema.json) | Completed per-device status with current readiness and qualified operation support |
| [device-capability.schema.json](device-capability.schema.json) | One operation's support in an explicit backend/toolchain/device/network context |
| [device-operation.schema.json](device-operation.schema.json) | Private retained device receipt with independent effects and reconciliation |
| [artifact-provenance.schema.json](artifact-provenance.schema.json) | Verified signed artifact and exact build provenance, separate from device readback |
| [device-ownership.schema.json](device-ownership.schema.json) | Per-device owner, transfer/release evidence, and permission to start conflicting mutations |
| [device-test-evidence.schema.json](device-test-evidence.schema.json) | Original AT-01 through AT-24 physical-case evidence or an explicitly unrun plan |

The repository and machine configuration schemas reject unknown keys so misspelled policy fields do not silently disappear. Evolve the schema and code together when adding a supported field. Response results and event payloads allow documented additive data, while stable envelope fields keep their defined meaning.

The implementation must perform semantic validation as well as schema validation. Examples include actual Git ref validity, selected repository association, unique check IDs, supported built-in and adapter IDs, configured executable availability, safe relative check directories, role-to-owner consistency, real absolute host paths, permitted authority transitions, and status relationships consistent with their counts. Schema validity is not evidence that a command may execute or a repository is enrolled.

Check command arguments are arrays. The engine executes them directly and never interprets a string as shell code. Paths and received task content are data. An explicitly configured shell command can exist only through a deliberate repository check definition and its normal trust boundary.

Version one includes the generic built-in IDs `clean-primary`, `source-ownership`, `safe-ref-update`, and `outgoing-secrets`. Their exact selected phase and enforcement are defined by the adapter, with applicability reported separately from pass/fail. `outgoing-secrets` requires a configured scanner and current input/rule identity. Selecting it without an available implementation is unavailable or a configuration error, never an implicit pass. An unrecognized built-in or adapter fails configuration. Existing repository adapters preserve their more specific policies and scan semantics.

Resolve all fourteen schemas in one local registry. `device-capability.schema.json` also defines the shared context and network shapes referenced by the other device schemas. Validate the JSON examples through these definitions and test the behavioral contracts through the public service and CLI. [original package checks](../../../docs/SOURCE_PACKAGE.md) records validation performed while assembling this handoff and is not an application test result.

The original Git envelope, repository status, event, tracked repository, and submission-metadata schemas retain their existing meanings. Machine configuration adds only the optional `remoteDevices` object, whose two settings default to false. Existing configuration examples remain valid. Device details are additional contracts and do not add a new Git operation state or change canonical host ownership.

Device records distinguish `recordMode: fixture` from `observed`. Production code must reject fixtures as authority, usable artifacts, host release receipts, or physical support evidence. A test fixture cannot pass a physical acceptance case. The evidence schema explicitly prevents a fixture from claiming `outcome: passed`. Example preparation/signing flags and example readbacks are simulated contract data, not facts about any app or phone.

Semantic checks must also establish identity agreement across references, current grants, permitted ownership transitions, compatible context/evidence reuse, exact installed-state verification, and effect/result consistency. A callable status requires the applicable qualified capability and readiness. `leaseExpiresAt` never authorizes takeover. Confirmed install plus failed launch remains a failed composite operation with separate effect records. A lost effect stays uncertain until qualified observation resolves it.

Routine and qualification intents are explicit in device receipts. A routine request cannot carry qualification metadata. A qualification request requires a registered plan, original AT case, approved fixture, expected-context digest, permitted operations, and bounded attempt/duration budget. This permits first physical proof on an unverified context without a general bypass flag. It retains all independent trust, identity, signing, ownership, and recovery guards.

Artifact SHA-256 records verify prepared/transferred bytes. Device readback contains only observed phone values and deliberately has no artifact-hash field. Paired-device secrets, signing private keys, bearer tokens, or raw diagnostic contents do not belong in these records. Detailed evidence references resolve only through the private retained store.

The thirteen-schema census adds the private project device profile to the twelve unchanged source-package schemas. This registration describes host build inputs and eligible opaque devices; it grants no phone operation, signing-key access, ownership or physical capability.
