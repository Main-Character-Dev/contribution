import AppKit
import SwiftUI
import UniformTypeIdentifiers
import ContributionPlatform

struct DiagnosticsSheet: View {
    let client: ServiceClient
    var operationID: String?
    var localDetails: JSONValue = .null
    @Environment(\.dismiss) private var dismiss
    @State private var report: JSONValue = .null
    @State private var loading = true
    @State private var error = ""
    @State private var showLocalDetails = false
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack { Text("Diagnostics").font(.title2.bold()); Spacer(); Button("Done") { dismiss() }.keyboardShortcut(.cancelAction) }
            Text("Sharing includes a redacted summary from this Mac. Project names, paths, device and network identities, raw logs and app data are omitted.").font(.callout).foregroundStyle(.secondary)
            if loading { ProgressView("Preparing summary…") }
            if !error.isEmpty { Text(error).foregroundStyle(.orange).textSelection(.enabled) }
            ScrollView { Text(showLocalDetails ? localDetails.formatted : report == .null ? "No summary available" : report.formatted).font(.callout.monospaced()).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading) }
            if localDetails != .null {
                Toggle("Show private local details", isOn: $showLocalDetails)
                if showLocalDetails { Text("Private details are for local inspection. The sharing buttons still use the redacted summary.").font(.caption).foregroundStyle(.secondary) }
            }
            HStack {
                Button("Copy redacted summary") { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(report.formatted, forType: .string) }
                Button("Export redacted summary…") { export() }
            }.disabled(loading || report == .null)
        }.padding(20).frame(width: 680, height: 550)
            .task(id: operationID) { await load() }
    }
    private func load() async {
        loading = true; report = .null; error = ""; showLocalDetails = false
        do {
            let args: [String: JSONValue] = operationID.map { ["operationId": .string($0)] } ?? [:]
            let response = try await client.request("service.diagnostics", args: args)
            guard !Task.isCancelled else { return }
            if let failure = response.fields["error"], failure != .null { error = failure.object["message"]?.text ?? "Diagnostic summary unavailable" }
            else if let summary = response.fields["result"]?.object["diagnostics"], summary.object["privacy"]?.text == "allowlisted_summary" { report = summary }
            else { error = "The service did not return a redacted summary." }
        } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
        if !Task.isCancelled { loading = false }
    }
    private func export() {
        let panel = NSSavePanel(); panel.nameFieldStringValue = "contribution-diagnostics.json"; panel.allowedContentTypes = [.json]
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do { try report.formatted.write(to: url, atomically: true, encoding: .utf8) }
        catch { self.error = error.localizedDescription }
    }
}
