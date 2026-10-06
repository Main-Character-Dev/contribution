# Requirements review and amendments

Review date: 2026-10-04, America/New_York. Input: Contribution implementation package revision 2. The review found the core architecture coherent and the device scope appropriately evidence-dependent. It is ready for repository setup. It is not a verified implementation or a guarantee of fresh cellular iPhone development.

The primary checkout and this task's initial worktree were clean at commit `4a23aaebfbf51dbf33eba30b479a0a8fea4c76ca`. The primary branch was `main`; the task checkout was detached. Only `README.md` and `LICENSE` were tracked. There was no prior application implementation to reconcile. The existing MIT license was retained unchanged.

## Adopted amendments

These clarify or add to the baseline. All 63 PRD IDs, all 40 original RDEV requirements, and the original 54 core plus 24 device cases remain retained. Wire schemas are unchanged in this review.

| ID | Gap or issue | Applied requirement | Verification |
|---|---|---|---|
| REV-01 | The supplied starter immediately authorizes the whole implementation, contrary to the requested next step | Add S0 with explicit deliverables and a stop boundary before application operations, migration or physical experiments | S0 exit report distinguishes completed setup from M0–M6/D0–D4 |
| REV-02 | Toolchain, native project form, test entry points and minimum app OS were unspecified | Use the foundation in [ARCHITECTURE.md](ARCHITECTURE.md), record exact compatible pins during setup, and keep project runtime pins separate | A clean local checkout builds the native shell and JS packages with recorded commands |
| REV-03 | Copying the package wholesale would include private evidence; the migration document itself is private maintainer context | Import only reviewed requirements/contracts; rewrite migration and source guidance, remove private evidence links and host paths, preserve raw inputs externally | Verify imports and release allowlists; no raw audit, signing, pairing or live diagnostic content in Git |
| REV-04 | Package checks could be mistaken for application progress | Maintain an explicit acceptance ledger with every case initially `not_run`; separate implementation state, fixture proof, Mac proof, two-Mac proof and device evidence | No setup/schema test marks an application or physical case passed |
| REV-05 | Generic cross-language type generation may miss draft 2020-12 conditionals and cross-record semantics | JSON Schema remains canonical. Validate runtime data using the full supported schema dialect. Generate types where faithful; otherwise use narrow checked projections with fixture parity and documented coverage. Unsupported constructs must fail explicitly | Positive and negative fixtures; no manually drifting enums or permissive fallback. Semantic guards are separately tested during implementation |
| REV-06 | A privileged backend quick-start could accidentally become an extra daemon or root app | go-ios remains a prototype candidate. Pin and inspect the actual transport/privilege path before bundling; no backend installation or automatic tunnel during S0 | D0 dependency record and D1 route proof; preserve native sessions |
| REV-07 | “Supported on cellular” could overstate a partial result, or a case's correct error report could close the desired capability | Store operation-specific and host/version/network evidence. Correct failure handling does not satisfy RDEV-19. Warm continuation, fresh establishment, phone restart and host restart remain separate | AT-06 and AT-08–10 records cannot substitute for each other |
| REV-08 | Mutation idempotency is required in prose but not explicit in every command synopsis | Before implementing each mutating entry point, specify its immutable request fields and retry behavior. Every effectful device request uses a request ID; CLI flags and UI-generated IDs follow one contract. Read-only observation never dispatches a mutation | Contract tests for changed-input conflicts, duplicate requests, cancellation and uncertain effects |
| REV-09 | Setup could incorrectly depend on release signing or possession of both hosts and a phone | Support a local development build without Developer ID, notarization, service registration or phone access. Do not advertise installed-service or release support from it | Build evidence is labeled development only; missing external prerequisites stay recorded |
| REV-10 | Phone-only initiation could be overlooked by testing only from the home Mac | D0 must resolve the actual travel caller. If no supported remote agent route exists, retain the narrow same-service authenticated browser surface for RDEV-26 | D2 demonstrates initiation from the intended travel setup |
| REV-11 | Existing MIT code ownership could be overwritten with a newly generated license | Keep the current license text and holder. Preserve third-party notices and source provenance on later extraction | License unchanged; dependency provenance reviewed before release |
| REV-12 | A new chat opened on primary might not see documentation written in a detached task checkout | The setup prompt requires locating this documentation baseline, reconciling it into the chosen checkout without overwriting other work, then using that checkout consistently | Setup reports the actual checkout, branch, base SHA and documentation revision |
| REV-13 | A default native app template may enable an incompatible sandbox/distribution model | Use direct macOS distribution, App Sandbox disabled, standard user permissions, and separately qualified hardened-runtime release settings. Do not request broad disk access or run as root during setup | Native target configuration documents permissions; later adapters diagnose actual access failures without weakening system protection |

## Evidence-backed conclusions and limits

The app/service/CLI split supports the requested native and agent interfaces without duplicating workflow logic. Git bundles are a suitable committed-object transport; they do not carry unfinished working directories. SQLite WAL requires local-host storage. Neither architectural choice proves crash recovery until integration tests exercise the actual boundaries. See the [Git bundle](https://git-scm.com/docs/git-bundle) and [SQLite WAL](https://www.sqlite.org/wal.html) documentation.

The [go-ios upstream README](https://github.com/danielpaulus/go-ios) exposes useful operation candidates, but includes privileged tunnel setup and does not establish Contribution's fresh cellular acceptance. The upstream [Tailscale mDNS issue](https://github.com/tailscale/tailscale/issues/1013) remains open; IP reachability must not be treated as Apple service discovery or trust. These support retaining D1 as an early investigation, not declaring success or impossibility.

Apple documentation pages were reachable but their full JavaScript-rendered content was not retrieved by the review browser. The package's specific newer Xcode pairing claims remain reference claims to check against installed Apple documentation during D0. No minimum iPhone OS, target phone state, installed Xcode version, or cross-network support is inferred from them.

Exact pinned dependencies, Swift schema projection coverage, SQLite binding, final installation identity, release credentials, and actual peer/device inventory remain setup or implementation records. They are explicit decision points with owners and exit evidence, not omissions to fill with invented values.

## Review checks

Archive integrity, contract results, preservation counts and link checks are recorded in [VERIFICATION.md](VERIFICATION.md). This review does not certify the historical private audit as current, claim all external references were reverified, or change any other repository's policy.

## October 6 resource lifecycle amendment

The owner authorized the [durable resource lifecycle plan](requirements/09-RESOURCE_LIFECYCLE.md). It adds positive resource ownership, explicit lifetimes, bounded teardown and recovery while preserving original requirements and the original 83 acceptance identities. Source and fixture proof remain separate from installed/physical qualification.

## October 6 connectivity amendment

[VPN-01–11](requirements/10-VPN_CONNECTIVITY.md) clarify PRD-SETUP-002 and architecture section 5: ordinary configured SSH is the generic peer transport; Tailscale is an optional configured network. PRD-MODEL-002, PRD-WORK-004 and the separate Remote Devices qualification remain in force. The byte-checked baseline is retained.
