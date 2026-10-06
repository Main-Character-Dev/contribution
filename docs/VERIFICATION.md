# Verification and outstanding access

Current status: **M0–M6 and D0–D4 implementation is in progress, with partial executable fixture and native-build evidence. No full application, two-Mac, signed-release or physical-device acceptance is claimed.** [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) records current proof and remaining implementation. [SETUP_STATUS.md](SETUP_STATUS.md) is the historical S0 record.

The [acceptance ledger](verification/acceptance-status.json) retains all 59 core and 24 device cases. It now links implemented subsets to focused proof sources and names missing work. Core `partial_fixture` means only the described subset passed fixtures; physical-device rows remain `not_run` even when shared guards have fixture proof. The original requirements, 83 identities and source mappings are unchanged. Foundation checks now validate those identities and evidence boundaries instead of forcing a permanently unstarted planning ledger.

## S0 development evidence

The [S0 record](verification/s0-setup.json) covers frozen setup, strict package build, generation drift, 31 public-boundary/contract tests, 12 schemas, 14 examples, 23 negative shapes, URI/UUID/date-time formats, Swift envelope parity, shared app/CLI version, unsigned native bundle inspection and a bounded launch process smoke. All independent checks also passed from a clean source snapshot. Visual window/menu inspection remains pending without new privacy permissions. No application case was marked passed.

The concurrent [acceptance hardening review](ACCEPTANCE_HARDENING.md) is preserved: 54 original core plus five robustness additions and 24 device cases, 83 total, all unrun. The source/package review below still describes its original 78-case snapshot.

The [S0 projection repair record](verification/s0-projection-repair.json) separately checks required ordinary nested fields, enums, nullability, arrays and structural `allOf` in generated TypeScript. The initial 31 runtime/boundary tests did not detect this static projection loss. Compilation still does not validate conditional relationships or authorize device operations. Schema/example bytes, Swift/version outputs and every unrun application case remain unchanged.

## Review evidence

| Check | Result |
|---|---|
| Repository reconciliation | Initial worktree and primary clean at `4a23aaebfbf51dbf33eba30b479a0a8fea4c76ca`; only README and MIT license tracked |
| Archive integrity | All 798 manifest entries matched size and SHA-256 |
| Schema validity | All 12 draft 2020-12 schemas passed schema checking |
| Example validation | All 14 JSON examples passed with format checking and local URN resolution |
| Negative contract checks | 12 invalid cases rejected, including unsupported support claims, unsafe takeover, missing readback, composite false success and fixture physical-pass claims |
| Requirements preservation | All 63 PRD IDs retained; all 40 RDEV statements and 54 core/24 remote acceptance rows match the original text |
| JSON preservation | Imported schema/example JSON is byte-identical to the source package |
| Documentation | Relative file links and referenced headings checked; private reference links replaced with an external-source locator |
| Privacy | Raw archive, original private migration context, audit, credentials and real device evidence not imported |
| Product proof | None; no service, repository migration, device backend, signing or physical operation was run |

Validation used an isolated temporary Python environment with `jsonschema 4.25.1`, `Draft202012Validator`, `FormatChecker` and a local schema registry. It did not install a repository runtime or test harness. The [machine-readable review record](verification/requirements-review.json) names the checks. These results do not independently reproduce every check claimed by the source package's original check report.

The [acceptance ledger](verification/acceptance-status.json) contains every original case, initially `not_started` / `not_run`. Its relative source fields are resolved from `docs/`. Definitions remain in the [core matrix](requirements/06-ACCEPTANCE_TESTS.md) and [remote matrix](requirements/08-REMOTE_IPHONE_DEVELOPMENT.md); the ledger does not duplicate their wording.

## Evidence levels

Track implementation state separately from observed results. Record fixture verification, one-Mac verification, actual two-Mac verification, and operation-specific physical-device qualification independently. A development build is not signed-release evidence. A passing recovery/error-reporting assertion does not establish a missing transport capability.

Each later run records case, date, exact source/build, environment, tool versions, executed steps, result, missing proof, and private evidence references. Device proof additionally records approved host/phone identity, backend revision, signing mode, actual network underlay/route, prior-session state, installed readback, required user actions and retention checks. Public records use sanitized identities and summaries. Do not put raw captures, pairing records or signing secrets into this ledger.

