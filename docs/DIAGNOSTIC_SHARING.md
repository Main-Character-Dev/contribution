# Diagnostic sharing

`contribution service diagnostics --json` returns a redacted summary of the local service and its latest 200 retained operations. `--run OPERATION_UUID` selects one retained operation. This read-only command remains available during maintenance and does not contact peers, GitHub, Apple services or a phone. The CLI prints the response; saving or sharing it is an explicit user action.

The native diagnostic sheet opens from an operation or Settings → Setup. It previews the same summary and provides Copy redacted summary and Export redacted summary actions. Exact operation details remain available through a separate local-inspection toggle. The sharing buttons always use the redacted summary, even while private details are visible. A save panel selects the export destination.

General sharing uses a field allowlist rather than attempting to redact every possible private record. It retains product/runtime versions, service state, raw-log and managed-data usage, enumerated adapter/availability/gate states and bounded operation/effect outcomes. Report-local aliases associate attempts with projects without exporting stable request, operation, repository, host or device identifiers. Unknown categorical values become `unknown`; arbitrary error text, arguments, paths, network endpoints, signing/pairing material, raw logs, screenshots, app contents and free-form evidence are omitted entirely. History and collection limits are explicit.

Fixture and observed device receipts remain distinguishable. A readback-presence field describes retained structure and is not verification of that readback. The report explicitly states that it is neither physical qualification nor publication proof. Exact evidence, privacy-sensitive project versions and operational repair details remain in the controlled journal and local views.

Raw log export is a separate explicit operation. It preserves the selected output, which can contain project content; it is not the general redacted diagnostic summary.

Three focused tests in `tests/diagnostics.test.mjs` cover injected private strings across records, stable-identity omission, inactive/uncertain states, bounded history, maintenance reads, and the installed CLI route. The native sheet compiles unsigned. Clipboard, save-panel and accessibility interaction remain unrun.
