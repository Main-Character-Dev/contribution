# Private peer protocol

The generic two-host implementation uses the installed `contribution peer --stdio` entry point over ordinary OpenSSH with noninteractive authentication, strict host-key verification, and bounded waits. The remote command is fixed; repository paths and source text travel only in structured stdin. SSH disconnect does not own the receiving service's operation. No real host was paired during development.

`hosts pair --ssh-alias ALIAS` verifies the Contribution host identity and compatible release. Configure the return route independently on the other host. Each host must explicitly enroll its own checkout of the logical repository. For an empty target, `repos add PATH --file POLICY.json` can enroll the exact shared policy without creating working files. The peer endpoint cannot choose arbitrary destination paths.

`repos pair --repo ID --host OWNER --request-id UUID` transfers a generic repository's canonical authority. It requires idle, clean, compatible enrollments and identical committed history or an unborn side. Contribution installs its matching publication guard while preserving any existing hook owner. The initiating writer is durably fenced before the receiver can activate. Monotonic authority epochs and predecessor identities reject replayed old activations. Retrying the same request after a lost acknowledgment reconciles the same transition. Unavailability never elects another owner. Existing projects remain blocked until their hook and writer adapters are adopted.

Before the initiating writer is disabled, `authority.prepare` retains the exact
destination reservation. The proposal and reservation survive lost replies and
prevent concurrent companion removal from stranding an ownership transition.
Activation consumes only its matching reservation. Older peers that do not
support preparation must be updated; there is no unreserved fallback. A retained
proposal cannot select different history or policy under the same request.

Generic companion removal uses `authority.release-mirror` after its local
removal fence is durable. The canonical host retains the exact release and its
owner epoch while switching to local-only availability. Historical release
replies never mutate newer authority. The companion preserves that epoch after
unenrollment, and reenrollment cannot independently grant itself writer rights.
See [repository removal](REPOSITORY_REMOVAL.md) for recovery and exclusions.

`repos seed` retains the initial history for an unborn canonical target. Ordinary `submit` retains the exact completed source, declared base, attribution and policy. Each outbox has a retained ref, bundle and digest. A transfer uses an immutable manifest, bounded 256 KiB chunks, fsynced offsets and an exact receipt. A logical submission identity is independent of its transport identity; replacing a bundle to supply prerequisites cannot create another landing. Total Git bundle size is currently bounded to 256 MiB. Larger repositories need an explicit bounded transfer extension rather than silent truncation.

The receiver verifies size, SHA-256, object format, the sole declared ref, prerequisites, complete ordinary Git history, attribution and policy before admission. It imports only into a dedicated incoming namespace. It never executes an incoming tree to inspect it. Shallow history, submodules and Git LFS remain explicit generic-adapter limitations. The canonical journal and source ref precede acknowledgment; duplicate receipt delivery returns the original operation.

Completion has a separate acknowledgment exchange. A terminal success, failure
or cancellation offers an exact operation/attempt/result digest. The sender
retains that response and its acknowledgment outbox in one SQLite transaction
before confirming receipt to the execution host. The receiver accepts only the
original authenticated sender and exact current completed result. Uncertain,
interrupted and unfinished results cannot release this protection.

A lost acknowledgment reply leaves the sender's evidence protected. A bounded
background retry resumes the same digest after journal reopening without
repeating integration, publication or a device effect. Only twenty due
acknowledgments are selected per pass, with backoff on failure. Normal pause and
maintenance defer retries. Older compatible peers that do not offer completion
receipts keep evidence protected until an explicit new observation through a
compatible implementation. Operation responses expose `peerCompletion` state.

