# Private go-ios research transport

This directory contains Contribution-owned MIT source overlaid into a disposable copy of the checksum-pinned upstream module. It contains no private project source, pairing record, key or physical-device evidence. Upstream licenses are retained by the builder.

Build without executing the resulting backend:

```sh
python3 scripts/build-go-ios.py /absolute/new/output --private-transport
```

The builder verifies the original module/revision, patches only exact expected source seams, runs the five named `TestContribution...` transport tests, builds the Darwin arm64 executable and collects all linked notices. Each changed source file has before/after hashes in the output manifest. The module cache is never edited. Omit the option to reproduce the original unmodified research binary.

The overlay replaces the tunnel-control network listener with an authenticated Unix socket inside an owned canonical 0700 directory. Its 0600 `session.key` must contain exactly 32 random bytes. Both control and loopback data connections use fresh challenges and role-separated HMAC authentication; the key is never sent on the wire. Control clients cannot select a network destination. A retained socket is preserved for reconciliation, not unlinked on startup.

The executable refuses commands except explicit per-device userspace tunnel start, private tunnel listing, selected tunnel stop and private agent stop. Startup requires the exact owned 0700 pairing directory. Default Apple record paths, kernel tunnel startup, automatic agent startup, repeated tunnel polling/reconnection, diagnostics listeners and inherited backend route overrides are disabled. One explicit start makes one tunnel update pass. This is a research command boundary, not an app/device authorization grant.

The five tests exercise key permissions/links, incorrect clients, server impersonation, private socket routing, retained socket preservation and command refusal. They use temporary state, local sockets and in-memory pipes. They do not enumerate, pair, connect or operate an iPhone.

The output remains excluded from the app payload. Product dispatch, session supervision and restart reconciliation, independent trust/bootstrap, actual remote transport, cold cellular and each device operation remain unfinished or unqualified. See [backend investigation](../../docs/GO_IOS_BACKEND.md). No persistent state or tunnel has been created on either real host.
