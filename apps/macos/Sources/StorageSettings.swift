import SwiftUI
import ContributionPlatform

struct StorageSettings: View {
    @Bindable var workspace: Workspace
    @State private var machine: JSONValue = .null
    @State private var revision = ""
    @State private var usage: JSONValue = .null
    @State private var rawDays = ""
    @State private var capMiB = ""
    @State private var category: StorageCategory = .output
    @State private var review: StorageReview?
    @State private var loading = false
    @State private var message = ""
    private var policy: JSONValue? { StorageReview.retention(rawDays: rawDays, capMiB: capMiB, existing: machine.object["retention"] ?? .null) }
    var body: some View {
        Form {
            Section("Retained logs") {
                LabeledContent("Raw logs", value: bytes(usage.object["totalBytes"]))
                LabeledContent("Protected logs", value: bytes(usage.object["protectedBytes"]))
                LabeledContent("Eligible for expiration", value: bytes(usage.object["eligibleBytes"]))
                if usage.object["admissionBlocked"] == .bool(true) {
                    Label("Log storage is full. New work is waiting for space.", systemImage: "exclamationmark.circle")
                }
                TextField("Keep raw logs for days", text: $rawDays)
                TextField("Log cap (MiB)", text: $capMiB)
                Button("Save log policy") { Task { await save() } }.disabled(policy == nil || revision.isEmpty || loading || workspace.sending || workspace.pendingRequest != nil)
                Text("Pinned and unresolved evidence stays protected. This cap covers raw logs; artifacts, source checkouts and other retained files use separate cleanup.").font(.caption).foregroundStyle(.secondary)
                Text("Operation summaries are currently preserved. Automatic summary expiration is not yet available.").font(.caption).foregroundStyle(.secondary)
            }
            Section("Review cleanup") {
                Picker("Files to review", selection: $category) { ForEach(StorageCategory.allCases) { category in Text(category.title).tag(category) } }
                Button("Review eligible files…") { Task { await preview() } }.disabled(loading || workspace.sending || workspace.pendingRequest != nil)
                Text("Review the exact files before removal. Changed or protected work stays in place.").font(.caption).foregroundStyle(.secondary)
            }
            if !message.isEmpty { Text(message).textSelection(.enabled) }
            Button("Refresh usage and saved policy") { Task { await load() } }.disabled(loading)
            if loading { ProgressView().controlSize(.small).accessibilityLabel("Loading storage") }
        }.formStyle(.grouped).task { await load() }
        .sheet(item: $review) { StorageReviewSheet(workspace: workspace, review: $0) }
    }
    private func load() async {
        guard !loading else { return }; loading = true; defer { loading = false }
        if let response = await workspace.call("settings.get") {
            let result = response.fields["result"]?.object ?? [:]
            machine = result["settings"] ?? .null; revision = result["revision"]?.text ?? ""
            if case .number(let days) = machine.object["retention"]?.object["rawLogDays"] { rawDays = NSDecimalNumber(decimal: days).stringValue }
            if case .number(let cap) = machine.object["retention"]?.object["maxLogBytes"] { capMiB = NSDecimalNumber(decimal: cap / 1_048_576).stringValue }
        }
        if let response = await workspace.call("doctor") { usage = response.fields["result"]?.object["storage"] ?? .null }
    }
    private func preview() async {
        guard !loading else { return }; loading = true; defer { loading = false }
        let selected = category
        if let response = await workspace.call("service.storage", selected.previewArguments), let value = response.fields["result"] {
            if let selection = StorageReview(category: selected, value: value) { review = selection }
            else { message = "The service returned an incomplete cleanup review. Nothing was removed." }
        }
    }
    private func save() async {
        guard let policy else { return }
        var updated = machine.object; updated["retention"] = policy
        let response = await workspace.submit("settings.apply", args: ["config": .object(updated), "expectedRevision": .string(revision)])
        if response?.fields["error"] == .null { revision = ""; message = "Policy change accepted. Follow its result in Activity, then refresh the saved policy." }
    }
    private func bytes(_ value: JSONValue?) -> String {
        guard case .number(let count) = value else { return "Not observed" }
        return ByteCountFormatter.string(fromByteCount: NSDecimalNumber(decimal: count).int64Value, countStyle: .file)
    }
}

private struct StorageReviewSheet: View {
    @Bindable var workspace: Workspace
    let review: StorageReview
    @State private var result = ""
    @State private var finished = false
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(review.category.title).font(.title2)
            Text("\(review.candidates.count) eligible · \(review.protectedEntries.count) protected")
            if case .number(let bytes) = review.value.object["eligibleBytes"] {
                Text(ByteCountFormatter.string(fromByteCount: NSDecimalNumber(decimal: bytes).int64Value, countStyle: .file) + " selected for removal")
            }
            if review.category == .worktrees { Text("Native task worktrees and committed retention references are preserved.").font(.caption).foregroundStyle(.secondary) }
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    ForEach(Array(review.candidates.enumerated()), id: \.offset) { _, candidate in
                        VStack(alignment: .leading) {
                            Text(candidate.object["directory"]?.text ?? "Retained output").textSelection(.enabled)
                            Text(candidate.object["kind"]?.text ?? "Contribution temporary checkout").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    ForEach(Array(review.protectedEntries.enumerated()), id: \.offset) { _, candidate in
                        VStack(alignment: .leading) {
                            Label(candidate.object["directory"]?.text ?? candidate.object["key"]?.text ?? "Protected evidence", systemImage: "lock").textSelection(.enabled)
                            Text(protectedReason(candidate.object["reason"]?.text ?? "")).foregroundStyle(.secondary)
                        }.font(.caption)
                    }
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
            if !result.isEmpty { Text(result).textSelection(.enabled) }
            if let error = workspace.error { Text(error).foregroundStyle(.red).textSelection(.enabled) }
            HStack {
                Button("Done") { dismiss() }.keyboardShortcut(.cancelAction)
                Spacer()
                Button("Remove reviewed files", role: .destructive) { Task { await remove() } }
                    .disabled(review.cleanupArguments == nil || workspace.sending || workspace.pendingRequest != nil || finished)
            }
        }.padding(24).frame(width: 620, height: 460)
    }
    private func remove() async {
        guard let args = review.cleanupArguments else { return }
        if let response = await workspace.submit("service.storage", args: args), response.fields["error"] == .null {
            finished = true; result = "Removed \(response.fields["result"]?.object["removed"]?.array.count ?? 0) reviewed items. Operation receipts remain available."
        } else if workspace.pendingRequest != nil { result = "The cleanup remains unfinished. Reconcile the retained request after resolving the reported condition." }
    }
    private func protectedReason(_ code: String) -> String {
        switch code {
        case "DIRTY_PRIMARY": "Contains local changes."
        case "WORKTREE_LOCAL_OUTPUT": "Contains untracked or ignored files."
        case "WORKTREE_LOCKED": "The checkout is locked."
        case "WORKTREE_DEPENDENCY_ACTIVE": "Other unfinished or pinned work still needs this clone."
        case "WORKTREE_PROCESS_UNCONFIRMED": "A retained process may still be using this clone."
        case "WORKTREE_HISTORY_UNRETAINED": "The detached commit needs a retained history reference."
        case "WORKTREE_PROTECTED", "UNRESOLVED_PINNED_RECENT_OR_UNCONFIRMED": "Recent, pinned or unresolved evidence remains protected."
        default: "Ownership or cleanup eligibility could not be confirmed."
        }
    }
}
