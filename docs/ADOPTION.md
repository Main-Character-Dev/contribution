# Reversible project hook adoption

This is the initial publication-hook adoption path for the four inspected policy families. It does not enroll a repository, install Contribution, switch canonical ownership, commit project files or publish Git history. Live project enrollment and cutover remain deferred to the owner. Original landing/import adapters and complete project-specific parity remain separate work.

The existing dispatcher remains the owner: Mathy's trusted hook directory or Husky. The reviewed source guard calls the installed per-user Contribution CLI for an ordinary push and the verified payload CLI for a managed push. Both routes require the same authenticated service, canonical authority and compatible primary lease. The enabled original shell gate is retained privately and executed under the project runtime with its original arguments, stdin and logical script path. Glass Alpha gets the authority guard without a validator. Its gate remains inactive.

## Review, apply, commit, activate

The native project's **Project migration** sheet lists retained reviews, prepares a new source review or reconstructs an already committed second-clone migration, and shows each exact saved before/after file. It reads at most 32 KiB per page at UTF-8 boundaries and verifies the retained file digest for every page. These private source previews are local details, not sanitized diagnostics. An inactive gate remains visibly inactive. Each apply, activation or rollback has a separate revision-bound confirmation and retained client request. Interrupted steps resume through the existing Activity continuation; closing a sheet does not discard that identity. Actual GUI, keyboard and accessibility qualification remains outstanding.

The equivalent read-only CLI inspection is:

```sh
contribution repos migration --repo ID --list-adoptions --json
contribution repos migration --repo ID --adoption-plan PLAN \
  --review-file PATH --review-side before --review-offset 0 --json
```

Use the returned `nextOffset` to read another page, or `after` for the proposed contents. File selection is restricted to that repository's retained proposal; arbitrary filesystem paths are refused. Review reads remain available during the ordinary update drain, while mutation stays blocked. The final checkpoint and stopping service still refuse requests. The list is bounded to fifty reviews, prioritizes active/interrupted migrations, reports truncation, and retains lookup by proposal ID for older reviews.

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

## Registering an already migrated second clone

A clone of the committed adoption does not contain the first host's private original gate or local dispatcher registration. Reconstruct them from local Git history with a separate review:

```sh
contribution repos migration --repo REPO --prepare-existing-adoption \
  --original-tip ORIGINAL_COMMIT --migration-tip MIGRATION_COMMIT --request-id UUID
contribution repos migration --repo REPO --adoption-plan PLAN
contribution repos migration --repo REPO --activate-adoption PLAN \
  --expected-revision REVISION --request-id UUID
```

The original and migration selectors must be full committed object IDs. The migration must be an ancestor of the current clone. The engine reconstructs the same guard, bridge, reporting overrides and configuration from original committed files, checks the exact changed paths and executable modes, and verifies that all current policy files still match. Later unrelated source commits are allowed. Original source must be bounded ordinary UTF-8 files; missing ancestry, links, submodules, LFS and changed policy stop review.

Preparing and activating this path write only private reviewed snapshots and local registration. After activation, an explicit rollback restores the reviewed original files as uncommitted changes. Its configuration comes from the retained original history, or returns to a generated migration-required policy when no configuration file originally existed. Rollback preserves concurrent edits and retains paired-host publication refusal. Neither action stages files, commits, installs a dispatcher or changes canonical ownership. The second host must already have the project's normal trusted dispatcher or Husky owner. Activation drains compatible primary/landing writers and rechecks local dispatcher, snapshots, branch, configuration, history and authority. The original gate is recovered from committed source; no supplied remote executable is accepted. All-writer cutover and adopted cross-host handoff remain separately blocked pending their implementation and qualification.

Three focused fixture groups cover all four second-clone reconstructions, source preservation, idempotent activation, changed history/policy/gate/lease, and post-review dispatcher/snapshot/authority/writer conflicts.
