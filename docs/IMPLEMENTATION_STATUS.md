# Implementation record

Started 2026-10-05, America/New_York, under the owner's authorization to implement M0–M6 and D0–D4 while retaining unanswered prerequisites for the end. The owner subsequently deferred live installation, live project enrollment, peer/phone setup and approvals to the final handoff. Those actions have not been performed.

Checkout: `/Users/gabe/.codex/worktrees/3f07/contribution`, branch `codex/full-implementation`, based on the reviewed S0 repair `55323b8`. The earlier requirements work is retained on `codex/requirements-review` at `e65ed0d`. Primary remains separate; unrelated primary `.codex/` contents are preserved. Original code remains MIT licensed.

## Current implementation, not milestone completion

- A pinned-runtime development payload is assembled independently of the checkout, inventories every file, rejects symlinks and verifies hashes before service admission. Signed distribution remains pending.
- One service owns a SQLite WAL journal, full-sync request transactions, idempotent immutable requests, ordered events, independent attempt logs, per-repository queues, process identity, bounded commands, cancellation, pause/drain and conservative restart reconciliation. Node's built-in SQLite binding is coupled to the pinned Node 24.21.0 runtime; its experimental status remains a release qualification consideration.
- Public service commands provide local enrollment, bounded discovery, explicit unborn initialization preserving unrelated index entries, configuration revisions, status, retained logs and operations, generic committed-source capture, isolated candidate landing and real non-force publication through an adopted managed hook lease.
- Push preview freezes source/destination/policy. The hook runs the gate once inside the actual Git command. Inactive gates, no-op publication, gate failure, remote rejection, external hook-only observation and uncertain delivery remain distinct.
- GitHub observation retains current-head/test-merge identities, required checks, GitHub merge state, bounded pagination, slow discovery and error-aware polling. Stale last-known success never substitutes for an unavailable current observation.
- The native UI uses the same authenticated private service for repositories, operations, logs, pause/resume and explicit Push preview. The native build and unsigned bundled-app assembly pass; visual interaction and installation qualification remain separate evidence.
- The generic peer implementation now includes fixed-entry-point SSH, host identity checks, retained chunked Git transfers, bootstrap admission, imported-source landing, guarded mirrors, canonical command forwarding and explicit monotonic ownership transitions. Two-journal fixtures prove lost-reply handling and refusal to replace dirty/divergent work. Real SSH and adopted-project cutover remain unqualified; see [PEER_PROTOCOL.md](PEER_PROTOCOL.md).

The executable fixture tests currently prove durable paused queues across restart, immutable duplicate requests, explicit initial history without unrelated file/index changes, detached task landing with dirty source preservation, actual push/gate/delivery, stale queued scope, gate versus transport failure, inactive gates, external hook uncertainty, cancellation and distinct attempt logs. GitHub fixtures cover required-check association, draft/conflict/review state, reruns, auth/permission/404/API/rate errors and incomplete observation.

These are partial fixture results, not passes for every variant of the 83 acceptance cases. The original requirements and physical-device rows remain in force. This record is updated as implementation continues.

## Early device and native integration findings

- The installed Codex CLI exposes experimental `remote-control start|stop|pair`; help was inspected without starting it or pairing. Its availability is not evidence that the actual phone-only travel caller is qualified. The conditional authenticated browser route remains in scope until that caller is resolved.
- Xcode 27 CoreDevice help explicitly deprecates legacy device dictionaries in favor of `properties`. A bounded inventory attempt in this execution environment exited 2 without a device result. The actual phone identity, trust, OS and route remain unknown.
- Signing inventory reported two available identities without retaining their names. No identity has been approved or used for Contribution signing or a phone update.
- The go-ios research candidate is pinned to `273d3e06e803fb6ee95e4df914d8be82c5ee4bb0` (2026-10-02). Its tunnel implementation has an explicit userspace mode and requires privilege when it is absent. Its default-pair-record option references Apple-owned trust data, so it must not be adopted automatically. No go-ios binary or tunnel was installed or started. Full dependency/privilege review and physical qualification remain open. Sources: [pinned tunnel implementation](https://github.com/danielpaulus/go-ios/blob/273d3e06e803fb6ee95e4df914d8be82c5ee4bb0/cmd_tunnel.go), [pinned dependencies](https://github.com/danielpaulus/go-ios/blob/273d3e06e803fb6ee95e4df914d8be82c5ee4bb0/go.mod).

## Work still being pursued

Complete native client and payload proof; strengthen crash/retention/configuration boundaries; implement authenticated peer transfer, seeding, safe mirrors and authority transitions; inspect and adapt the four live policy seams without enrolling or editing those projects; implement device grants, qualification, artifact/effect records, scoped backend dispatch and lifecycle controls; finish release/update controls and every independent acceptance fixture. Remaining hardware/signing/real-host proof will be reported together at the end.

## Checkpoint verification

`bash scripts/dev.sh check` passed 44 tests, compile-time regressions and foundation preservation checks. `bash scripts/dev.sh native:test` passed both Swift contract methods. `bash scripts/package-app.sh` assembled an unsigned app containing the verified runtime/engine payload and native launcher; its bundled CLI reported the shared version. These commands require normal local process/socket and Xcode cache permissions; the restrictive execution sandbox cannot provide process-start identity. No service registration or live installation occurred. Subsequent work continues on this branch.
