import AppKit
import SwiftUI
import Observation
import ContributionPlatform

@MainActor @Observable private final class Workspace {
    let client = ServiceClient()
    var repositories: [JSONValue] = []
    var operations: [JSONValue] = []
    var selectedRepository: String?
    var selectedOperation: String?
    var service = "Connecting…"
    var error: String?
    var paused = false
    var detail: JSONValue = .null
    var log = ""
    var search = ""
    var busy = false
    var preview: PublicationPreview?
    func call(_ command: String, _ args: [String: JSONValue] = [:]) async -> ResponseEnvelope? {
        do {
            let response = try await client.request(command, args: args)
            if case .object(let failure) = response.fields["error"] { error = failure["message"]?.text; return nil }
            return response
        } catch { self.error = error.localizedDescription; return nil }
    }
    func refresh() async {
        guard !busy else { return }; busy = true; defer { busy = false }
        if let response = await call("service.status") {
            let result = response.fields["result"]?.object ?? [:]; service = result["state"]?.text ?? "Unknown"; paused = result["paused"]?.boolean ?? false
        } else { service = "Service unavailable"; return }
        if let response = await call("repos.list") { repositories = response.fields["result"]?.object["repositories"]?.array ?? [] }
        if let response = await call("runs.list") { operations = response.fields["result"]?.object["operations"]?.array ?? [] }
        await loadSelection()
    }
    func loadSelection() async {
        guard let selectedOperation else { detail = .null; log = ""; return }
        if let response = await call("runs.get", ["operationId": .string(selectedOperation)]) { detail = .object(response.fields) }
        if let response = await call("logs", ["operationId": .string(selectedOperation), "tail": .number(2000)]) { log = response.fields["result"]?.object["text"]?.text ?? "" }
    }
    func addRepository() async {
        let panel = NSOpenPanel(); panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.allowsMultipleSelection = false
        guard panel.runModal() == .OK, let url = panel.url else { return }
        _ = await call("repos.add", ["path": .string(url.path)]); await refresh()
    }
    func previewPush() async {
        guard let selectedRepository, let response = await call("push", ["repo": .string(selectedRepository), "preview": .bool(true)]), let result = response.fields["result"] else { return }
        preview = PublicationPreview(repository: selectedRepository, fields: result)
    }
    func publish(_ preview: PublicationPreview) async {
        let fields = preview.fields.object
        if let response = await call("push", ["repo": .string(preview.repository), "expectedTip": fields["expectedTip"] ?? .null,
            "scopeToken": fields["scopeToken"] ?? .null, "requestId": .string(UUID().uuidString)]) { selectedOperation = response.operationID }
        self.preview = nil; await refresh()
    }
    func operationAction(_ action: String) async {
        guard let selectedOperation else { return }
        _ = await call(action, ["operationId": .string(selectedOperation)]); await refresh()
    }
}
private struct PublicationPreview: Identifiable {
    let id = UUID(), repository: String, fields: JSONValue
}