Use the original device-test-evidence schema for actual device records. This initial planning ledger deliberately does not claim to satisfy that schema or establish support. A case can accumulate several runs for different hosts, operations and contexts; one favorable run does not replace failed/unrun combinations.

## Access needed later

| Required access | Acceptance/proof it enables | Current state |
|---|---|---|
| Local macOS/Xcode GUI session | Native app launch, VoiceOver/keyboard/menu bar, registration, notifications, local lifecycle and update qualification; notably AT-A01, AT-O02–04, AT-U01–05 | Not exercised; S0 will record available local tooling and development-shell build |
| Both actual Macs, approved SSH/Tailscale and user sessions | Durable acceptance independent of laptop/UI, offline recovery, safe mirrors, authority cutover and compatible updates; especially AT-H01–08, AT-M01–04, AT-P10 and AT-U03 | Not inventoried or exercised |
| Explicit controlled GitHub destination and credential access | Actual publication delivery, remote checks, PR rules, notifications and external activity; AT-P and AT-G cases plus applicable AT-H02/AT-E04 | Fixture routes can be built independently; live publication not performed or authorized by setup |
| Developer ID/notarization/update signing and release configuration | Distributable app and every enabled updater path, AT-U01–04 and M6 | Not inspected; unnecessary for S0 local development builds |
| Approved iPhone and independent host pairing/signing | Device baseline, artifact/install/readback, identity denials and data continuity; AT-01, AT-12–17, AT-24 | No inventory or physical evidence |
| Owner network changes, trust/unlock prompts and restart participation | Remote/guest/tethered routes, warm versus fresh cellular and restart recovery; AT-02–10, AT-21 | Unrun; plan one bounded assisted D1 session after prerequisites |
| Approved meaningful test app/data, logs/test runner and debugger authority | Persistence and Keychain checks, uncertain effects, tests/UI/logs/debug cleanup; AT-11, AT-16–19 | Unrun; no valuable product data changed |
| Both device hosts and lifecycle/revocation interaction | Explicit transfer, competing sessions, sleep/background changes and revocation; AT-14–15, AT-22–24 | Unrun; expiry alone never permits takeover |
| Approved OTA signing/export and private endpoint, if selected | System-installer access, required taps, installed confirmation and data continuity; AT-20 plus AT-23 | Conditional candidate, not activated; does not close AT-08–10 developer-session scope |
| Actual phone-only travel caller | End-to-end remote initiation for RDEV-26/AT-04 and applicable OTA case | Supported agent route or same-service private browser route must be resolved in D0 |

These are qualification dependencies, not evidence of an access denial. Exact hosts, versions and commands will be known only when the corresponding implementation and inventory exist. The setup chat must report specific unavailable prerequisites without inventing executable product commands.

## Setup and later completion

S0 completion is governed by [REPOSITORY_SETUP.md](REPOSITORY_SETUP.md). Thereafter, attach actual proof to the owning milestone and acceptance cases. Mark unavailable or skipped work accurately, preserve the next experiment, and keep core-release status separate from full Remote Devices completion. No physical claim can be satisfied by a schema fixture, mocked screenshot, tailnet ping, upload, or process exit alone.

## Resource lifecycle evidence

The [implementation receipt](RESOURCE_LIFECYCLE_RECEIPT.md) records the final 384-test source checkpoint, 24 Swift tests, unsigned app build and preserved evidence location.

The original 83 acceptance definitions remain preserved. [The additive lifecycle matrix](requirements/09-RESOURCE_LIFECYCLE.md) has 21 stable cases in the shared ledger. Process/Simulator fixtures and real disposable subprocesses establish only the recorded subset. Installation, exact-device data continuity, native Codex, actual two-host admission and sleep/reboot still need separate evidence. A resource receipt distinguishes workflow completion from confirmed release; uncertain cleanup cannot qualify unattended use.

The cumulative root Node fixture harness now declares four concurrent file workers. Unbounded simultaneous Git/IPC/process fixtures exceeded ten-second fixture observation deadlines under the stronger lifecycle census. This is the existing test harness capacity, not a project validation or Simulator-slot policy. Process exit also allows the ordinary stdio-close event to settle before another census; dependent cleanup remains bounded and exact. A delayed private-pipe grant is tested explicitly.
