# Vision

Contribution should let a developer finish work on either Mac, know where that work is safely retained, integrate it through the repository's existing rules, and deliberately publish the exact intended result. The app and agents should describe the same operation and the same evidence.

The first user develops several projects on a MacBook Pro and an always-available Mac Mini. A paired project uses the Mini as its canonical integration and publication owner. The laptop stays useful offline. A standalone project has a local owner and needs neither a second Mac nor Tailscale.

## Everyday experience

1. Open a project in the supported native development environment and work in a task checkout.
2. Commit only completed, owned changes and intentionally submit that immutable work.
3. Contribution retains the work and transfers it when the canonical host is available. Receipt, landing, and publication remain separate.
4. Inspect unpublished canonical commits and select **Push to GitHub**. The selected tip, destination, and policy stay fixed.
5. See the actual push result, current GitHub checks, and PR readiness, with a useful next action when something needs attention.
6. For an enabled iOS project, select an approved build/device host and prepare an exact signed artifact. Install, launch, logs, tests, UI interaction, and debugging each show their own verified result and limitations.

## Product principles

- One shared engine serves native UI, CLI, and authorized remote callers.
- Preserve project policy while sharing coordination, execution, evidence, and recovery.
- Make accepted work durable across closed windows, sleep, lost connections, and restarts within the qualified host-session boundary.
- Keep status compact and explain the actual blocker. Put detailed diagnostics behind an explicit action.
- Treat unverified and unavailable capabilities honestly. A successful process or upload is not proof of a completed external effect.
- Keep installed releases independent of mutable source development.
- Keep ordinary operation quiet and bounded; no model call is needed to interpret routine state.

## Scope and completion

The core product includes the native app, menu bar, CLI, managed user service, repository enrollment, adopted gates, durable two-Mac handoff, explicit publication, GitHub monitoring, notifications, and safe updates. M0–M6 and their 54 acceptance cases define completion.

Remote Devices is optional to enable, but its full planned scope remains tracked through D0–D4, all 40 RDEV requirements, and 24 physical acceptance cases. A core release can be qualified while particular device capabilities remain unresolved. Remote Wi-Fi, warm cellular continuation, and fresh cellular establishment are different claims.

Contribution does not replace Codex's editor, chat storage, or native worktree lifecycle. It does not synchronize unfinished directories, credentials, databases, or arbitrary product state. It does not automatically publish, merge, deploy, activate product features, or require a permanent custom iOS client. A website, hosted control plane, and general plugin platform are outside the initial scope.

For measurable performance targets, accessibility, detailed behavior, and requirement IDs, use the [product requirements](requirements/01-PRODUCT_REQUIREMENTS.md).
