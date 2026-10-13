# Performance implementation and proof

The October 12 audit recommendations are implemented in the engine, CLI and
macOS client. The owner authorized validation and implementation. Authorization,
retained request identity, ownership reconciliation and durable transfer
acknowledgment remain required. Installed, physical-device and real two-host
acceptance remain incomplete.

## Implemented changes

| Area | Change and retained boundary |
|---|---|
| Live state and history | Indexed queue, unsettled and attempt lookups; sparse live ownership; bounded resource history pages; scalar status counts. Missing-state evidence remains fenced. Native repair uniqueness runs in the final synchronous admission step with an indexed pending lookup. |
| Processes | In-flight asynchronous census sharing, indexed ancestry and serialized runner checks. No completed evidence is cached. A failed/incomplete snapshot gets a fresh retry within the original deadline. Release needs a later complete positive census; persistent failure stays unconfirmed. Each signal still verifies exact identity. |
| Bulk files | Two reusable workers handle bounded hashes, app verification/extraction/copying, history inventories, backups and storage census. Sixteen waiting jobs maximum, finite heap/deadlines, and cancellation that terminates staging writes before returning. Journal and final authorization remain on the service thread. |
| Transfers | Negotiated `stdio-session-v1` reuses an owned SSH/helper process with four chunks per window. Durable receiver acknowledgments remain authoritative. Controls get a turn between windows; session release belongs to service drain. Legacy peers keep single-request transport. |
| Storage | Indexed log-owner retention and fresh complete off-thread admission census, followed by current policy/state checks. Unknown files count and incomplete census blocks admission. |
| Native activity | Event cursor, targeted detail refresh, compact summaries, bounded log ranges/text, periodic full reconciliation and slower inactive refresh. Log cursors reset across attempts/truncation. |
| GitHub | Due-deadline scheduling, two concurrent repositories and per-repository coalescing. Active cadence starts at observation start; stale/error backoff and destination checks remain authoritative. |

Validation rejected producer-only incremental usage caching: unknown new files
would evade the cap. Fresh worker census is the implemented alternative. It
improves responsiveness while preserving the complete filesystem traversal.
Synchronous compatibility helpers remain for offline fixtures and narrow final
authorization checks. Destructive-output review retains its existing bounds.

Canonical JSON Schema remains in `packages/contracts`. Generation emits
standalone validators with runtime/compiled parity checks, removing schema
compilation from each CLI/helper launch. Equivalent format/schema options and
the payload allowlist remain enforced. See the
[Ajv compiler documentation](https://ajv.js.org/standalone.html).

## Local measurements

Synthetic journals/files on Apple M4 Max, Node 24.21.0; baseline `000d45a`,
final measured runtime `ded58ad`. The intervening dependency refresh did not
change audited runtime paths, but the before/after samples use their respective
lockfiles. Ordinary timings are warm medians (five samples, nine for cold
launches, three for census); responsiveness and transfer are single samples.
Host load affects absolute times; these are not production latency guarantees.

| Probe | Baseline | Implemented result |
|---|---:|---:|
| Cold CLI help median | 133 ms | 54 ms |
| Queue / unsettled, 100,000 completed operations | 35.2 / 39.6 ms | Both <0.02 ms |
| Log/admission retention, same history | 259 ms | 0.19 ms |
| Empty live census, 100,000 stopped resources | Full historical decoding | 0.01 ms |
| Status with stopped resources | 72 ms at 10,000; refused above history bound | 3.48 ms at 100,000; complete count |
| Three supervised two-second sleeps | 33 `ps` calls; 1,679 ms synchronous `ps` time | 13 calls; 0 ms synchronous `ps` time; all releases confirmed |
| 8 MiB transfer, injected 50 ms acknowledgment latency | 34 single requests; 1.74 s | 10 windows; one session; 0.52 s |
| Activity payload, 200 completed operations | 291,201 bytes | 76,401 bytes; 73.8% smaller |

Timers continue through the one GiB hash and 128 MiB extraction. Final probes
sampled maximum timer gaps of 4.3 and 2.85 ms over 503 and 843 ms of wall time,
versus baseline synchronous work holding the thread for about 461 and
858–1,001 ms. Fresh 50,000-file census took a median 127 ms and a separate
responsiveness sample had a 2.52 ms maximum timer gap. It still traverses all
required files. Worker offloading preserves responsiveness without eliminating
the work. The injected transfer probe excludes real SSH, network and receiver
fsync cost; it proves fewer acknowledgment waits rather than a universal
throughput multiplier. The same final harness measured legacy transport at
1.77 s and negotiated transport at 0.52 s, with 34 frames in each case.

Measurement exposed SQLite choosing the history index despite a sparse live
index. Production queries now select the ownership index, and a regression
checks their actual plans. Complete validation exposed a native uniqueness
race across the storage await; the guard now runs with synchronous admission,
preserving replay and one pending repair. A transient unavailable process census
no longer permanently poisons later positive release evidence; persistent
failure and failed durable observer callbacks still prevent release. App-copy
permissions apply through retained descriptors. Authenticated CLI fixtures
prove that UUID history cursors survive parsing while event cursors remain
numeric.

## Verification and remaining qualification

Focused checks cover history scale, active/malformed ownership fences, file/
policy safety, crashes, transfer fallback/windows/fairness/cancellation,
artifact mutation, independent history restoration, backup redundancy and
pins introduced during asynchronous verification. Native build and all 26
Swift tests pass. `bash scripts/dev.sh check` passed all 504 engine/CLI tests,
seven secret-scanner tests, contract types, generated drift and foundation
alignment at `d5dcfa0`. The final cursor correction at `ded58ad` passed build
and 20 affected CLI/history/resource/policy tests. These counts describe
separate runs; overlapping focused runs are not added to the full-suite count.
The [verification receipt](verification/performance-improvements.json) records
exact source identities and aggregate measurements.

Real SSH negotiation, RTT/fsync throughput, macOS interaction profiling,
installed lifecycle and physical devices remain in the existing handoff.
Next, run a bounded disposable repository pilot to measure interaction latency
and transfer throughput on the actual installed hosts.
