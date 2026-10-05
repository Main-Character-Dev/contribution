# Acceptance coverage audit

Reviewed 2026-10-04 after the initial requirements review. This is acceptance hardening for future implementation, not new product scope or a request to extend S0. The existing architecture, agent contract, migration rules and all original acceptance rows remain unchanged.

Ten of the fifteen requested areas are already substantively covered. Five need focused additional proof. Their canonical definitions are AT-R01–05 in [06 Acceptance tests](requirements/06-ACCEPTANCE_TESTS.md#r-focused-robustness-additions); this document maps coverage without maintaining a second test definition.

| Requested robustness check | Existing coverage and assessment | Action |
|---|---|---|
| Unborn repository / no commits | AT-H07 explicitly separates enrollment from authorized initialization; AT-M04 covers setup/repair | Reuse existing cases |
| No GitHub remote | AT-P01 covers no destination/upstream and an actionable configuration state; AT-E04 establishes standalone operation | Reuse existing cases; use a repository with no remotes for the no-destination variant |
| First committed history handoff to Mini | AT-H07 covers empty-target seeding, interruption/retry and preservation of pre-existing target history | Reuse existing case |
| Detached-HEAD task completion | AT-M04 only requires an explicit detached-checkout setup/repair outcome; it does not prove successful task submission | Add AT-R01 |
| Dirty task checkout preserving unrelated work | AT-M02 protects a primary mirror, AT-V06 protects selected check inputs, and AT-H07 protects initialization; none exercises dirty task submission through completion | Add AT-R02 |
| Divergent committed histories | AT-M03 explicitly exercises unique commits on both primaries, locally ahead and unrelated histories | Reuse existing case |
| Shallow history, submodules and Git LFS | Architecture requires verified bundle prerequisites and explicit external-content limitations, but no original acceptance row explicitly exercises these inputs | Add one parameterized case, AT-R03; unsupported remains an acceptable declared boundary |
| Owner unavailable or loss during handoff | AT-H02–04 cover independence after acceptance, interrupted transfer/acknowledgment and offline queues without owner election | Reuse existing cases |
| Interrupted push with uncertain remote delivery | AT-P06 covers accepted/not-accepted remote outcomes; AT-P07 covers transport cancellation; AT-U05 covers worker restart | Reuse those cases with worker interruption after dispatch and before the final result is persisted, then restart/reconcile |
| Queued publication scope changes | AT-P03 covers changing tip while queued; AT-P11 binds branch/destination/policy and waiting/retry semantics; AT-A05 preserves accepted scope | Reuse the existing scope tests, including changes after durable admission but before execution, not only stale preview submission |
| Concurrent push attempts and immutable attempt logs | AT-O01 explicitly protects the first attempt from a competing lock-rejected attempt; AT-H06 provides serialization | Reuse AT-O01 with two actual push requests. Logs append while active; prior output, request identity and finalized evidence cannot be overwritten by another attempt |
| Inactive gates stay visibly inactive | AT-V01/05 and AT-P10 cover inactive policy and a separate ownership guard | Reuse existing cases |
| GitHub auth, permission, API and rate-limit errors | AT-P05 covers pre-hook/transport failures; AT-G01/03/06 cover stale/unknown rules and bounded polling, but do not inject this error matrix | Add AT-R04 |
| Canonical-owner reconfiguration and split-brain prevention | AT-A05 and AT-P10 cover settings and post-cutover refusal; migration specifies the transition but interruption/partition during it is not explicitly tested | Add AT-R05 |
| Update/restart and in-flight jobs | AT-U02–05 preserve queues, versions, migrations and restart state; AT-H05 and AT-P06 reconcile landed/delivered effects | Reuse existing cases |

The listed variants make existing scenarios concrete; they are not extra duplicate test IDs. Reuse fixtures and public-boundary assertions when writing executable tests. Dirty task behavior remains adapter-specific, and unsupported repository features must never be silently treated as supported.

## Requirement ownership and sequencing

- AT-R01–03: PRD-WORK-001–005, repository identity and immutable submission in the agent contract, and architecture sections 6–8. Implement with M4/M5 source capture, adapters and transfer.
- AT-R04: PRD-PUSH-002/004, GitHub observation/readiness requirements and architecture sections 10–13. Implement with M2/M3 push/status and remote observation.
- AT-R05: PRD-MODEL-002, the agent contract's idle/reconciled configuration boundary, and the migration guide's explicit authority cutover. Implement and qualify with M5.

The maintained plan now has **59 core cases (54 original + 5 robustness additions) and 24 device cases, 83 total**. The original 78 rows and all 40 RDEV statements are preserved. New cases are `not_started` / `not_run` in the [acceptance ledger](verification/acceptance-status.json). Documentation coverage is not executed test evidence.

The setup chat can continue the existing S0 prompt unchanged. Read this addendum before implementing acceptance fixtures or the owning milestones. No live GitHub, peer, signing, phone, or installed-service work was performed by this coverage review.
