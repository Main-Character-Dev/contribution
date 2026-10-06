# Connectivity implementation

Authorized October 6, 2026 against `b27a803`. [The canonical amendment](requirements/10-VPN_CONNECTIVITY.md) owns the requirements. Implementation and proof are being recorded here; no actual Mac/VPN compatibility is yet qualified.

## Refreshed gap map

| Requirement | Reused boundary | Missing at baseline |
| --- | --- | --- |
| VPN-01–03 | Engine, peer SSH, host IDs, strict trust | Read-only health, IPv6, current evidence |
| VPN-04–05 | Faults, bounded processes, local diagnostics | Structured classifications and optional provider facts |
| VPN-06 | Existing tick and durable journal | Host retry budget, fair peers, background event hints |
| VPN-07 | Request IDs, transfers, receipts, cancellation | Canonical-check intent before send and acceptance lookup |
| VPN-08–10 | Allowlisted export, shared IPC, local checks | Same native/CLI host status and independent dependency evidence |
| VPN-11 | Canonical schemas and additive amendments | Journal v3 fence and monotonic version writes |
