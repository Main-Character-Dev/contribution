# Contribution

Read `docs/README.md`, `docs/SETUP_STATUS.md`, and `docs/IMPLEMENTATION_STATUS.md` before changes. Detailed requirements and review amendments remain authoritative. The owner authorized all M0–M6 and D0–D4 implementation on 2026-10-05; live installation, enrollment and hardware approvals are deferred to the final handoff. The S0-only prompt remains historical scope, not the current assignment.

Follow `docs/INTERIM_AGENT_WORKFLOW.md` until Contribution is qualified for everyday use: commit completed focused-validated slices, integrate through the authorized repository workflow, and archive finished Codex-managed worktrees with Codex's normal operation after confirming retained/integrated history and preserving needed ignored files. Keep active worktrees and unfinished/concurrent work intact.

- Preserve existing work, project policies, the MIT license, provenance, and native Codex worktree ownership. Commit only completed owned changes on a `codex/` branch. Do not push or install without authorization.
- Do not permanently delete user-created or irreplaceable files. Move them to `~/.Trash/` when practical. Use normal owning-tool removal for reproducible project data. Verify exact targets; ask when ambiguous, valuable, or outside scope.
- Keep JSON Schema canonical in `packages/contracts`; run generation, drift checks, contract tests, and the focused build checks for affected boundaries. Types and fixtures never prove authorization or physical support.
- Keep product runtime pins separate from enrolled-project pins. Installed payloads must be immutable and independent of editable checkouts.
- Never commit private archives, raw audits, credentials, signing/pairing material, or real device evidence. Payloads use `config/payload-allowlist.json`; ignores alone are insufficient.
- Report actual checkout/HEAD, commands, outcomes, and missing proof. Do not mark application acceptance passed from setup checks. Stop at the authorized milestone.