The receiver keeps immutable acknowledgment history and binds retention to its
current result. Log/output-expiration annotations do not change that result
identity, so losing a reply cannot make the acknowledgment unrecoverable after
eligible raw output expires. Changed actual results require a new observation.
Canonical-owner transfer checks both hosts for pending receipt exchange before
fencing. A frozen transition still permits the original authenticated sender to
finish its retained acknowledgment; doing so grants no writer authority. This
exchange makes otherwise eligible logs and owned output eligible for their
existing retention policies. Completed successful bundle copies can now use the
separate [reviewed bundle cleanup](STORAGE_RETENTION.md#completed-git-transfer-copies).
Source refs and Git objects remain retained; acknowledgment never releases them.

Seed and mirror capture durably select their commit, clone, configuration, authority, destination and transfer identity before creating the source ref or bundle. An interrupted capture reuses that selection even if the primary has advanced. Source refs use compare-and-swap creation; unexpected replacement is preserved and stops recovery. Bundles are hashed in at most 1 MiB buffers and sent in 256 KiB chunks through one verified descriptor. Rewriting, replacement, new hard links or containing-path changes stop transfer before completion. The receiver also checks the imported ref against the declared tip after fetch.

Bundle creation uses Git's documented binary stdout form, `git bundle create - REF`, with a 256 MiB sink and a five-minute deadline. Binary content is never decoded into logs. The private producer retains an attempt before writing, seals its size/digest, and publishes through an atomic no-replace link. Recovery verifies both names before removing only the owned partial name, including a crash on either side of link/unlink. Failed output retention stops the child and preserves the bounded partial and source ref. Same-source retries use separate retained partials and recheck managed-storage admission. Foreign destinations are preserved. See the [Git bundle documentation](https://git-scm.com/docs/git-bundle) for the stdout transport; larger bundles remain an explicit unsupported size, not truncated success.

Task capture also records validated source eligibility before retention effects. If capture stops before operation admission, `submit --repo ID --request-id UUID --resume` resumes that exact source, base and metadata. It cannot accept replacement selections. A later task commit or dirty draft stays in the original checkout while the selected range is retained. Clone, authority or policy changes still stop recovery. Errors identify a retained continuation separately from completed admission, including maintenance refusals; seed/mirror continuation uses its original command and request ID. Concurrent retries serialize by request. Once admitted, replay returns the original operation even after a later policy change, while changed caller input still conflicts.

`repos mirror` sends canonical history to the companion. Successful task landing also schedules a retained mirror transfer. Mirror promotion requires its configured branch, clean index/worktree, a local lease and fast-forward ancestry; ignored-file overwrite is prohibited. Dirty or divergent mirrors retain both histories. Seed promotion additionally requires an unborn target with no conflicting files. Neither operation publishes to GitHub.

Companion `push --preview` queries the canonical service. The selected tip/token then authorizes only that immutable publication through the canonical queue. Companion hooks refuse direct publication. `checks run --canonical` also selects the owner's checkout; an unavailable owner never substitutes the local mirror. The companion retains the owner operation identity, bounded cached logs and observation time. Remote waiting, attention and uncertain results remain visible. Cancellation and explicit reconciliation forward to the owning service; a lost reply cannot be treated as proof of cancellation.

The schema-v1 peer implementation negotiates explicit protocol/request-schema version 1 with the same minor release and an adjacent patch release. Every message rechecks compatibility, so replacing a peer cannot rely on stale handshake state. A legacy handshake without explicit protocol fields is accepted only for this exact release. Incompatible major/minor, non-adjacent patch, prerelease or protocol/schema versions block before execution. This is fixture qualification of the compatibility contract; two separately packaged released versions still need release qualification.

`tests/peers.test.mjs` exercises two separate journals and real disposable Git clones through public engine dispatch, with an injected transport standing in for SSH. It covers first history, detached dirty source, lost receipt, unavailable owner, divergent histories, multi-chunk transfer, unsafe mirrors, lost authority reply and replay rejection. `tests/process.test.mjs` checks owned cancellation after a shell leader exits. These fixtures do not prove real SSH configuration, laptop sleep, peer service installation, physical host recovery or migrated-project parity.

## Selected-host device requests

Named device operations and device/profile/artifact observations now use the same authenticated paired-host envelope. The execution host may differ from the canonical Git owner. The receiving service enforces its own project/app profile, grants, capability/context, signing/artifact checks and ownership. The remote endpoint cannot authorize new scope, configure arbitrary commands or open an unrestricted shell.

Before durable remote admission, the caller freezes the selected host's effective device-policy revision. A cached previously observed revision supports offline queueing; a caller with no prior profile observation must obtain one first. Target-side policy drift rejects that immutable request before effects. Local durable acceptance and execution-host acceptance remain distinct, without canonical-Git acceptance fields. Remote observations and cached logs preserve the actual operation and origin host.

A lost admission reply reuses the original request ID and does not install again. Cancellation with uncertain admission queries the target's durable request record. If no operation exists, the target records a cancellation fence so a delayed original message cannot start one later. If a queued/running operation already exists, cancellation is routed to that owner and retains actual effect certainty. This cancellation boundary also applies to core publication and handoff outboxes. It never submits fresh work merely to cancel it.

Paused outboxes do not start remote work. Device setup/qualification blockers do not hold unrelated Git queues; the target's per-device guards remain authoritative for physical contention and uncertainty. Private outbox metadata and operation admission now commit in one SQLite transaction. Seven selected-host fixtures plus existing peer/cancellation tests cover this implemented boundary. Real SSH and physical qualification remain outstanding.

## Device ownership relinquishment

The fixed `device.ownership.accept` endpoint accepts only a schema-checked release from the associated repository peer to this exact destination and evidence mode. It retains the authenticated immutable receipt before checking destination readiness. Caller input can select a previously retained release reference but cannot import an arbitrary receipt. Old accepted releases return their historical acknowledgment without rewriting current ownership. The monotonic chain uses exact prior/current ownership revisions; no timer elects an owner. See [device execution](DEVICE_EXECUTION.md) for recovery and remaining native proof.

Initial publication-hook adoption is not permission to move an adopted project's canonical owner. Existing native landing entry points and older task checkouts still need a qualified persistent authority fence. Both the source `repos pair` route and destination authority activation therefore refuse adopted adapters with `ADOPTED_AUTHORITY_MIGRATION_REQUIRED`. Generic transfers also preserve unknown legacy/generic writer directories and recovery boundaries instead of treating an unreadable owner as idle. Nine peer fixtures pass with these guards. Completing the adopted writer cutover remains implementation work, not a hardware-only acceptance item.

Incoming Git transfers record their private file and parent identity before acknowledging any bytes. Bounded descriptor writes refuse replacement, symbolic/shared files and changed private ownership; a partially written chunk resumes only when its retained prefix matches. Unknown pre-existing paths and older partial rows without ownership identity remain available for explicit reconciliation. At most three unfinished transfers per repository and one GiB of outstanding Git reservations are admitted. Historical completion receipts remain readable independently of later payload retention.
