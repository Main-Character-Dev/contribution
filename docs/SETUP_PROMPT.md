# Prompt for a new Contribution chat

Open the Contribution project and paste the text below. The documentation prepared by the review is in this task checkout: `/Users/gabe/.codex/worktrees/3f07/contribution/docs`. That location is a handoff reference, not an installed runtime path. If this checkout has been archived or moved, use the maintained docs in the current Contribution repository instead.

```text
Set up the Contribution repository for implementation. This is S0 repository foundation only; do not execute the original full M0–M6/D0–D4 implementation assignment yet.

First inspect applicable AGENTS.md instructions, the intended primary checkout, the current checkout/branch/HEAD, tracked and untracked files, existing license, and any implementation since the requirements review. Preserve working code and unrelated changes. Use an appropriate existing worktree and a codex/ branch; do not assume an old detached checkout describes current primary.

Read the maintained docs in this order:
- docs/README.md
- docs/VISION.md
- docs/ARCHITECTURE.md
- docs/REQUIREMENTS_REVIEW.md
- docs/REPOSITORY_SETUP.md
- docs/ROADMAP.md
- docs/VERIFICATION.md and docs/SOURCE_PACKAGE.md
- the relevant detailed requirements, schemas and examples linked from those docs.

If these docs are not yet in the current checkout, locate the review baseline at /Users/gabe/.codex/worktrees/3f07/contribution/docs and reconcile it plus the corresponding root README into the intended Contribution checkout without overwriting concurrent work. If that path is unavailable, report the missing baseline; do not reconstruct it by blindly extracting the archive into Git. The original private reference archive is /Users/gabe/Downloads/contribution-implementation.zip and must remain outside the source repository. Its README.md and CODEX_START_PROMPT.md are background; this setup-only scope supersedes their instruction to implement everything now.

Complete the S0 deliverables and exit checks in docs/REPOSITORY_SETUP.md. Establish a reproducible SwiftUI macOS app/menu-bar shell and thin platform boundary, strict TypeScript engine/CLI/contracts/adapter packages in a pnpm workspace, one version source, exact compatible toolchain pins and lockfile, a real native app-bundle build path, and concise local build/check commands. Start with the documented Apple Silicon, Swift 6, macOS 14.0 and Node 24 LTS foundation; verify compatibility and record any necessary departure. Do not require release signing for a development build.

Preserve the MIT license. Add short agent guidance and privacy/build exclusions. Move the reviewed schema/example JSON into one canonical contracts package, update links/provenance, validate all 12 schemas and 14 examples with local reference resolution, add meaningful negative contract checks, and establish checked TypeScript/Swift client representations without weakening JSON Schema semantics. Keep product and project runtime selection separate.

Implement only the minimal help/version and honest empty/unavailable surfaces necessary to prove the foundation. Do not implement or simulate successful Git workflows, service scheduling, real SQLite job admission, repository migration, device operations, OTA or update delivery. Do not register a background service, install a global CLI, modify other repositories or their hooks, pair hosts/phones, import signing material, change network/security settings, run physical-device experiments, or push/publish/deploy as a setup side effect.

Record read-only local toolchain observations and missing peer/device/signing facts for D0. Preserve every PRD and RDEV requirement and all 54 core plus 24 device acceptance cases. Keep core release, fixture proof, real-Mac proof, two-Mac proof, and per-operation physical evidence separate. Missing hardware does not block independent setup, and build/schema success does not prove device capability.

Run the documented focused checks and native/package builds, fix setup defects, and finish all independent setup work. Update docs/SETUP_STATUS.md, roadmap and verification records with exact commands and outcomes. Commit only owned completed setup changes under the repository's current policy; do not push or install. Report the actual checkout, branch/commit, how to build/run the development shell and CLI, checks passed, exact remaining prerequisites, and the next bounded implementation task. Stop at the S0 boundary rather than continuing automatically into the full implementation plan.
```
