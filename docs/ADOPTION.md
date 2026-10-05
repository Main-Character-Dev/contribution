# Reversible project hook adoption

This is the initial publication-hook adoption path for the four inspected policy families. It does not enroll a repository, install Contribution, switch canonical ownership, commit project files or publish Git history. Live project enrollment and cutover remain deferred to the owner. Original landing/import adapters and complete project-specific parity remain separate work.

The existing dispatcher remains the owner: Mathy's trusted hook directory or Husky. The reviewed source guard calls the installed per-user Contribution CLI for an ordinary push and the verified payload CLI for a managed push. Both routes require the same authenticated service, canonical authority and compatible primary lease. The enabled original shell gate is retained privately and executed under the project runtime with its original arguments, stdin and logical script path. Glass Alpha gets the authority guard without a validator. Its gate remains inactive.

## Review, apply, commit, activate

After explicitly enrolling the correct primary, inspecting its current policy and configuring its intended publication destination/runtime:

```
contribution repos migration --repo ID --adapter ADAPTER --prepare-adoption --request-id UUID --json
contribution repos migration --repo ID --adoption-plan PLAN --json
```

Preparation is read-only for the project. It requires a clean committed primary and the matching pending adapter. It records HEAD, branch, configuration, authority, policy fingerprints, dispatcher/dependencies and private immutable before/after files. Changes are limited to the source pre-push guard, the verified lease-borrow bridge, required reporting overrides and `contribution.json`. Private original source and review snapshots stay outside Git and release payloads. Review these exact changes and their focused project parity before applying.

```
contribution repos migration --repo ID --apply-adoption PLAN --expected-revision REV --request-id UUID --json
```

Apply retains its intent, acquires the original compatible primary lease and landing-flight boundary, then atomically replaces only matching reviewed files. It does not stage or commit. A partial apply can resume using its retained request; mismatching source, temporary files or snapshots are preserved for reconciliation. Repository jobs/configuration remain blocked until activation or rollback. The newly installed source guard refuses publication while activation is pending.

Commit the reviewed paths through the project's existing author, commit and lifecycle policy. Do not include unrelated work in this migration range. Then:

```
contribution repos migration --repo ID --activate-adoption PLAN --expected-revision REV --request-id UUID --json
```

Activation requires a clean descendant commit, exactly the reviewed changed paths and bytes, expected executable modes, unchanged unmodified policy files, dispatcher, authority and private original gate. The repository policy, active hook registration and completion identity commit together in the journal. Activation grants neither publication nor a new owner. Subsequent Push still needs explicit frozen scope; ordinary canonical Git pushes remain gate-only observations. Source/configuration or dispatcher drift blocks use until reviewed.

## Rollback and interruption

```
contribution repos migration --repo ID --rollback-adoption PLAN --expected-revision CURRENT_REV --request-id UUID --json
```

Rollback restores only migration-owned bytes still matching their before/after snapshots. It refuses conflicting working or staged edits, preserves unrelated files and never rewinds history, changes the index, reverses a push or erases receipts. The resulting source changes require an ordinary project commit. If a paired authority record exists, the source publication guard remains and refuses publication until a compatible route is explicitly reconciled. Restoring old configuration cannot re-enable a companion writer.

An interrupted apply/rollback retains its phase and matching snapshots. New adoption plans cannot displace an in-progress migration. Completed command identities return their original result even after later policy changes. An interrupted proposal is preserved and requires a fresh proposal identity. Unknown legacy leases/flights are never expired into migration authority.

## Current proof

Synthetic policy fixtures exercise all four existing dispatcher families and actual disposable managed Git publication after activation. They preserve the inactive gate, old dispatcher, gate borrowing, request identities, source isolation and ordinary project commit boundary. Additional fixtures cover interrupted file application, concurrent edits/commits, corrupted snapshots, rollback with companion authority, primary-writer and landing-flight contention, and changed dispatchers/authority/activation ranges. These prove the shared implementation; they do not claim full real-project gate parity or a live cutover. No live project was changed by this work.
