import AppKit
import SwiftUI
import Observation
import ContributionPlatform

@MainActor @Observable private final class Workspace {
    let client = ServiceClient()
    let notifications = LocalNotifications()
    let updater = ReleaseUpdater()
    @ObservationIgnored private var monitoring: Task<Void, Never>?
    @ObservationIgnored private var selectionGeneration = UUID()
    @ObservationIgnored private var loadedOperation: String?
    var notificationContext: NotificationContext?
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
    func startMonitoring() {
        guard monitoring == nil else { return }
        monitoring = Task { [weak self] in
            await self?.updater.reconcileInstalledUpdate()
            while !Task.isCancelled {
                guard let self else { return }
                await refresh(); await notifications.poll(client: client)
                try? await Task.sleep(for: .seconds(5))
            }
        }
    }
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
        let generation = UUID(); selectionGeneration = generation
        guard let selectedOperation else { detail = .null; log = ""; loadedOperation = nil; return }
        if loadedOperation != selectedOperation { detail = .null; log = ""; loadedOperation = selectedOperation }
        let response = await call("runs.get", ["operationId": .string(selectedOperation)])
        guard !Task.isCancelled, selectionGeneration == generation, self.selectedOperation == selectedOperation else { return }
        if let response { detail = .object(response.fields) }
        let logs = await call("logs", ["operationId": .string(selectedOperation), "tail": .number(2000)])
        guard !Task.isCancelled, selectionGeneration == generation, self.selectedOperation == selectedOperation else { return }
        if let logs { log = logs.fields["result"]?.object["text"]?.text ?? "" }
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
private struct NotificationContext: Identifiable { let id = UUID(); let value: JSONValue }

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
    @State private var hostedRepository: HostedRepository?
    @State private var deviceRepository: HostedRepository?
    @Environment(\.openWindow) private var openWindow
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
                Button("GitHub activity", systemImage: "network") { if let id = workspace.selectedRepository { hostedRepository = HostedRepository(id: id) } }.disabled(workspace.selectedRepository == nil)
                Button("Devices", systemImage: "iphone") { if let id = workspace.selectedRepository { deviceRepository = HostedRepository(id: id) } }.disabled(workspace.selectedRepository == nil)
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
        .onAppear {
            workspace.startMonitoring()
            workspace.notifications.onOpen = { route in
                if let response = await workspace.call("notifications.context", route.mapValues(JSONValue.string)) {
                    workspace.notificationContext = NotificationContext(value: response.fields["result"] ?? .null)
                    openWindow(id: "main"); NSApplication.shared.activate(ignoringOtherApps: true)
                }
            }
        }
        .task(id: workspace.selectedOperation) { await workspace.loadSelection() }
        .sheet(item: $workspace.preview) { preview in PublicationSheet(workspace: workspace, preview: preview) }
        .sheet(item: $hostedRepository) { repository in HostedActivity(workspace: workspace, repository: repository.id) }
        .sheet(item: $deviceRepository) { repository in DeviceWorkspace(repository: repository.id, client: workspace.client) { workspace.selectedOperation = $0 } }
        .sheet(item: $workspace.notificationContext) { context in NotificationContextSheet(value: context.value) }
    }
}
private struct NotificationContextSheet: View {
    let value: JSONValue
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        let notice = value.object["notice"]?.object ?? [:]
        VStack(alignment: .leading, spacing: 14) {
            Text(notice["title"]?.text ?? "Contribution activity").font(.title2)
            Text(notice["body"]?.text ?? "").textSelection(.enabled)
            if let state = value.object["operation"]?.object["state"]?.text { Text("Current result: \(state.replacingOccurrences(of: "_", with: " "))") }
            ScrollView([.vertical, .horizontal]) { Text(value.object["log"]?.text ?? "").font(.body.monospaced()).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading) }
            HStack {
                if let text = notice["url"]?.text, let url = URL(string: text), url.scheme == "https", url.host == "github.com", url.user == nil, url.password == nil { Link("Open on GitHub", destination: url) }
                Button("Copy retained details") { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(value.formatted, forType: .string) }
                Spacer(); Button("Done") { dismiss() }
            }
        }.padding(24).frame(width: 720, height: 500)
    }
}
private struct HostedRepository: Identifiable { let id: String }
private struct HostedActivity: View {
    @Bindable var workspace: Workspace
    let repository: String
    @Environment(\.dismiss) private var dismiss
    @State private var observation: JSONValue = .null
    @State private var jobs: [JSONValue] = []
    @State private var selectedRun: JSONValue = .null
    @State private var log: JSONValue = .null
    @State private var loading = false
    @State private var search = ""
    @State private var loadGeneration = UUID()
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack { Text("GitHub activity").font(.title2); Spacer(); Button("Refresh from GitHub") { Task { await refresh(true) } }.disabled(loading); Button("Done") { dismiss() } }
            if let error = workspace.error { Text(error).foregroundStyle(.orange).textSelection(.enabled) }
            if observation == .null { Text(loading ? "Loading…" : "No GitHub observation. Configure a GitHub destination and refresh.").foregroundStyle(.secondary) }
            else {
                HStack { Text(observation.object["readiness"]?.text.replacingOccurrences(of: "_", with: " ").capitalized ?? "Unknown"); Text(observation.object["freshness"]?.text ?? "Unknown freshness").foregroundStyle(.secondary); Spacer(); githubLink(observation.object["pullRequest"]?.object["url"]) }
                Text(observation.object["reasonCodes"]?.array.compactMap { $0.text }.joined(separator: " · ") ?? "").font(.caption).textSelection(.enabled)
            }
            HSplitView {
                List {
                    ForEach(Array((observation.object["workflows"]?.array ?? []).enumerated()), id: \.offset) { _, run in
                        Button { Task { await select(run) } } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(run.object["name"]?.text ?? "Workflow").font(.headline)
                                Text("\(run.object["event"]?.text ?? "Remote activity") · \(run.object["conclusion"]?.text.isEmpty == false ? run.object["conclusion"]!.text : run.object["status"]?.text ?? "Unknown")")
                                Text("Attempt \(run.object["run_attempt"]?.formatted ?? "?") · \(run.object["updated_at"]?.text ?? "")").font(.caption).foregroundStyle(.secondary)
                            }.frame(maxWidth: .infinity, alignment: .leading)
                        }.buttonStyle(.plain)
                    }
                }.frame(minWidth: 250, idealWidth: 310)
                VStack(alignment: .leading, spacing: 8) {
                    githubLink(selectedRun.object["html_url"])
                    ScrollView {
                        ForEach(Array(jobs.enumerated()), id: \.offset) { _, job in
                            VStack(alignment: .leading, spacing: 4) {
                                HStack { Text(job.object["name"]?.text ?? "Job").bold(); Spacer(); Button("Read log") { Task { await loadLog(job) } }.disabled(loading) }
                                Text(job.object["conclusion"]?.text.isEmpty == false ? job.object["conclusion"]!.text : job.object["status"]?.text ?? "Unknown")
                                ForEach(Array((job.object["steps"]?.array ?? []).enumerated()), id: \.offset) { _, step in
                                    Text("\(step.object["name"]?.text ?? "Step"): \(step.object["conclusion"]?.text.isEmpty == false ? step.object["conclusion"]!.text : step.object["status"]?.text ?? "Unknown")").font(.caption)
                                }
                            }.frame(maxWidth: .infinity, alignment: .leading).padding(.bottom, 10)
                        }
                    }.frame(maxHeight: 180)
                    HStack { Text(log.object["state"]?.text.replacingOccurrences(of: "_", with: " ").capitalized ?? "Select a job log"); Spacer(); Button("Copy log") { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(log.object["text"]?.text ?? "", forType: .string) }.disabled(log.object["state"]?.text != "available") }
                    Text(log.object["reasonCode"]?.text ?? "GitHub logs are snapshots when available.").font(.caption).foregroundStyle(.secondary)
                    TextField("Search downloaded log", text: $search).textFieldStyle(.roundedBorder)
                    ScrollView([.vertical, .horizontal]) {
                        Text((log.object["text"]?.text ?? "").split(separator: "\n", omittingEmptySubsequences: false).filter { search.isEmpty || $0.localizedCaseInsensitiveContains(search) }.joined(separator: "\n"))
                            .font(.body.monospaced()).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                    }.accessibilityIdentifier("contribution.githubLog")
                    if log.object["truncated"]?.boolean == true { Text("Showing the first 512 KiB. Open GitHub for the complete log.").font(.caption) }
                }.padding(8).frame(minWidth: 380)
            }
        }.padding(20).frame(minWidth: 820, minHeight: 620).task { await refresh(false) }
            .onDisappear { loadGeneration = UUID() }
    }
    @ViewBuilder private func githubLink(_ value: JSONValue?) -> some View {
        if let value, let url = URL(string: value.text), url.scheme == "https", url.host == "github.com", url.user == nil, url.password == nil { Link("Open on GitHub", destination: url) }
    }
    private func refresh(_ remote: Bool) async {
        let generation = UUID(); loadGeneration = generation
        loading = true; defer { if loadGeneration == generation { loading = false } }
        let response = await workspace.call("status", ["repo": .string(repository), "refresh": .bool(remote)])
        guard !Task.isCancelled, loadGeneration == generation else { return }
        if let response { observation = response.fields["result"]?.object["github"] ?? .null }
    }
    private func select(_ run: JSONValue) async {
        let generation = UUID(); loadGeneration = generation
        loading = true; defer { if loadGeneration == generation { loading = false } }; selectedRun = run; jobs = []; log = .null
        let response = await workspace.call("github.jobs", ["repo": .string(repository), "runId": run.object["id"] ?? .null, "attempt": run.object["run_attempt"] ?? .null])
        guard !Task.isCancelled, loadGeneration == generation else { return }
        if let response { jobs = response.fields["result"]?.object["jobs"]?.array ?? [] }
    }
    private func loadLog(_ job: JSONValue) async {
        let generation = UUID(); loadGeneration = generation
        loading = true; defer { if loadGeneration == generation { loading = false } }; log = .null
        let response = await workspace.call("github.logs", ["repo": .string(repository), "runId": selectedRun.object["id"] ?? .null, "attempt": selectedRun.object["run_attempt"] ?? .null, "jobId": job.object["id"] ?? .null])
        guard !Task.isCancelled, loadGeneration == generation else { return }
        if let response { log = response.fields["result"] ?? .null }
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
    @State private var cliStatus = CLIInstallation().status
    @State private var notificationPermission = "Checking…"
    @State private var notificationMachine: [String: JSONValue] = [:]
    @State private var notificationRevision = ""
    @State private var notificationHosts: [JSONValue] = []
    @State private var preferredHost = ""
    @State private var notifySuccess = true
    @State private var notifyFailure = true
    @State private var notificationSave = ""
    @State private var devicesEnabled = false
    var body: some View {
        Form {
            Section("Background service") {
                LabeledContent("Registration", value: registration)
                Button("Register bundled service") { do { try ServiceRegistration.register(); registration = ServiceRegistration.status } catch { workspace.error = error.localizedDescription } }.disabled(workspace.updater.recoveryRequired)
                Button("Open Login Items settings") { ServiceRegistration.openSettings() }
                Text("Registration needs the packaged app. Signing, background approval, and actual login behavior remain installation checks.").font(.caption).foregroundStyle(.secondary)
            }
            Section("Version") { LabeledContent("Contribution", value: BuildIdentity.version); Text("Development build · Remote device capabilities remain unverified").foregroundStyle(.secondary) }
            Section("Remote Devices") {
                Toggle("Enable Remote Devices on this Mac", isOn: $devicesEnabled)
                Button("Save device setting") { Task { await saveDeviceSetting() } }.disabled(notificationRevision.isEmpty)
                Text("Enabling the module permits explicit setup and requests. Each project, phone and action still needs its own authorization and qualification.").font(.caption).foregroundStyle(.secondary)
            }
            Section("Updates") {
                Text(workspace.updater.message).textSelection(.enabled)
                Button(workspace.updater.recoveryRequired ? "Continue signed update" : "Check for signed updates") { Task { await workspace.updater.check() } }
                    .disabled(!workspace.updater.configured || workspace.updater.busy)
                if workspace.updater.recoveryRequired {
                    Button("Cancel maintenance before installation") { Task { await workspace.updater.cancelBeforeUpdate() } }
                    Button("Reconcile installed update") { Task { await workspace.updater.reconcileInstalledUpdate() } }.disabled(workspace.updater.busy)
                }
            }
            Section("Notifications") {
                LabeledContent("Permission", value: notificationPermission)
                Button("Allow milestone notifications") { Task { do { try await workspace.notifications.requestPermission(); notificationPermission = await workspace.notifications.permission() } catch { workspace.error = error.localizedDescription } } }
                Toggle("Successful milestones", isOn: $notifySuccess)
                Toggle("Failures and required actions", isOn: $notifyFailure)
                Picker("Deliver milestones from this Mac to", selection: $preferredHost) {
                    ForEach(Array(notificationHosts.enumerated()), id: \.offset) { _, host in Text(host.object["label"]?.text ?? host.object["alias"]?.text ?? "Paired Mac").tag(host.object["hostId"]?.text ?? "") }
                }
                Button("Save notification preferences") { Task { await saveNotifications() } }.disabled(notificationRevision.isEmpty || preferredHost.isEmpty)
                if !notificationSave.isEmpty { Text(notificationSave).font(.caption) }
                Text("Notification permission never changes workflow results. Offline delivery remains in the activity view.").font(.caption).foregroundStyle(.secondary)
            }
            Section("Command line") {
                Text(cliStatus)
                Button("Install bundled CLI") { do { try CLIInstallation().install(); cliStatus = CLIInstallation().status } catch { workspace.error = error.localizedDescription } }
                Button("Remove owned CLI link") { do { try CLIInstallation().uninstallOwnedLink(); cliStatus = CLIInstallation().status } catch { workspace.error = error.localizedDescription } }
                Text("Add ~/.local/bin to your shell PATH. This action preserves any unrelated executable already at that location.").font(.caption).foregroundStyle(.secondary)
            }
        }.formStyle(.grouped).padding().frame(width: 540).task {
            notificationPermission = await workspace.notifications.permission()
            if let result = await workspace.call("settings.get") {
                notificationMachine = result.fields["result"]?.object["settings"]?.object ?? [:]
                notificationRevision = result.fields["result"]?.object["revision"]?.text ?? ""
                devicesEnabled = notificationMachine["remoteDevices"]?.object["enabled"]?.boolean ?? false
                let preferences = notificationMachine["notifications"]?.object ?? [:]
                preferredHost = preferences["preferredHostId"]?.text ?? ""; notifySuccess = preferences["success"]?.boolean ?? true; notifyFailure = preferences["failure"]?.boolean ?? true
            }
            if let result = await workspace.call("hosts.list") { notificationHosts = result.fields["result"]?.object["hosts"]?.array ?? [] }
        }
    }
    private func saveNotifications() async {
        var updated = notificationMachine
        updated["notifications"] = .object(["preferredHostId": .string(preferredHost), "success": .bool(notifySuccess), "failure": .bool(notifyFailure)])
        if let response = await workspace.call("settings.apply", ["config": .object(updated), "expectedRevision": .string(notificationRevision), "requestId": .string(UUID().uuidString)]) {
            notificationSave = "Preference change accepted. Follow its result in Activity."
            notificationRevision = ""; workspace.selectedOperation = response.operationID
        }
    }
    private func saveDeviceSetting() async {
        var updated = notificationMachine
        var settings = updated["remoteDevices"]?.object ?? ["maintainSession": .bool(false)]
        settings["enabled"] = .bool(devicesEnabled); updated["remoteDevices"] = .object(settings)
        if let response = await workspace.call("settings.apply", ["config": .object(updated), "expectedRevision": .string(notificationRevision), "requestId": .string(UUID().uuidString)]) {
            notificationRevision = ""; workspace.selectedOperation = response.operationID
            notificationSave = "Device setting accepted. Follow its result in Activity."
        }
    }
}
