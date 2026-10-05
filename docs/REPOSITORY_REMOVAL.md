# Leaving Contribution

`contribution repos remove --repo REPO --json` removes a local enrollment and its verified Contribution-owned generic pre-push hook. Source files, staged and unstaged work, Git history, native task worktrees, configuration files and retained operation evidence remain in place. An existing foreign hook without a Contribution ownership record remains untouched.

Removal checks the saved installation digest, hook routing, clone identity, regular-file ownership and directory identity. Changed content, symlinks, hard links, foreign writer leases and unresolved operations block removal. Interrupted operations require reconciliation even when their original process has exited. Active adopted integration must first complete its reviewed rollback. Paired authority cannot be discarded locally; its coordinated release remains a separate unfinished implementation boundary.

The service records intent before removing a hook and fences new admissions and configuration changes. The hook unlink is preceded by a durable checkpoint; enrollment deletion and the completion receipt share one SQLite transaction. If the process stops between those steps, repeat the same command with the repository ID. Only an absent hook after the retained unlink checkpoint is accepted as a completed file removal. A replacement hook is preserved. `repos list` includes pending removals and their continuation action.

After completion, repeating removal by its former ID or primary path returns the retained receipt. Explicit reenrollment takes precedence and starts a new enrollment lifetime; old callbacks cannot implicitly restore it. The public command does not delete logs, retained bundles, source refs or cleanup receipts.

`tests/repository-removal.test.mjs` covers exact owned-hook removal, unchanged foreign policy, unborn enrollment, dirty source/index preservation, retained task history, active/uncertain/interrupted/live workers, adoption and authority guards, changed paths/content/routing, interrupted unlink, concurrent requests and explicit reenrollment. These disposable fixtures do not establish real two-host release or GUI acceptance.
