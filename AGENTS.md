# Contribution

Read `docs/README.md`, `docs/REPOSITORY_SETUP.md`, and `docs/SETUP_STATUS.md` before changing the foundation. Detailed requirements and review amendments remain authoritative; setup does not authorize M0–M6 or D0–D4 implementation.

- Preserve existing work, project policies, the MIT license, provenance, and native Codex worktree ownership. Commit only completed owned changes on a `codex/` branch. Do not push or install without authorization.
- Do not permanently delete user-created or irreplaceable files. Move them to `~/.Trash/` when practical. Use normal owning-tool removal for reproducible project data. Verify exact targets; ask when ambiguous, valuable, or outside scope.
- Keep JSON Schema canonical in `packages/contracts`; run generation, drift checks, contract tests, and the focused build checks for affected boundaries. Types and fixtures never prove authorization or physical support.
- Keep product runtime pins separate from enrolled-project pins. Installed payloads must be immutable and independent of editable checkouts.
- Never commit private archives, raw audits, credentials, signing/pairing material, or real device evidence. Payloads use `config/payload-allowlist.json`; ignores alone are insufficient.
- Report actual checkout/HEAD, commands, outcomes, and missing proof. Do not mark application acceptance passed from setup checks. Stop at the authorized milestone.
