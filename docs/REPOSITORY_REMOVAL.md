# Leaving Contribution

`contribution repos remove --repo REPO --json` removes a local enrollment and its verified Contribution-owned generic pre-push hook. Source files, staged and unstaged work, Git history, native task worktrees, configuration files and retained operation evidence remain in place. An existing foreign hook without a Contribution ownership record remains untouched.

Removal checks the saved installation digest, hook routing, clone identity, regular-file ownership and directory identity. Changed content, symlinks, hard links, foreign writer leases and unresolved operations block removal. Interrupted operations require reconciliation even when their original process has exited. Unadmitted source captures, incomplete incoming Git transfers and pending completion acknowledgments also retain enrollment. Active adopted integration must first complete its reviewed rollback.

A generic paired companion can now leave through the same command. It first
retains its removal and fences new local requests, then obtains the canonical
host's exact release receipt. That host keeps canonical ownership and becomes
local-only; both hosts retain the prior authority epoch and release identity.
Only after the receipt does the companion remove its verified owned hook and
enrollment. Dirty work, staged files and both committed histories remain intact.
An unavailable owner, lost reply or changed hook preserves the local fence and
returns a continuation for the same removal. No timer substitutes for release.

To remove the canonical host, first use the existing explicit `repos pair`
ownership transfer. Removal never elects another owner. Adopted paired-project
removal still requires its separate complete writer migration; generic release
does not authorize changing legacy integration.

Owner transfers reserve the destination before disabling the old owner.
Reservation and removal check one another's retained state, so a concurrent
attempt is refused before it strands the old owner. Lost preparation replies
resume the exact transition and proposal; changed source/history or policy
requires reconciliation rather than silently selecting new inputs. Inspect
`repos inspect` for authority and reservation state. Both peers must support the
preparation step; an older peer's unsupported response does not trigger fallback.

Explicit reenrollment under a removed companion's logical repository identity
retains its previous canonical owner and remains fenced. A newer explicit owner
transition is required to reactivate that mapping. Historical release replies
are replayable but cannot change a newer owner or erase its monotonic epoch.

The service records intent before removing a hook and fences new admissions and configuration changes. The hook unlink is preceded by a durable checkpoint; enrollment deletion and the completion receipt share one SQLite transaction. If the process stops between those steps, repeat the same command with the repository ID. Only an absent hook after the retained unlink checkpoint is accepted as a completed file removal. A replacement hook is preserved. `repos list` includes pending removals and their continuation action.

After completion, repeating removal by its former ID or primary path returns the retained receipt. Explicit reenrollment takes precedence and starts a new enrollment lifetime; old callbacks cannot implicitly restore it. The public command does not delete logs, retained bundles, source refs or cleanup receipts.

`tests/repository-removal.test.mjs` and `tests/paired-removal.test.mjs` cover exact owned-hook removal, unchanged foreign policy, unborn enrollment, dirty source/index preservation, retained task history, active/uncertain/interrupted/live workers, adoption and authority guards, changed paths/content/routing, interrupted unlink, concurrent requests, lost peer replies, conflicting lifecycle actions and fenced reenrollment. These disposable fixtures do not establish real two-host release or GUI acceptance.
