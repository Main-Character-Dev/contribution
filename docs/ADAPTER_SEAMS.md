# Adopted project seams

Read-only primary-checkout inspection on 2026-10-05 confirmed separate project runtimes and hook ownership. No project was enrolled, edited, checked, pushed or activated by that inspection.

| Project | Node / pnpm observed | Preserved behavior |
|---|---|---|
| Mathy | 24.19.0 / 11.22.0 | Trusted dispatcher, policy-only landing, permitted multiple author dates, explicit combined message, cumulative publication selection |
| Main Character | 24.21.0 / 11.23.0 | Husky bootstrap, integration-only landing, cumulative risk/strict gate, exact pushed tree, existing primary mutation lease |
| Roboty | 24.21.0 / 12.4.2 | Husky owner, integration-only landing, cheap local safety, separate activation registry for device, launch and distribution actions |
| Glass Alpha | 24.19.0 / 11.22.0 | Existing commit/lifecycle owner and one-date attribution, inactive pre-push validation and CI |

These observations are not runtime constants. The installed adapter catalog identifies policy families and hashes the current bounded seam files without exporting their source or attribution identities. `repos migration --repo ID [--adapter ID]` reports the current inventory and leaves cutover pending. Unknown/missing seams cannot silently select a generic adapter. Glass Alpha enrollment preserves its visibly inactive gate while still requiring migration of its existing hook owner.

`repos runtime --repo ID --node /absolute/node --pnpm /absolute/pnpm` explicitly registers the project tools. Selection checks the current `.node-version` and exact `packageManager` pin, then observes both executable versions. Every relevant check revalidates the selected source pins and uses the registered tool environment. Contribution's bundled runtime is not an implicit project runtime, and missing pins never trigger a background package installation.

Live inspection also confirmed that Main Character and Roboty retain latest-log paths that need per-attempt migration, and that their existing primary lease is distinct from Contribution's generic lease. Mathy acquires its lease through its own preparation module. The generic engine therefore refuses adopted landing and publication until the compatible writer/hook migration is implemented and verified. Calling an old gate beside an unrelated new lock would not establish parity.

Remaining M4 work includes shared coordination extraction, verified hook lease adoption inside the original Git process ancestry, original-policy execution and receipt reuse, imported-source adapters, per-attempt legacy reporting and reversible cutover patches. The four live projects remain unchanged until the owner’s deferred enrollment step. Runtime/policy fixtures in `tests/adapters.test.mjs` establish the implemented subset, not migration completion.
