import AppKit
import SwiftUI
import ContributionPlatform

struct RepositoryDiscoverySheet: View {
    @Bindable var workspace: Workspace
    @Environment(\.dismiss) private var dismiss
    @State private var root = ""
    @State private var scanID = UUID()
    @State private var result: RepositoryDiscovery?
    @State private var scanning = false
    @State private var adding: String?
    @State private var scanError: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Find repositories").font(.title2.bold())
            Text("Choose a folder to scan, then add the projects you want Contribution to track.").foregroundStyle(.secondary)
            HStack {
                Text(root.isEmpty ? "No folder selected" : root).lineLimit(2).textSelection(.enabled)
                Spacer()
                Button("Choose folder…") { chooseFolder() }.disabled(adding != nil)
                Button("Scan again", systemImage: "arrow.clockwise") { scanID = UUID() }.disabled(root.isEmpty || scanning || adding != nil)
            }
            if scanning { ProgressView("Finding Git repositories…") }
            if let result {
                ForEach(result.notices, id: \.self) { Text($0).font(.callout).foregroundStyle(.orange) }
                if result.repositories.isEmpty { Text("No repositories found within this scan. Choose a project folder directly or scan another location.").foregroundStyle(.secondary) }
                List(result.repositories) { repository in
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(repository.name).font(.headline)
                            Text(repository.historyLabel).font(.caption).foregroundStyle(.secondary)
                            Text(repository.path).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                        }
                        Spacer()
                        if enrolled(repository) { Label("Added", systemImage: "checkmark.circle").foregroundStyle(.secondary) }
                        else if adding == repository.id { ProgressView().controlSize(.small) }
                        else { Button("Add") { Task { await add(repository) } }.disabled(repository.branch == nil || adding != nil || workspace.sending || workspace.pendingRequest != nil) }
                    }.padding(.vertical, 5)
                }.frame(minHeight: 170)
            } else if !scanning { Spacer(minLength: 25) }
            if let scanError { Text(scanError).foregroundStyle(.orange).textSelection(.enabled) }
            Text("Adding registers the existing checkout on this Mac. Its current policy is preserved; projects with existing checks need a separate migration review.").font(.caption).foregroundStyle(.secondary)
            HStack { Spacer(); Button("Done") { dismiss() }.keyboardShortcut(.cancelAction).disabled(adding != nil) }
        }.padding(24).frame(width: 640, height: 480)
            .interactiveDismissDisabled(adding != nil)
            .task(id: scanID) { await scan() }
    }
    private func enrolled(_ repository: DiscoveredRepository) -> Bool {
        workspace.repositories.contains { $0.object["commonDir"]?.text == repository.commonDirectory }
    }
    private func chooseFolder() {
        let panel = NSOpenPanel(); panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.allowsMultipleSelection = false
        panel.title = "Choose a folder to scan"
        if panel.runModal() == .OK, let url = panel.url { root = url.path; result = nil; scanID = UUID() }
    }
    private func scan() async {
        guard !root.isEmpty else { return }
        let generation = scanID, folder = root; scanning = true; result = nil; scanError = nil
        defer { if generation == scanID { scanning = false } }
        do {
            let response = try await workspace.client.request("repos.discover", args: ["root": .string(folder)])
            guard !Task.isCancelled, generation == scanID, folder == root else { return }
            if case .object(let error) = response.fields["error"] { scanError = error["message"]?.text ?? "The selected folder could not be scanned." }
            else { result = RepositoryDiscovery(response.fields["result"] ?? .null) }
        } catch { if !Task.isCancelled, generation == scanID { scanError = error.localizedDescription } }
    }
    private func add(_ repository: DiscoveredRepository) async {
        guard adding == nil, !enrolled(repository), repository.branch != nil else { return }
        adding = repository.id; scanError = nil; defer { adding = nil }
        do {
            let response = try await workspace.client.request("repos.add", args: ["path": .string(repository.path)])
            if case .object(let error) = response.fields["error"] { scanError = error["message"]?.text ?? "The repository could not be added." }
            else { workspace.selectedRepository = response.fields["result"]?.object["repository"]?.object["id"]?.text }
        } catch { scanError = error.localizedDescription }
        await workspace.refresh()
    }
}
