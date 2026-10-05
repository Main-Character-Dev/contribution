import AppKit
import SwiftUI
import ContributionPlatform

struct ActivityList: View {
    @Bindable var workspace: Workspace
    @State private var query = ""
    @State private var outcome = ""
    @State private var host = ""
    @State private var days = 0
    private var items: [ActivityItem] {
        let names = Dictionary(uniqueKeysWithValues: workspace.repositories.compactMap { repo -> (String, String)? in
            guard let id = repo.object["id"]?.text else { return nil }; return (id, repo.object["config"]?.object["name"]?.text ?? "Project")
        })
        let since = days > 0 ? Date().addingTimeInterval(-Double(days) * 86400) : nil
        return workspace.operations.map { ActivityItem($0, localHostID: workspace.localHostID, repositoryName: names[$0.object["repositoryId"]?.text ?? ""] ?? "Contribution") }
            .filter { $0.matches(query: query, repository: workspace.selectedRepository, host: host.isEmpty ? nil : host, outcome: outcome.isEmpty ? nil : outcome, since: since) }
    }
    var body: some View {
        let filtered = items
        VStack(spacing: 0) {
            if let repository = workspace.repositories.first(where: { $0.object["id"]?.text == workspace.selectedRepository }) {
                RepositoryOverview(workspace: workspace, repository: repository)
                Divider()
            }
            VStack(spacing: 8) {
                TextField("Search activity", text: $query).textFieldStyle(.roundedBorder).accessibilityIdentifier("contribution.activitySearch")
                HStack {
                    Picker("Outcome", selection: $outcome) {
                        Text("All outcomes").tag("")
                        ForEach(["queued", "queued_local", "running", "waiting", "needs_attention", "outcome_unknown", "failed", "interrupted", "cancelled", "succeeded"], id: \.self) { Text($0.replacingOccurrences(of: "_", with: " ").capitalized).tag($0) }
                    }.labelsHidden().accessibilityLabel("Filter activity by outcome")
                    Picker("Host", selection: $host) {
                        Text("All hosts").tag("")
                        ForEach(workspace.hosts, id: \.hostIdentity) { value in
                            Text(workspace.hostLabel(value.hostIdentity)).tag(value.hostIdentity)
                        }
                    }.labelsHidden().accessibilityLabel("Filter activity by execution host")
                    Picker("Date", selection: $days) {
                        Text("Any date").tag(0); Text("24 hours").tag(1); Text("7 days").tag(7); Text("30 days").tag(30)
                    }.labelsHidden().accessibilityLabel("Filter activity by date")
                }
            }.padding(10)
            List(selection: $workspace.selectedOperation) {
                ForEach(ActivityGroup.allCases) { group in
                    let rows = filtered.filter { $0.group == group }
                    if !rows.isEmpty {
                        Section("\(group.rawValue) (\(rows.count))") {
                            ForEach(rows) { item in
                                ActivityRow(item: item, hostLabel: workspace.hostLabel(item.hostID)).tag(item.id as String?)
                            }
                        }
                    }
                }
            }.overlay {
                if filtered.isEmpty { ContentUnavailableView("No matching activity", systemImage: "line.3.horizontal.decrease.circle", description: Text(workspace.operations.isEmpty ? "Accepted work will appear here." : "Change the filters to see other recorded attempts.")) }
            }
            Text("Latest 200 recorded attempts. Filters apply to this retained history.").font(.caption).foregroundStyle(.secondary).padding(8)
        }.frame(minWidth: 330)
    }
}
private extension JSONValue { var hostIdentity: String { object["hostId"]?.text ?? "" } }

private struct ActivityRow: View {
    let item: ActivityItem
    let hostLabel: String
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(item.title).font(.headline)
                if item.value.object["pinned"]?.boolean == true { Image(systemName: "pin.fill").accessibilityLabel("Evidence pinned") }
            }
            Text(item.repositoryName + " · " + hostLabel).font(.caption).foregroundStyle(.secondary)
            Text(item.state.replacingOccurrences(of: "_", with: " ").capitalized)
            if !item.reason.isEmpty { Text(item.reason).font(.caption).lineLimit(3) }
            if let date = item.createdAt { Text(date, format: .dateTime.month().day().hour().minute()).font(.caption).foregroundStyle(.secondary) }
        }.padding(.vertical, 4).accessibilityElement(children: .combine)
    }
}

