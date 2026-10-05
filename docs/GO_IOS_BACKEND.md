# Pinned remote backend investigation

The D0 prototype uses the exact revision and module checksums in [config/go-ios.json](../config/go-ios.json). `python3 scripts/build-go-ios.py /absolute/new/output` builds a scoped Darwin arm64 binary with Go 1.26.5, CGO disabled, readonly module resolution and Go's checksum database enabled. It does not run the binary, alter global tools, start a tunnel or access pairing records. `GOWORK=off` is deliberate: the upstream workspace names nested modules that are absent from its published root-module archive.

The output contains the executable, Go build metadata, a SHA-256 file manifest, the Go runtime license, and notices from the 30 linked modules. The observed top-level texts use MIT, BSD-family, Apache-2.0 or mixed permissive notices. The complete copied texts, not that shorthand, govern redistribution. Dependency versions and checksums are retained in the generated manifest. The binary remains excluded from the Contribution product payload; the present output is an engineering prototype, not a qualified remote-device backend.

## Constraints found in unmodified pinned source

- The userspace tunnel route avoids the native tunnel's privilege requirement for its supported OS path. This does not prove the selected phone/host combination or fresh cellular bootstrap.
- The tunnel manager enumerates usbmux devices. Discovery of a previously connected phone is not proof of an independent cold cellular route.
- The tunnel information server exposes unauthenticated loopback HTTP control, including shutdown, and the userspace tunnel exposes an unauthenticated loopback TCP proxy. Contribution cannot treat either as its authenticated control boundary. An isolated owned adapter transport remains required before adoption.
- The default pairing-record option points at Apple-owned trust data. Contribution must use private, independently approved trust state, never copy Apple records or weaken their ownership. Upstream writes some pairing files with broad modes, so directory and file permissions also need enforcement in the owned adapter.
- Upstream commands include device erasure, profile installation and other actions beyond the product contract. The adapter must expose fixed scoped operations, never arbitrary CLI arguments or automatic recovery commands.
- Some older native-tunnel paths describe privileged interruption of Apple's `remoted`. That is not an approved automatic action. Failure of the safe userspace route remains a named limitation.

No device, tunnel, pairing or privileged operation was performed during this build. An earlier explicit `version` probe returned `local-build` and checked for a local tunnel agent; subsequent build verification reads Go metadata without executing the backend. The source pin and checksum receipt identify the prototype more precisely than that upstream version string.

Sources inspected: [pinned go.mod](https://github.com/danielpaulus/go-ios/blob/273d3e06e803fb6ee95e4df914d8be82c5ee4bb0/go.mod), [tunnel command](https://github.com/danielpaulus/go-ios/blob/273d3e06e803fb6ee95e4df914d8be82c5ee4bb0/cmd_tunnel.go), [tunnel manager and HTTP API](https://github.com/danielpaulus/go-ios/blob/273d3e06e803fb6ee95e4df914d8be82c5ee4bb0/ios/tunnel/tunnel_api.go), and [userspace transport](https://github.com/danielpaulus/go-ios/blob/273d3e06e803fb6ee95e4df914d8be82c5ee4bb0/ios/tunnel/userspace_tunnel.go).

Local build evidence on 2026-10-05: two fresh output directories produced the same executable SHA-256, `2921a8b6c6cbff817f4e3b2bef3f8dc0800382926be3d2284b126047454283d6`, with 30 linked module notice sets. This establishes repeatability on the current toolchain/host, not cross-host reproducibility or runtime support.

## Private transport overlay

The [Contribution transport overlay](../backends/go-ios/README.md) now builds against that same verified pin using `--private-transport`. It replaces the control listener with mutually authenticated private Unix IPC and adds mutual challenge/HMAC authentication to the loopback data proxy. It rejects shared/linked keys, preserves unknown retained sockets, disables automatic agent startup and repeated reconnect passes, and restricts the research command entry point to explicit per-device userspace tunnel operations. Kernel startup and Apple's default pairing-file path are refused. The complete before/after source hashes and notices are retained in its build manifest.

Five named Go transport tests passed in the copied upstream package using only temporary state, in-memory pipes and local sockets. The isolated bounded build produced executable SHA-256 `3ebf17076990b231bcda99b3ec5df53b0bfb1315ae96a7036861ba01a3b3f431` with 30 linked notice sets. The resulting backend executable was not run. Its source entry gate, transport authentication and command restrictions are fixture/build proof, not a physical capability.

The default app still uses its conservative CoreDevice adapter. The private research backend is not in the product payload and does not yet have the service's scoped per-app dispatcher, session supervisor, native-session attribution or physical ownership/bootstrap integration. The userspace path still depends on upstream device discovery and approved existing trust; these changes do not establish a cold cellular route. The hardware session and operation-specific investigation remain required.

## Service control client

The internal TypeScript `PrivateBackendControl` client now authenticates the exact retained Unix endpoint using the overlay's challenge, nonce and role-separated HMAC exchange. It binds directory/socket/key identities, rechecks them after authentication and response, and uses one connection per fixed GET. Authentication has a three-second deadline; each response has a ten-second deadline, 16 KiB header limit and 64 KiB body limit. Cancellation closes that exact connection. There is no retry, redirect, network fallback, discovery request or mutation endpoint.

The returned scope is explicitly `selected_private_backend_only`: backend readiness, a matching userspace tunnel, or a selected 404 never proves external-session absence, physical trust, developer readiness or cold-cellular support. Unknown fields, wrong device/transport, invalid endpoints, server errors and changed credentials refuse a successful observation. The client is not yet wired into product device dispatch or a session supervisor.

`python3 scripts/check-backend-control.py` builds only the Contribution Go transport source plus a synthetic HTTP fixture using the pinned Go toolchain. It does not link the upstream device library. The actual Go overlay and TypeScript client passed ready, not-ready and selected-not-found interoperability cases over temporary Unix sockets. Separate Node fixtures cover forged authentication, partial/truncated output, chunked responses, bounds, cancellation and identity changes. No go-ios device executable or phone was used.