@main struct ContributionApp: App {
    @State private var workspace = Workspace()
    var body: some Scene {
        Window("Contribution", id: "main") { WorkspaceView(workspace: workspace) }.defaultSize(width: 1120, height: 720)
        MenuBarExtra("Contribution", systemImage: "arrow.triangle.branch") { ContributionMenu(workspace: workspace) }
        Settings { ContributionSettings(workspace: workspace) }
    }
}
private struct WorkspaceView: View {
    @Bindable var workspace: Workspace
    var body: some View {
        NavigationSplitView {
            List(selection: $workspace.selectedRepository) {
                Text("All repositories").tag(nil as String?)
                Section("Repositories") {
                    ForEach(workspace.repositories, id: \.identity) { repo in
                        Label(repo.object["config"]?.object["name"]?.text ?? "Repository", systemImage: "folder")
                            .tag(repo.object["id"]?.text as String?)
                    }
                }
            }
            .safeAreaInset(edge: .bottom) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(workspace.paused ? "Processing paused" : workspace.service).font(.caption).foregroundStyle(.secondary)
                    Button("Add repository", systemImage: "plus") { Task { await workspace.addRepository() } }
                }.padding()
            }
            .navigationSplitViewColumnWidth(min: 190, ideal: 230)
        } content: {
            List(selection: $workspace.selectedOperation) {
                ForEach(workspace.operations.filter { workspace.selectedRepository == nil || $0.object["repositoryId"]?.text == workspace.selectedRepository }, id: \.identity) { operation in
                    OperationRow(operation: operation).tag(operation.object["operationId"]?.text as String?)
                }
            }
            .overlay { if workspace.operations.isEmpty { ContentUnavailableView("No recorded operations", systemImage: "clock", description: Text("Completed work and explicit pushes will appear here.")) } }
            .navigationTitle("Activity")
            .toolbar {
                Button("Refresh", systemImage: "arrow.clockwise") { Task { await workspace.refresh() } }.disabled(workspace.busy)
                Button("Preview Push", systemImage: "arrow.up.circle") { Task { await workspace.previewPush() } }.disabled(workspace.selectedRepository == nil)
            }
        } detail: {
            OperationDetail(workspace: workspace)
        }
        .safeAreaInset(edge: .top) {
            if let error = workspace.error {
                HStack { Image(systemName: "exclamationmark.circle"); Text(error); Spacer(); Button("Dismiss") { workspace.error = nil } }
                    .padding(10).background(.orange.opacity(0.12)).accessibilityIdentifier("contribution.error")
            }
        }
        .task { while !Task.isCancelled { await workspace.refresh(); try? await Task.sleep(for: .seconds(2)) } }
        .task(id: workspace.selectedOperation) { await workspace.loadSelection() }
        .sheet(item: $workspace.preview) { preview in PublicationSheet(workspace: workspace, preview: preview) }
    }
}
private struct OperationRow: View {
    let operation: JSONValue
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(operation.object["kind"]?.text.replacingOccurrences(of: "_", with: " ").capitalized ?? "Operation").font(.headline)
            Text(operation.object["state"]?.text.replacingOccurrences(of: "_", with: " ") ?? "Unknown").foregroundStyle(.secondary)
            Text(operation.object["createdAt"]?.text ?? "").font(.caption).foregroundStyle(.secondary)
        }.padding(.vertical, 4)
    }
}
private struct OperationDetail: View {
    @Bindable var workspace: Workspace
    @State private var showDiagnostics = false
    var body: some View {
        if let selected = workspace.selectedOperation {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text(workspace.detail.object["operationState"]?.text.replacingOccurrences(of: "_", with: " ").capitalized ?? "Loading…").font(.title2)
                    Spacer()
                    Menu("Actions") {
                        Button("Cancel operation") { Task { await workspace.operationAction("runs.cancel") } }
                        Button("Pin evidence") { Task { await workspace.operationAction("runs.pin") } }
                        Button("Unpin evidence") { Task { await workspace.operationAction("runs.unpin") } }
                        Button("Copy log") { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(workspace.log, forType: .string) }
                        Button("Export log…") { exportLog() }
                        Button("Show diagnostics") { showDiagnostics = true }
                    }
                }
                Text(selected).font(.caption.monospaced()).foregroundStyle(.secondary).textSelection(.enabled)
                if let result = workspace.detail.object["result"] {
                    HStack { Text("Stage: \(result.object["stage"]?.text ?? "Unknown")"); Spacer(); Text("Delivery: \(result.object["delivery"]?.text ?? "Not requested")") }.font(.caption)
                }
                TextField("Search retained log", text: $workspace.search).textFieldStyle(.roundedBorder)
                ScrollView([.vertical, .horizontal]) {
                    Text(workspace.log.split(separator: "\n", omittingEmptySubsequences: false).filter { workspace.search.isEmpty || $0.localizedCaseInsensitiveContains(workspace.search) }.joined(separator: "\n"))
                        .font(.system(.body, design: .monospaced)).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading).padding(12)
                }.background(.quaternary.opacity(0.3)).accessibilityIdentifier("contribution.log")
                Text("Showing up to 2,000 retained lines. Closing this window leaves accepted work running.").font(.caption).foregroundStyle(.secondary)
            }.padding()
            .sheet(isPresented: $showDiagnostics) { DiagnosticsSheet(value: workspace.detail) }
        } else { ContentUnavailableView("Select an operation", systemImage: "list.bullet.rectangle", description: Text("Inspect its progress, delivery evidence, and retained output.")) }
    }
    private func exportLog() {
        let panel = NSSavePanel(); panel.nameFieldStringValue = "contribution-log.txt"
        if panel.runModal() == .OK, let url = panel.url { do { try workspace.log.write(to: url, atomically: true, encoding: .utf8) } catch { workspace.error = error.localizedDescription } }
    }
}
private struct PublicationSheet: View {
    @Bindable var workspace: Workspace
    let preview: PublicationPreview
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        let scope = preview.fields.object["scope"]?.object ?? [:]
        VStack(alignment: .leading, spacing: 16) {
            Text("Publish selected work").font(.title2)
            LabeledContent("Branch", value: scope["branch"]?.text ?? "Unknown")
            LabeledContent("Destination", value: scope["ref"]?.text ?? "Unknown")
            LabeledContent("Commit", value: scope["tip"]?.text ?? "Unknown")
            Text("This request publishes this exact selection. Later commits require a new preview.").foregroundStyle(.secondary)
            HStack { Button("Cancel") { dismiss() }; Spacer(); Button("Push") { Task { await workspace.publish(preview) } }.buttonStyle(.borderedProminent) }
        }.padding(24).frame(width: 560)
    }
}
private struct DiagnosticsSheet: View {
    let value: JSONValue
    @Environment(\.dismiss) private var dismiss
    var body: some View { VStack { ScrollView { Text(value.formatted).font(.body.monospaced()).textSelection(.enabled) }; Button("Done") { dismiss() } }.padding().frame(width: 650, height: 480) }
}
private struct ContributionMenu: View {
    @Bindable var workspace: Workspace
    @Environment(\.openWindow) private var openWindow
    var body: some View {
        Text(workspace.paused ? "Processing paused" : workspace.service)
        Button("Open Contribution") { openWindow(id: "main"); NSApplication.shared.activate(ignoringOtherApps: true) }
        Button(workspace.paused ? "Resume processing" : "Pause processing") { Task { _ = await workspace.call(workspace.paused ? "service.resume" : "service.pause"); await workspace.refresh() } }
        SettingsLink()
        Divider()
        Button("Quit interface") { NSApplication.shared.terminate(nil) }.keyboardShortcut("q")
    }
}
private struct ContributionSettings: View {
    @Bindable var workspace: Workspace
    @State private var registration = ServiceRegistration.status
    var body: some View {
        Form {
            Section("Background service") {
                LabeledContent("Registration", value: registration)
                Button("Register bundled service") { do { try ServiceRegistration.register(); registration = ServiceRegistration.status } catch { workspace.error = error.localizedDescription } }
                Button("Open Login Items settings") { ServiceRegistration.openSettings() }
                Text("Registration needs the packaged app. Signing, background approval, and actual login behavior remain installation checks.").font(.caption).foregroundStyle(.secondary)
            }
            Section("Version") { LabeledContent("Contribution", value: BuildIdentity.version); Text("Development build · Remote device capabilities remain unverified").foregroundStyle(.secondary) }
        }.formStyle(.grouped).padding().frame(width: 540)
    }
}