private struct RepositoryOverview: View {
    @Bindable var workspace: Workspace
    let repository: JSONValue
    @State private var initialization: ProjectSetup?
    @State private var settingsDraft: RepositorySettingsDraft?
    @State private var migrationReview = false
    private var publication: [String: JSONValue] { workspace.repositoryStatus.object["publication"]?.object ?? [:] }
    private var publicationText: String {
        switch publication["relation"]?.text {
        case "equal": "Published tip matches the observed canonical tip"
        case "ahead": "Committed work is ready for a push preview"
        case "behind": "Published history is ahead; reconcile first"
        case "diverged": "Histories differ; reconciliation needed"
        case "unpublished": "The publication branch has no observed remote history"
        case "unconfigured": "Publication destination is not configured"
        default: "Publication has not been confirmed"
        }
    }
    var body: some View {
        let config = repository.object["config"]?.object ?? [:], status = workspace.repositoryStatus.object
        VStack(alignment: .leading, spacing: 7) {
            Text(config["name"]?.text ?? "Project").font(.headline)
            Text("Branch: \(config["integration"]?.object["branch"]?.text ?? "Unknown") · Owner: \(workspace.hostLabel(repository.object["canonicalHostId"]?.text ?? ""))").font(.caption)
            if workspace.repositoryLoading { ProgressView("Refreshing project status…").controlSize(.small) }
            Text(publicationText).font(.caption)
            if publication["freshness"]?.text == "stale" { Text("Retained observation — refresh to confirm the remote.").font(.caption).foregroundStyle(.secondary) }
            if let blocked = publication["blockedReason"]?.text, !blocked.isEmpty { Text(blocked.replacingOccurrences(of: "_", with: " ").capitalized).font(.caption) }
            if let pending = status["pending"]?.object {
                Text("Queued locally: \(pending["localSubmissions"]?.formatted ?? "0") · Landing: \(pending["landingJobs"]?.formatted ?? "0")").font(.caption).foregroundStyle(.secondary)
            }
            HStack {
                if let setup = ProjectSetup.initialize(repository: repository, status: workspace.repositoryStatus, localHostID: workspace.localHostID) {
                    Button("Initialize history…") { initialization = setup }.disabled(workspace.sending || workspace.pendingRequest != nil || workspace.repositoryLoading)
                }
                if let draft = RepositorySettingsDraft(repository) { Button("Project settings…") { settingsDraft = draft }.disabled(workspace.sending || workspace.pendingRequest != nil) }
                if ["migration-required", "mathy-v1", "maincharacter-v1", "roboty-v1", "glassalpha-v1"].contains(config["integration"]?.object["adapter"]?.text ?? "") {
                    Button("Project migration…") { migrationReview = true }
                }
                Button("Refresh remote status") { Task { await workspace.loadRepository(refresh: true) } }.disabled(workspace.repositoryLoading)
                Button("Run local checks") {
                    guard let id = repository.object["id"]?.text else { return }
                    Task { await workspace.submit("checks.run", args: ["repo": .string(id)]) }
                }.disabled(workspace.sending || workspace.pendingRequest != nil)
            }.controlSize(.small)
        }.padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .sheet(isPresented: Binding(get: { settingsDraft != nil }, set: { if !$0 { settingsDraft = nil } })) {
            if let settingsDraft { RepositorySettingsSheet(workspace: workspace, draft: settingsDraft) }
        }
        .sheet(item: $initialization) { selection in ProjectSetupReview(workspace: workspace, selection: selection) }
        .sheet(isPresented: $migrationReview) { MigrationReviewSheet(workspace: workspace, repositoryID: repository.object["id"]!.text) }
    }
}

struct RunSummary: View {
    let detail: JSONValue
    let operation: JSONValue?
    var body: some View {
        let result = detail.object["result"]?.object ?? [:], input = operation?.object["input"]?.object ?? [:]
        let tip = input["tip"]?.text ?? input["sourceTip"]?.text ?? input["expectedTip"]?.text ?? result["sourceTip"]?.text
        VStack(alignment: .leading, spacing: 7) {
            if let tip, !tip.isEmpty {
                let base = input["base"]?.text
                Text("Source: " + (base.map { String($0.prefix(12)) + "…" } ?? "") + String(tip.prefix(12))).font(.caption.monospaced()).textSelection(.enabled)
            }
            HStack {
                Text("Gate: " + ActivityItem.gateLabel(result["gate"]?.object["state"]?.text))
                Text("Delivery: " + (result["delivery"]?.text ?? "Not requested").replacingOccurrences(of: "_", with: " "))
            }.font(.caption)
            if let failure = detail.object["error"]?.object, let reason = failure["message"]?.text, !reason.isEmpty {
                Label(reason, systemImage: "exclamationmark.circle").textSelection(.enabled)
                ForEach(Array((failure["nextActions"]?.array ?? []).enumerated()), id: \.offset) { _, action in
                    Button("Copy \(action.object["label"]?.text ?? "next action")") {
                        let command = (action.object["argv"]?.array ?? []).map { "'" + $0.text.replacingOccurrences(of: "'", with: "'\\''") + "'" }.joined(separator: " ")
                        NSPasteboard.general.clearContents(); NSPasteboard.general.setString(command, forType: .string)
                    }.controlSize(.small)
                }
            }
            let checks = result["checks"]?.array ?? result["gate"]?.object["checks"]?.array ?? []
            if !checks.isEmpty {
                DisclosureGroup("Checks (\(checks.count))") {
                    ScrollView { VStack(alignment: .leading) { ForEach(Array(checks.enumerated()), id: \.offset) { _, check in
                        VStack(alignment: .leading, spacing: 3) {
                            Text("\(check.object["id"]?.text ?? "Check"): \((check.object["state"]?.text ?? "Unknown").replacingOccurrences(of: "_", with: " "))").bold()
                            if let command = check.object["argv"]?.array { Text(command.map(\.text).joined(separator: " ")).font(.caption.monospaced()).textSelection(.enabled) }
                            if let duration = check.object["durationMilliseconds"] { Text("Duration: \(duration.formatted) ms").font(.caption) }
                            if let profile = check.object["profile"]?.text { Text("Profile: \(profile)").font(.caption) }
                            Text(check.object["childOutcomes"]?.text == "original_project_output" ? "Individual results remain in the original project output." : "Fresh execution; see the matching check marker in the log.").font(.caption).foregroundStyle(.secondary)
                        }.frame(maxWidth: .infinity, alignment: .leading).padding(.bottom, 6)
                    } }.frame(maxWidth: .infinity, alignment: .leading) }.frame(maxHeight: 180)
                }
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}
