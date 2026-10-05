# Persistent legacy writer boundary

The four preserved project workers acquire `primary-checkout-mutation.lock` before promoting their primary. Their original lease implementations may reclaim an owner after its process exits. A service-owned lease alone therefore cannot fence a companion across service shutdown or restart.

`LegacyAuthorityFence` implements a macOS persistent companion boundary using an owned legacy lease directory and the filesystem's user immutable flag. Its `owner.json` retains the real creator's PID and process start identity. It does not invent a live process, rely on elapsed time, or alter a foreign lease. The journal retains intent before acquisition, exact directory/file identities before flagging, and a confirmed fence receipt afterward. A lost or changed fence stops recovery.

Only an active canonical transition for this exact host can release the fence. Release intent precedes clearing the owned flag. The existing legacy recovery lock excludes concurrent stale-owner reclamation during completion. Missing, replaced, linked, foreign or unexpectedly populated directories remain preserved. A crash that leaves an unconfirmed recovery lock still requires inspection; a timeout is not permission to remove it. Filesystem flags are changed only on the exact lease directory created for this purpose.

This is an internal primitive, not an enabled owner-transfer route. Both adopted `repos pair` and incoming adopted activation remain blocked until the complete cooperating-writer census, reviewed adapter qualification, peer activation/recovery integration and adopted cross-host registration are in place. No live project was fenced during development.

## Evidence and limits

Four focused fixture groups exercise actual macOS flags, child-process exit, journal reopening, flag/receipt crash windows, unauthorized release, identity replacement and foreign recovery state. The existing legacy lease tests also pass. A separate disposable probe imported all four current original lease modules: each failed with `EPERM` while preserving the historical owner after its creator exited. This proves those modules cannot reclaim that immutable directory; it does not qualify every historical worker or a physical reboot on both Macs.

A Git reference-transaction hook was also tested and rejected as the sole fence. It prevented the ref update but a failed fast-forward had already changed primary working files. That hook must not be treated as proof that an old worker cannot begin primary mutation.

No live ownership transfer, installation, project enrollment, filesystem flag change in a real project, or device action has been performed. Real host reboot and filesystem qualification remain distinct from disposable fixture proof.
