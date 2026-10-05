import AppKit
import SwiftUI
import Observation
import ContributionPlatform

@MainActor @Observable final class Workspace {
    let client = ServiceClient()
    let notifications = LocalNotifications()
    let updater = ReleaseUpdater()
    @ObservationIgnored private var monitoring: Task<Void, Never>?
    @ObservationIgnored private var selectionGeneration = UUID()
    @ObservationIgnored private var loadedOperation: String?
    @ObservationIgnored private var repositoryGeneration = UUID()
    @ObservationIgnored private var loadedRepository: String?
    var notificationContext: NotificationContext?
    var repositories: [JSONValue] = []
    var sharedProjects: [SharedProject] = []
    var mappingProject: String?
    var operations: [JSONValue] = []
    var hosts: [JSONValue] = []
    var localHostID = ""
    var devicesEnabled = false
    var repositoryStatus: JSONValue = .null
    var repositoryLoading = false
    var pendingRequest: RetainedRequest?
    var sending = false
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
    func call(_ command: String, _ args: [String: JSONValue] = [:], accepting: () -> Bool = { true }) async -> ResponseEnvelope? {
        do {
            let response = try await client.request(command, args: args)
            guard !Task.isCancelled, accepting() else { return nil }
            if case .object(let failure) = response.fields["error"] { error = failure["message"]?.text; return nil }
            return response
        } catch { if !Task.isCancelled, accepting() { self.error = error.localizedDescription }; return nil }
    }
    func refresh() async {
        guard !busy else { return }; busy = true; defer { busy = false }
        if let response = await call("service.status") {
            let result = response.fields["result"]?.object ?? [:]; service = result["state"]?.text ?? "Unknown"; paused = result["paused"]?.boolean ?? false
            if case .object = result["storageHold"] { service = "Storage needs attention — open Settings → Storage" }
            localHostID = result["hostId"]?.text ?? ""; devicesEnabled = result["remoteDevicesEnabled"]?.boolean ?? false
        } else { service = "Service unavailable"; return }
        if let response = await call("repos.list") {
            repositories = response.fields["result"]?.object["repositories"]?.array ?? []
            sharedProjects = (response.fields["result"]?.object["peerProjects"]?.array ?? []).map(SharedProject.init)
                .filter { $0.fields.object["state"]?.text != "mapped" }
        }
        if let response = await call("runs.list") { operations = response.fields["result"]?.object["operations"]?.array ?? [] }
        if let response = await call("hosts.list") { hosts = response.fields["result"]?.object["hosts"]?.array ?? [] }
        do { pendingRequest = try NativeRequestJournal(directory: client.directory).pending() } catch { self.error = error.localizedDescription }
        await loadSelection(); await loadRepository()
    }
    func loadSelection() async {
        let generation = UUID(); selectionGeneration = generation
        guard let selectedOperation else { detail = .null; log = ""; loadedOperation = nil; return }
        if loadedOperation != selectedOperation { detail = .null; log = ""; loadedOperation = selectedOperation }
        let response = await call("runs.get", ["operationId": .string(selectedOperation)], accepting: { self.selectionGeneration == generation && self.selectedOperation == selectedOperation })
        guard !Task.isCancelled, selectionGeneration == generation, self.selectedOperation == selectedOperation else { return }
        if let response { detail = .object(response.fields) }
        let logs = await call("logs", ["operationId": .string(selectedOperation), "tail": .number(2000)], accepting: { self.selectionGeneration == generation && self.selectedOperation == selectedOperation })
        guard !Task.isCancelled, selectionGeneration == generation, self.selectedOperation == selectedOperation else { return }
        if let logs { log = logs.fields["result"]?.object["text"]?.text ?? "" }
    }
    func hostLabel(_ id: String) -> String {
        if id == localHostID { return "This Mac" }
        let host = hosts.first { $0.object["hostId"]?.text == id }
        return host?.object["label"]?.text ?? host?.object["alias"]?.text ?? "Paired Mac"
    }
    func loadRepository(refresh: Bool = false) async {
        if repositoryLoading && !refresh && loadedRepository == selectedRepository { return }
        let generation = UUID(); repositoryGeneration = generation
        guard let selectedRepository else { repositoryStatus = .null; repositoryLoading = false; loadedRepository = nil; return }
        if loadedRepository != selectedRepository { repositoryStatus = .null; loadedRepository = selectedRepository }
        repositoryLoading = true; defer { if repositoryGeneration == generation { repositoryLoading = false } }
        let response = await call("status", ["repo": .string(selectedRepository), "refresh": .bool(refresh)], accepting: { self.repositoryGeneration == generation && self.selectedRepository == selectedRepository })
        guard !Task.isCancelled, repositoryGeneration == generation, self.selectedRepository == selectedRepository else { return }
        if let response { repositoryStatus = response.fields["result"] ?? .null }
    }
    @discardableResult func submit(_ command: String, args: [String: JSONValue]) async -> ResponseEnvelope? {
        guard !sending else { return nil }
        let journal = NativeRequestJournal(directory: client.directory)
        do {
            let retained = RetainedRequest(command: command, args: args); try journal.retain(retained); pendingRequest = retained
            return await reconcilePending()
        } catch { self.error = error.localizedDescription; pendingRequest = try? journal.pending() }
        return nil
    }
    @discardableResult func reconcilePending() async -> ResponseEnvelope? {
        guard let retained = pendingRequest, !sending else { return nil }
        sending = true; defer { sending = false }
        var completed: ResponseEnvelope?
        do {
            let response = try await client.request(retained.command, args: retained.args)
            if try NativeRequestJournal(directory: client.directory).resolveIfComplete(retained, response: response) { pendingRequest = nil }
            completed = response
            if case .object(let failure) = response.fields["error"] { error = failure["message"]?.text }
            if let operation = response.operationID { selectedOperation = operation }
        } catch { self.error = error.localizedDescription }
        await refresh()
        return completed
    }
    func addRepository() async {
        let panel = NSOpenPanel(); panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.allowsMultipleSelection = false
        guard panel.runModal() == .OK, let url = panel.url else { return }
        _ = await call("repos.add", ["path": .string(url.path)]); await refresh()
    }
    func resolveProject(_ project: SharedProject) async {
        guard mappingProject == nil else { return }
        mappingProject = project.id; defer { mappingProject = nil }
        let panel = NSOpenPanel(); panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.allowsMultipleSelection = false
        panel.title = "Select local clone"
        panel.message = "Select this project's existing checkout with its matching contribution.json."
        guard panel.runModal() == .OK, let url = panel.url else { return }
        let fields = project.fields.object
        _ = await call("repos.resolve", ["repo": fields["repositoryId"] ?? .null, "host": fields["hostId"] ?? .null,
            "expectedRevision": fields["policyRevision"] ?? .null, "path": .string(url.path)])
        await refresh()
    }
    func previewPush() async {
        guard let selectedRepository, let response = await call("push", ["repo": .string(selectedRepository), "preview": .bool(true)]), let result = response.fields["result"] else { return }
        guard self.selectedRepository == selectedRepository else { return }
        preview = PublicationPreview(repository: selectedRepository, fields: result)
    }
    func publish(_ preview: PublicationPreview) async {
        let fields = preview.fields.object
        await submit("push", args: ["repo": .string(preview.repository), "expectedTip": fields["expectedTip"] ?? .null, "scopeToken": fields["scopeToken"] ?? .null])
        self.preview = nil; await refresh()
    }
    func operationAction(_ action: String) async {
        guard let selectedOperation else { return }
        _ = await call(action, ["operationId": .string(selectedOperation)]); await refresh()
    }
}
struct PublicationPreview: Identifiable {
    let id = UUID()
    let repository: String
    let fields: JSONValue
}
struct SharedProject: Identifiable {
    let fields: JSONValue
    var id: String { (fields.object["hostId"]?.text ?? "") + ":" + (fields.object["repositoryId"]?.text ?? "") }
    var status: String {
        switch fields.object["state"]?.text {
        case "checkout_required": "Local checkout needed"
        case "configuration_conflict": "Configuration differs between Macs"
        case "removed_on_peer": "Removed from paired Mac"
        default: "Setup needs review"
        }
    }
}
struct NotificationContext: Identifiable { let id = UUID(); let value: JSONValue }

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
    @State private var newProject = false
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
                if !workspace.sharedProjects.isEmpty {
                    Section("From paired Mac") {
                        ForEach(workspace.sharedProjects) { project in
                            VStack(alignment: .leading, spacing: 5) {
                                Label(project.fields.object["name"]?.text ?? "Shared project", systemImage: "desktopcomputer")
                                Text(project.status).font(.caption).foregroundStyle(.secondary)
                                if project.fields.object["state"]?.text == "checkout_required" {
                                    Button("Select local clone") { Task { await workspace.resolveProject(project) } }
                                        .disabled(workspace.mappingProject != nil)
                                }
                            }.padding(.vertical, 4)
                        }
                    }
                }
            }
            .safeAreaInset(edge: .bottom) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(workspace.paused ? "Processing paused" : workspace.service).font(.caption).foregroundStyle(.secondary)
                    Menu("Add repository", systemImage: "plus") {
                        Button("Add existing repository…") { Task { await workspace.addRepository() } }
                        Button("New project…") { newProject = true }
                    }
                }.padding()
            }
            .navigationSplitViewColumnWidth(min: 190, ideal: 230)
        } content: {
            ActivityList(workspace: workspace)
            .navigationTitle("Activity")
            .toolbar {
                Button("Refresh", systemImage: "arrow.clockwise") { Task { await workspace.refresh() } }.disabled(workspace.busy)
                Button("Preview Push", systemImage: "arrow.up.circle") { Task { await workspace.previewPush() } }.disabled(workspace.selectedRepository == nil)
                Button("GitHub activity", systemImage: "network") { if let id = workspace.selectedRepository { hostedRepository = HostedRepository(id: id) } }.disabled(workspace.selectedRepository == nil)
                if workspace.devicesEnabled { Button("Devices", systemImage: "iphone") { if let id = workspace.selectedRepository { deviceRepository = HostedRepository(id: id) } }.disabled(workspace.selectedRepository == nil) }
            }
        } detail: {
            OperationDetail(workspace: workspace)
        }
        .safeAreaInset(edge: .top) {
            if let retained = workspace.pendingRequest {
                HStack {
                    Text("The reply to \(retained.command) is unresolved. Its original selection is retained.")
                    Spacer(); Button("Reconcile request") { Task { await workspace.reconcilePending() } }.disabled(workspace.sending)
                }.padding(10).background(.orange.opacity(0.12))
            }
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
        .task(id: workspace.selectedRepository) { await workspace.loadRepository() }
        .onChange(of: workspace.devicesEnabled) { _, enabled in if !enabled { deviceRepository = nil } }
        .sheet(item: $workspace.preview) { preview in PublicationSheet(workspace: workspace, preview: preview) }
        .sheet(isPresented: $newProject) { NewProjectSheet(workspace: workspace) }
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
private struct OperationDetail: View {
    @Bindable var workspace: Workspace
    @State private var showDiagnostics = false
    @State private var followingLog = true
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
                        Button("Copy latest log") { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(workspace.log, forType: .string) }
                        Button("Export latest log…") { exportLog() }
                        Button("Show diagnostics") { showDiagnostics = true }
                    }
                }
                Text(selected).font(.caption.monospaced()).foregroundStyle(.secondary).textSelection(.enabled)
                RunSummary(detail: workspace.detail, operation: workspace.operations.first { $0.object["operationId"]?.text == selected })
                HStack {
                    Text(followingLog ? "Following output" : "Log view paused; follow latest to see new output").font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button(followingLog ? "Pause following" : "Follow latest") { followingLog.toggle() }.controlSize(.small)
                }
                TextField("Search retained log", text: $workspace.search).textFieldStyle(.roundedBorder)
                RetainedLogView(text: workspace.log.split(separator: "\n", omittingEmptySubsequences: false).filter { workspace.search.isEmpty || $0.localizedCaseInsensitiveContains(workspace.search) }.joined(separator: "\n"), following: $followingLog)
                    .id(selected + ":" + workspace.search)
                    .onChange(of: workspace.search) { _, value in if !value.isEmpty { followingLog = false } }
                    .onChange(of: workspace.selectedOperation) { _, _ in followingLog = true }
                Text("Showing up to 2,000 retained lines. Closing this window leaves accepted work running.").font(.caption).foregroundStyle(.secondary)
            }.padding()
            .sheet(isPresented: $showDiagnostics) { DiagnosticsSheet(client: workspace.client, operationID: selected, localDetails: workspace.detail) }
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
            LabeledContent("Project", value: workspace.repositories.first(where: { $0.object["id"]?.text == preview.repository })?.object["config"]?.object["name"]?.text ?? preview.repository)
            LabeledContent("Branch", value: scope["branch"]?.text ?? "Unknown")
            LabeledContent("Destination", value: scope["ref"]?.text ?? "Unknown")
            LabeledContent("Commit", value: scope["tip"]?.text ?? "Unknown")
            Text("This request publishes this exact selection. Later commits require a new preview.").foregroundStyle(.secondary)
            HStack { Button("Cancel") { dismiss() }; Spacer(); Button("Push") { Task { await workspace.publish(preview) } }.buttonStyle(.borderedProminent).disabled(workspace.sending || workspace.pendingRequest != nil) }
        }.padding(24).frame(width: 560)
    }
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
    @State private var showServiceDiagnostics = false
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
    @State private var newProject = false
    var body: some View {
        VStack(alignment: .leading) {
        TabView {
            Form {
            Section("Background service") {
                LabeledContent("Registration", value: registration)
                Button("Service diagnostics…") { showServiceDiagnostics = true }
                Button("Register bundled service") { do { try ServiceRegistration.register(); registration = ServiceRegistration.status } catch { workspace.error = error.localizedDescription } }.disabled(workspace.updater.recoveryRequired)
                Button("Open Login Items settings") { ServiceRegistration.openSettings() }
                Text("Registration needs the packaged app. Signing, background approval, and actual login behavior remain installation checks.").font(.caption).foregroundStyle(.secondary)
            }
            Section("Version") { LabeledContent("Contribution", value: BuildIdentity.version); Text("Development build · Remote device capabilities remain unverified").foregroundStyle(.secondary) }
            PowerSettings(workspace: workspace)
            Section("Command line") {
                Text(cliStatus)
                Button("Install bundled CLI") { do { try CLIInstallation().install(); cliStatus = CLIInstallation().status } catch { workspace.error = error.localizedDescription } }
                Button("Remove owned CLI link") { do { try CLIInstallation().uninstallOwnedLink(); cliStatus = CLIInstallation().status } catch { workspace.error = error.localizedDescription } }
                Text("Add ~/.local/bin to your shell PATH. This action preserves any unrelated executable already at that location.").font(.caption).foregroundStyle(.secondary)
            }
            }.formStyle(.grouped).tabItem { Label("Setup", systemImage: "gearshape") }
                .sheet(isPresented: $showServiceDiagnostics) { DiagnosticsSheet(client: workspace.client) }
            Form {
                Section("Repositories on this Mac") {
                    ForEach(workspace.repositories, id: \.identity) { repository in
                        LabeledContent(repository.object["config"]?.object["name"]?.text ?? "Repository") {
                            Text(repository.object["path"]?.text ?? "Path unavailable").font(.caption).textSelection(.enabled)
                        }
                    }
                    Button("Add existing repository…") { Task { await workspace.addRepository() } }
                    Button("New project…") { newProject = true }.disabled(workspace.sending || workspace.pendingRequest != nil)
                }
            }.formStyle(.grouped).tabItem { Label("Repositories", systemImage: "folder") }
                .sheet(isPresented: $newProject) { NewProjectSheet(workspace: workspace) }
            Form { Section("Remote Devices") {
                Toggle("Enable Remote Devices on this Mac", isOn: $devicesEnabled)
                Button("Save device setting") { Task { await saveDeviceSetting() } }.disabled(notificationRevision.isEmpty || workspace.sending || workspace.pendingRequest != nil)
                Text("Enabling the module permits explicit setup and requests. Each project, phone and action still needs its own authorization and qualification.").font(.caption).foregroundStyle(.secondary)
            } }.formStyle(.grouped).tabItem { Label("Devices", systemImage: "iphone") }
            Form { Section("Updates") {
                Text(workspace.updater.message).textSelection(.enabled)
                Button(workspace.updater.recoveryRequired ? "Continue signed update" : "Check for signed updates") { Task { await workspace.updater.check() } }
                    .disabled(!workspace.updater.configured || workspace.updater.busy)
                if workspace.updater.recoveryRequired {
                    Button("Cancel maintenance before installation") { Task { await workspace.updater.cancelBeforeUpdate() } }
                    Button("Reconcile installed update") { Task { await workspace.updater.reconcileInstalledUpdate() } }.disabled(workspace.updater.busy)
                }
            } }.formStyle(.grouped).tabItem { Label("Updates", systemImage: "arrow.down.circle") }
            Form { Section("Notifications") {
                LabeledContent("Permission", value: notificationPermission)
                Button("Allow milestone notifications") { Task { do { try await workspace.notifications.requestPermission(); notificationPermission = await workspace.notifications.permission() } catch { workspace.error = error.localizedDescription } } }
                Toggle("Successful milestones", isOn: $notifySuccess)
                Toggle("Failures and required actions", isOn: $notifyFailure)
                Picker("Deliver milestones from this Mac to", selection: $preferredHost) {
                    ForEach(Array(notificationHosts.enumerated()), id: \.offset) { _, host in Text(host.object["label"]?.text ?? host.object["alias"]?.text ?? "Paired Mac").tag(host.object["hostId"]?.text ?? "") }
                }
                Button("Save notification preferences") { Task { await saveNotifications() } }.disabled(notificationRevision.isEmpty || preferredHost.isEmpty || workspace.sending || workspace.pendingRequest != nil)
                if !notificationSave.isEmpty { Text(notificationSave).font(.caption) }
                Text("Notification permission never changes workflow results. Offline delivery remains in the activity view.").font(.caption).foregroundStyle(.secondary)
            } }.formStyle(.grouped).tabItem { Label("Notifications", systemImage: "bell") }
            StorageSettings(workspace: workspace).tabItem { Label("Storage", systemImage: "internaldrive") }
        }
        if workspace.pendingRequest != nil {
            HStack {
                Label("An earlier request still needs reconciliation.", systemImage: "exclamationmark.circle")
                Spacer()
                Button("Reconcile same request") { Task { await workspace.reconcilePending() } }.disabled(workspace.sending)
            }.font(.caption)
        }
        if let error = workspace.error {
            HStack { Text(error).font(.caption).textSelection(.enabled); Spacer(); Button("Dismiss") { workspace.error = nil } }
        }
        Button("Reload saved settings") { Task { await loadSettings() } }.disabled(workspace.sending)
        }.padding().frame(width: 680, height: 580).task { await loadSettings() }
    }
    private func loadSettings() async {
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
    private func saveNotifications() async {
        var updated = notificationMachine
        updated["notifications"] = .object(["preferredHostId": .string(preferredHost), "success": .bool(notifySuccess), "failure": .bool(notifyFailure)])
        if let response = await workspace.submit("settings.apply", args: ["config": .object(updated), "expectedRevision": .string(notificationRevision)]), response.fields["error"] == .null {
            notificationSave = "Preference change accepted. Follow its result in Activity."
            notificationRevision = ""; workspace.selectedOperation = response.operationID
        }
    }
    private func saveDeviceSetting() async {
        var updated = notificationMachine
        var settings = updated["remoteDevices"]?.object ?? ["maintainSession": .bool(false)]
        settings["enabled"] = .bool(devicesEnabled); updated["remoteDevices"] = .object(settings)
        if let response = await workspace.submit("settings.apply", args: ["config": .object(updated), "expectedRevision": .string(notificationRevision)]), response.fields["error"] == .null {
            notificationRevision = ""; workspace.selectedOperation = response.operationID
            notificationSave = "Device setting accepted. Follow its result in Activity."
        }
    }
}
