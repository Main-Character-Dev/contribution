# Interim agent workflow

Until Contribution is qualified for everyday use, agents must perform commit,
integration and native worktree completion explicitly. This rule applies to
Contribution's own development. It does not authorize publication, installation
or changes to another project's policy.

## Commit completed work

- Inspect the actual checkout, branch, HEAD and staged/unstaged/untracked state
  before changing anything. Identify concurrent owners before touching stray work.
- Work on a `codex/` branch. Commit each coherent, completed slice after its
  relevant focused verification passes; also check for a completed slice before
  a long handoff or ending a task. Do not use a timer to commit unfinished code.
- Stage only owned source and useful documentation. Preserve unrelated index
  entries. Never commit credentials, private evidence, generated build output,
  caches or machine-local metadata just to make the checkout appear clean.
- Preserve unfinished work in its owning checkout and report its owner and next
  step. If an abandoned change cannot be verified as complete, retain it for
  review rather than silently publishing it as finished work.

## Integrate and report

- Integrate completed, validated commits through the repository's authorized
  workflow. Coordinate with active owners before updating the primary checkout.
  Prefer a fast-forward when history permits; inspect conflicts and policy before
  choosing another integration strategy. Preserve local configuration.
- Verify the primary branch, integrated SHA and tracked-file state. Distinguish
  source commits, local integration and remote delivery in the completion report.
- Push, service installation and live enrollment require their own authority;
  this interim workflow does not grant it.

## Finish native worktrees

- Keep active worktrees and checkouts needed for unfinished work, ongoing
  processes, unresolved integration or another chat's work.
- Before archival, verify the exact target, completed task status, retained
  commits and local integration when required. Inspect staged, unstaged,
  untracked and ignored files. Preserve needed ignored files separately because
  native archival does not retain them.
- Use Codex's normal managed-worktree archival operation for Codex-owned
  worktrees. Have the owning chat archive its attachment; do not remove its
  directory or Git registration behind Codex's back. Archival keeps a recoverable
  Git snapshot and does not require deleting the chat.
- Do not force removal, reset unrelated files, discard unknown work or infer
  ownership from age. Move irreplaceable user files to macOS Trash when removal
  is authorized and practical; ask when a target is ambiguous or valuable.

## Contribution readiness

The current product contract captures already committed tasks and excludes
native Codex task worktrees from Contribution-owned checkout cleanup. Agents
remain responsible for the steps above even after a service pilot. Automatic
commit cadence or native task completion enforcement needs explicit product
requirements and acceptance proof before it can replace this routine.

Adopt the service first through a bounded, disposable one-repository pilot that
proves submission, retained history, landing, recovery and owned-output cleanup
against the actual installed build. Record remaining qualification separately.
