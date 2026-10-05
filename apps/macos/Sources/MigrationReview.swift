import SwiftUI
import ContributionPlatform

struct MigrationReviewSheet: View {
    @Bindable var workspace: Workspace
    let repositoryID: String
    @Environment(\.dismiss) private var dismiss
    @State private var plans: [MigrationReview] = []
    @State private var selection: String?
    @State private var loading = false
    @State private var limited = false
    @State private var existingHistory = false
    @State private var change: MigrationChange?
    @State private var generation = UUID()
    private var repository: JSONValue { workspace.repositories.first { $0.object["id"]?.text == repositoryID } ?? .null }
    private var adapter: String { repository.object["config"]?.object["integration"]?.object["adapter"]?.text ?? "" }
    private var unavailable: Bool { loading || workspace.sending || workspace.pendingRequest != nil }
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Project migration").font(.title2.bold()); Spacer()
                Button("Refresh") { Task { await load() } }.disabled(loading)
                Button("Done") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            Text("Review the existing project workflow and exact saved changes. Applying files, committing them and activating registration are separate steps.").foregroundStyle(.secondary)
            HStack {
                if adapter == "migration-required" {
                    Button("Prepare source review") { Task { await prepare(["repo": .string(repositoryID), "prepareAdoption": .bool(true)]) } }.disabled(unavailable)
                } else {
                    Button("Review an already migrated clone…") { existingHistory = true }.disabled(unavailable)
                }
                if loading { ProgressView().controlSize(.small) }
            }
            if workspace.pendingRequest != nil { Text("A request needs reconciliation in Activity. Its original identity is retained.").foregroundStyle(.orange) }
            if let error = workspace.error { Text(error).foregroundStyle(.orange).textSelection(.enabled).lineLimit(4) }
            HSplitView {
                List(plans, selection: $selection) { plan in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(plan.status).font(.headline)
                        Text(plan.fields.object["createdAt"]?.text ?? "Retained review").font(.caption).foregroundStyle(.secondary)
                        Text(plan.id.prefix(8)).font(.caption.monospaced())
                    }.padding(.vertical, 4).tag(plan.id as String?)
                }.frame(minWidth: 215, idealWidth: 240, maxWidth: 290)
                if let plan = plans.first(where: { $0.id == selection }) {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(plan.status).font(.headline)
                        Text("Gate: \(plan.fields.object["gate"]?.text == "inactive" ? "Inactive" : "Enabled") · \(plan.registrationOnly ? "Local registration only" : "Reviewed source changes")").font(.caption)
                        if plan.registrationOnly { Text("Activation verifies the committed files. Rollback restores the reviewed original files as uncommitted changes; it preserves history.").font(.caption).foregroundStyle(.secondary) }
                        MigrationFileReview(workspace: workspace, plan: plan).id(plan.id)
                        HStack {
                            ForEach(plan.actions) { action in
                                Button(action.label + "…") {
                                    if let args = plan.arguments(for: action, repository: repository) { change = MigrationChange(action: action, arguments: args) }
                                }.disabled(unavailable || plan.arguments(for: action, repository: repository) == nil)
                            }
                        }.controlSize(.small)
                    }.padding(.leading, 12).frame(minWidth: 420)
                } else {
                    ContentUnavailableView("No review selected", systemImage: "doc.text.magnifyingglass", description: Text("Prepare a review or select a retained one. Preparing does not change project files."))
                }
            }
            if limited { Text("Showing the latest 50 reviews, with active or interrupted migrations first. Older proposals remain accessible by ID through the CLI.").font(.caption).foregroundStyle(.secondary) }
        }.padding(24).frame(width: 890, height: 660)
            .task { await load() }
            .onDisappear { generation = UUID() }
            .sheet(isPresented: $existingHistory) { ExistingMigrationReview(prepare: { args in await prepare(args) }, repositoryID: repositoryID) }
            .sheet(item: $change) { change in MigrationChangeReview(workspace: workspace, change: change) { await load() } }
    }
    private func load(selecting proposed: String? = nil) async {
        let token = UUID(); generation = token; loading = true
        defer { if generation == token { loading = false } }
        let response = await workspace.call("repos.migration", ["repo": .string(repositoryID), "listAdoptions": .bool(true)], accepting: { generation == token })
        guard !Task.isCancelled, generation == token, let result = response?.fields["result"] else { return }
        plans = (result.object["plans"]?.array ?? []).compactMap { MigrationReview($0, repositoryID: repositoryID) }
        limited = result.object["limited"]?.boolean == true
        if let proposed, plans.contains(where: { $0.id == proposed }) { selection = proposed }
        else if !plans.contains(where: { $0.id == selection }) { selection = plans.first?.id }
    }
    private func prepare(_ args: [String: JSONValue]) async {
        let response = await workspace.submit("repos.migration", args: args)
        await load(selecting: response?.fields["result"]?.object["proposalId"]?.text)
    }
}

