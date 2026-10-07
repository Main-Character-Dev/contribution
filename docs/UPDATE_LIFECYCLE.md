# Update lifecycle

The engine now retains a maintenance window in SQLite before work is drained. New mutations and automatic observations stop; existing workers, their managed Git hooks, asynchronous service requests and peer transfers finish. Queued requests keep their original identity and inputs. Uncertain effects and unreleased utility-owned device sessions block the final stop. Cancelling maintenance preserves the separate pause preference and releases the same queue.

A held window survives a service crash. Startup never clears it or performs effect recovery behind it. The final stop takes a private SQLite online backup, verifies integrity, records its digest/schema/operation count/event cursor, syncs files and directories, and then closes the socket, journal and lock. The stop reply explicitly means `stop_requested`, not proof that the helper has exited. The native updater unregisters the launch agent and observes the old PID disappear before allowing Sparkle to start its update cycle. No installed agent has been exercised yet.

The native release updater uses checksum-pinned Sparkle 2.10.0. Its full runtime and license are checked byte for byte against the verified upstream archive during unsigned app inspection. Automatic checks, downloads, installation and system profiling are disabled. Every enabled cycle starts inside a held maintenance window, with the helper already stopped. This also protects installation on quit; a relaunch-delay callback alone is insufficient. A normal cycle completion does not clear a window if installation might still be pending. A completed explicit Skip can cancel it. Extraction and on-quit installation retain a recovery marker. See the [updater delegate contract](https://sparkle-project.org/documentation/api-reference/Protocols/SPUUpdaterDelegate.html).

Checking requires a valid signed release app, an HTTPS feed, a 32-byte public update key and the bundled signed-release engine manifest. Unsigned development builds show the missing configuration. Reconciliation registers the currently installed helper, checks its manifest digest against the app, and explicitly releases the same journal window. An unchanged app can cancel; a changed app must reconcile activation. If the native app loses its recovery pointer, the authoritative service window remains held and needs explicit inspection; it never expires into permission to run.

## Journal compatibility and rollback

This is the single current compatibility and rollback owner. One SQLite journal and existing records table retain operation/request identities, host bindings, receipts and ownership. Compatibility is inspected read-only before journal mode, metadata writes or dispatch.

| Journal floor | First producer / semantics |
|---|---|
| v1 | Original durable journal |
| v2 | Repository resource intent and exact ownership before allocation |
| v3 | Connectivity evidence and uncertain remote-admission semantics |
| v4 | Host-scoped SSH/provider process intent, identity and grant without repository enrollment |

The current reader supports v1–v4. Producers only raise the floor, inside the relevant intent transaction before effects; repository allocation cannot downgrade v3/v4. A v3 payload refuses a v4 journal before opening a writer. Host resources have explicit host scope and null repository/operation/attempt IDs, not fabricated enrollment. Old stored optional provider fields default to unknown/stale; no old cached success becomes current readiness.

Maintenance status, stop, restart and update include active health/provider observations, retained process resources and legacy unconfirmed connection-release evidence. No final backup or replacement is allowed while these blockers remain. New automatic work stops in the held window; accepted effects drain under their existing owners. Exact absence is observed without guessing process kills; stopping local SSH never proves a remote mutation stopped.

Rollback must use an immutable payload capable of reading the retained floor and ownership semantics. A source revert or restoring an old database cannot undo external effects or create a second finalizer. Back up state through maintenance before separately authorized installation. Backups are private recovery evidence, never automatic downgrade authority. [Backup retention](STORAGE_RETENTION.md#completed-update-backups) preserves two newer verified copies and all unresolved/pinned evidence. Automated rollback selection remains pending.

## Release candidate preparation

`python3 scripts/prepare-release.py --help` describes the required public feed/download URLs, public Ed25519 key, approved Developer ID identity, and existing Keychain profile/account names. Without `--execute`, it validates arguments and prints a plan. Execution requires a reviewed non-development version and clean checkout. It builds a fresh allowlisted app, signs Node with its JIT entitlement, refreshes the manifest after signing, signs nested helpers and the app, verifies signatures, submits to Apple notarization, requires `Accepted`, saves the log, staples and validates the ticket, checks Gatekeeper, creates and signs the final archive, and independently verifies its signature using the embedded public key. It writes an appcast candidate and provenance locally. It never uploads the feed or installs the app.

The pipeline follows [Apple's notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow) and [Sparkle's distribution guidance](https://sparkle-project.org/documentation/). Credentials stay in Keychain. The Node and Sparkle license notices accompany the runtime. The candidate directory also retains the intermediate notarization input and private diagnostic receipts; publish only the separately reviewed final archive, appcast and public provenance.

## Verified and remaining proof

`tests/maintenance.test.mjs` covers crash-retained holds, queue identity across cancellation, asynchronous request draining, uncertain effects/session blocking, backup integrity and helper process exit, retained holds after relaunch, and read-only rejection of a newer schema. The existing idle-restart test still passes. Native tests cover persisted installer state and refusal to release an installation-on-quit hold from a generic cycle completion. Unsigned native compilation and exact-framework inspection pass.

Signing, Node JIT under hardened runtime, notarization, Gatekeeper on a clean Mac, registration/unregistration, manual/cancelled/on-quit updates, replacement failure, native app crash at each update boundary, and activation of a genuinely different signed engine remain release qualification. No signing account was used and no update check was started during this implementation.

An interrupted repository configuration retains its original client request across an early maintenance refusal. `repos configure --repo ID --resume --request-id UUID` uses the service's exact retained configuration and original reviewed revision; it accepts no replacement values. Concurrent source edits remain untouched and block completion until reconciled. Completed request replay returns the original result.

Retained resource ownership is described in [Resource lifecycle](RESOURCE_LIFECYCLE.md); the compatibility table above owns the current floor.
