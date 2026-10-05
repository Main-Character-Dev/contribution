# Original project local checks

`checks run --source-path PATH` now invokes preserved project check entry points in that exact enrolled local checkout. It resolves the source's declared Node/pnpm versions, freezes the selected program and input identity at admission, contains the process group, retains output per attempt, and rejects changed inputs. It does not supply a publication scope, run the pre-push hook, publish, or write a Contribution gate-pass receipt.

| Adapter | Default | Explicit `--check` selectors | Dirty inputs |
|---|---|---|---|
| Mathy | `scripts/validation-profile.mjs check` | `check`, `landing-policy`, `test-path:tests/...`, `test-path:scripts/NAME.test.mjs` | Supported by these original current-source routes |
| Main Character | `scripts/run-changed-checks.mjs --mode all` | `changed`, `lint`, `typecheck`, `test` | Rejected: this original selector uses committed history |
| Roboty | `scripts/run-changed-checks.mjs` | `changed` or an original stable check ID, passed as `--only-check` | Supported by its original broad dirty-source route |
| Glass Alpha | `scripts/run-changed-checks.mjs --mode all` | `changed`, `test` | Rejected: this original selector uses committed history |

Mathy's `landing-policy` remains policy-only. Its deprecated `test:changed` alias must not be described as a test suite. A `test-path:` selection goes through Mathy's original iteration router and cannot escape the selected source. Main Character and Mathy exact-range publication repair IDs remain with their original repair commands; a local selector does not silently become a cumulative pre-push request.

`--fresh` reaches original runners where supported. Glass Alpha's runner and Mathy's focused iteration route already execute without Contribution receipt reuse, so no unsupported flag is passed. Child skip/reuse outcomes remain in the original output. The aggregate reports **runner completed**, not that every project check passed or ran. An inactive Glass Alpha publication gate remains visibly inactive after an explicit local check.

Local source checks use Contribution's scheduling lease without attempting to release or borrow the legacy primary writer lease. They remain available when the canonical peer is offline or the primary legacy lease is retained. Original project native/simulator resource coordination remains in the invoked project programs. `--canonical` continues to use the owner or report unavailability.

Five focused public-dispatch fixture groups cover all four routes, selected checkout identity, local/primary isolation, dirty staged/unstaged/untracked preservation, named selectors, queued drift, original failure exits and changes made during a check. They use synthetic project programs. Current original entry points and argument parsers were inspected read-only; no real project gate or suite was executed. Full live adapter/runtime parity remains separate qualification.