private struct MigrationFileReview: View {
    @Bindable var workspace: Workspace
    let plan: MigrationReview
    @State private var path: String
    @State private var side = "after"
    @State private var offset = 0
    @State private var previous: [Int] = []
    @State private var page: JSONValue = .null
    @State private var loading = false
    @State private var generation = UUID()
    init(workspace: Workspace, plan: MigrationReview) { self.workspace = workspace; self.plan = plan; _path = State(initialValue: plan.files[0]) }
    private var key: String { plan.id + ":" + path + ":" + side + ":" + String(offset) }
    private var next: Int? { if case .number(let number) = page.object["nextOffset"] { return NSDecimalNumber(decimal: number).intValue }; return nil }
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Picker("Reviewed file", selection: $path) { ForEach(plan.files, id: \.self) { Text($0).tag($0) } }
            Picker("Snapshot", selection: $side) { Text("Before").tag("before"); Text("After").tag("after") }.pickerStyle(.segmented)
            Text("Private saved source · \(page.object["size"]?.formatted ?? "—") bytes").font(.caption).foregroundStyle(.secondary)
            ScrollView([.vertical, .horizontal]) {
                Text(page.object["exists"] == .bool(false) ? "File did not exist." : page.object["text"]?.text ?? "Select a file to load its saved contents.")
                    .font(.system(.caption, design: .monospaced)).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .topLeading).padding(10)
            }.background(.quaternary.opacity(0.3)).overlay { if loading { ProgressView("Loading verified snapshot…") } }
            HStack {
                Button("Previous page") { if let value = previous.popLast() { offset = value } }.disabled(previous.isEmpty || loading)
                Text("Byte offset \(offset)").font(.caption).foregroundStyle(.secondary); Spacer()
                Button("Next page") { if let next { previous.append(offset); offset = next } }.disabled(next == nil || loading)
            }.controlSize(.small)
        }.task(id: key) { await load() }
            .onChange(of: path) { _, _ in offset = 0; previous = []; page = .null }
            .onChange(of: side) { _, _ in offset = 0; previous = []; page = .null }
            .onDisappear { generation = UUID() }
    }
    private func load() async {
        let token = UUID(), selected = key; generation = token; loading = true; page = .null
        defer { if generation == token { loading = false } }
        let response = await workspace.call("repos.migration", ["repo": .string(plan.repositoryID), "adoptionPlan": .string(plan.id), "reviewFile": .string(path), "reviewSide": .string(side), "reviewOffset": .number(Decimal(offset))], accepting: { generation == token && key == selected })
        guard !Task.isCancelled, generation == token, key == selected else { return }
        page = response?.fields["result"] ?? .null
    }
}

private struct MigrationChange: Identifiable {
    let id = UUID()
    let action: MigrationAction
    let arguments: [String: JSONValue]
}
private struct MigrationChangeReview: View {
    @Bindable var workspace: Workspace
    let change: MigrationChange
    var onComplete: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var reviewed = false
    @State private var saving = false
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(change.action.label + "?").font(.title2.bold())
            Text(change.action.explanation)
            Toggle("I reviewed this proposal and its project workflow.", isOn: $reviewed)
            if let error = workspace.error { Text(error).foregroundStyle(.orange).textSelection(.enabled) }
            HStack {
                Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving); Spacer()
                Button(change.action.label) {
                    saving = true
                    Task {
                        let response = await workspace.submit("repos.migration", args: change.arguments); saving = false
                        if response?.fields["error"] == .null || workspace.pendingRequest != nil { await onComplete(); dismiss() }
                    }
                }.disabled(!reviewed || saving || workspace.sending || workspace.pendingRequest != nil)
            }
        }.padding(24).frame(width: 520).interactiveDismissDisabled(saving)
    }
}
private struct ExistingMigrationReview: View {
    var prepare: ([String: JSONValue]) async -> Void
    let repositoryID: String
    @Environment(\.dismiss) private var dismiss
    @State private var original = ""
    @State private var migration = ""
    @State private var preparing = false
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Review a committed migration").font(.title2.bold())
            Text("Select the full original and migration commit IDs from this clone's history. The service reconstructs and verifies the original workflow before offering local activation.")
            TextField("Original commit ID", text: $original)
            TextField("Migration commit ID", text: $migration)
            HStack {
                Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction).disabled(preparing); Spacer()
                Button("Prepare review") {
                    guard let args = MigrationReview.existingHistoryArguments(repositoryID: repositoryID, original: original, migration: migration) else { return }
                    preparing = true; Task { await prepare(args); preparing = false; dismiss() }
                }.disabled(preparing || MigrationReview.existingHistoryArguments(repositoryID: repositoryID, original: original, migration: migration) == nil)
            }
        }.padding(24).frame(width: 540).interactiveDismissDisabled(preparing)
    }
}
