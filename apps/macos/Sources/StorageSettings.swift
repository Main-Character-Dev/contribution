import SwiftUI
import ContributionPlatform

struct StorageSettings: View {
    @Bindable var workspace: Workspace
    @State private var machine: JSONValue = .null
    @State private var revision = ""
    @State private var usage: JSONValue = .null
    @State private var managedUsage: JSONValue = .null
    @State private var managedRevision = ""
    @State private var managedCapGiB = ""
    @State private var controlPending: RetainedRequest?
    @State private var controlSending = false
    @State private var rawDays = ""
    @State private var capMiB = ""
    @State private var category: StorageCategory = .output
    @State private var review: StorageReview?
    @State private var loading = false
    @State private var message = ""
    private var policy: JSONValue? { StorageReview.retention(rawDays: rawDays, capMiB: capMiB, existing: machine.object["retention"] ?? .null) }
    private var controlJournal: NativeRequestJournal { NativeRequestJournal(directory: workspace.client.directory, slot: .storageSettings) }
    var body: some View {
        Form {
            if let controlPending {
                Section("Storage setting needs reconciliation") {
                    Text("The reply to \(controlPending.command) is unresolved. Its reviewed policy is retained.")
                    Button("Reconcile storage setting") { Task { await sendControl() } }.disabled(controlSending || loading)
                }
            }
            Section("Managed data") {
                LabeledContent(managedUsage.object["complete"] == .bool(true) ? "Logical size" : "Counted so far", value: bytes(managedUsage.object["logicalBytes"]))
                if managedUsage.object["admissionBlocked"] == .bool(true) {
                    Text(managedUsage.object["complete"] == .bool(true) ? "Managed data reached its cap. Review cleanup or raise the limit to admit new work." : "Usage could not be fully inspected. New work remains blocked; refresh usage for the current result.")
                        .foregroundStyle(.orange)
                }
                TextField("Managed-data cap (GiB)", text: $managedCapGiB)
                Button("Save managed-data limit") { Task {
                    guard let policy = StorageReview.managedPolicy(capGiB: managedCapGiB) else { return }
                    await submitControl("service.storage-policy", args: ["config": policy, "expectedRevision": .string(managedRevision)])
                } }.disabled(StorageReview.managedPolicy(capGiB: managedCapGiB) == nil || managedRevision.isEmpty || loading || controlSending || controlPending != nil)
                Text("Includes retained payloads, backups, build output, logs and other files in Contribution’s private support folder. Source repositories and external exports stay outside this accounting. Active work can still produce retained output.").font(.caption).foregroundStyle(.secondary)
                DisclosureGroup("Usage by category") {
                    ForEach(Array((managedUsage.object["categories"]?.array ?? []).enumerated()), id: \.offset) { _, row in
                        LabeledContent((row.object["category"]?.text ?? "Unknown").replacingOccurrences(of: "_", with: " ").capitalized, value: bytes(row.object["logicalBytes"]))
                    }
                }
            }
            Section("Retained logs") {
                LabeledContent("Raw logs", value: bytes(usage.object["totalBytes"]))
                LabeledContent("Protected logs", value: bytes(usage.object["protectedBytes"]))
                LabeledContent("Eligible for expiration", value: bytes(usage.object["eligibleBytes"]))
                if usage.object["admissionBlocked"] == .bool(true) {
                    Label("Log storage is full. New work is waiting for space.", systemImage: "exclamationmark.circle")
                }
                TextField("Keep raw logs for days", text: $rawDays)
                TextField("Log cap (MiB)", text: $capMiB)
                Button("Save log policy") { Task { await save() } }.disabled(policy == nil || revision.isEmpty || loading || controlSending || controlPending != nil)
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
        do { controlPending = try controlJournal.pending() } catch { message = error.localizedDescription }
        if let response = await workspace.call("settings.get") {
            let result = response.fields["result"]?.object ?? [:]
            machine = result["settings"] ?? .null; revision = result["revision"]?.text ?? ""
            if case .number(let days) = machine.object["retention"]?.object["rawLogDays"] { rawDays = NSDecimalNumber(decimal: days).stringValue }
            if case .number(let cap) = machine.object["retention"]?.object["maxLogBytes"] { capMiB = NSDecimalNumber(decimal: cap / 1_048_576).stringValue }
        }
        if let response = await workspace.call("doctor") { usage = response.fields["result"]?.object["storage"] ?? .null }
        if let response = await workspace.call("service.storage-policy") {
            let result = response.fields["result"]?.object ?? [:]
            managedUsage = result["usage"] ?? .null; managedRevision = result["revision"]?.text ?? ""
            if case .number(let cap) = result["policy"]?.object["maxStateBytes"] { managedCapGiB = NSDecimalNumber(decimal: cap / 1_073_741_824).stringValue }
        }
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
        await submitControl("settings.apply", args: ["config": .object(updated), "expectedRevision": .string(revision)])
    }
    private func submitControl(_ command: String, args: [String: JSONValue]) async {
        guard !controlSending, controlPending == nil else { return }
        do { let request = RetainedRequest(command: command, args: args); try controlJournal.retain(request); controlPending = request; await sendControl() }
        catch { message = error.localizedDescription }
    }
    private func sendControl() async {
        guard let request = controlPending, !controlSending else { return }; controlSending = true; defer { controlSending = false }
        do {
            let response = try await workspace.client.request(request.command, args: request.args)
            if try controlJournal.resolveIfComplete(request, response: response) { controlPending = nil }
            if let failure = response.fields["error"], failure != .null { message = failure.object["message"]?.text ?? "Storage setting could not complete" }
            else if let operation = response.operationID { workspace.selectedOperation = operation; message = "Log policy change accepted. Follow its result in Activity, then refresh the saved policy." }
            else { message = "Managed-data policy saved." }
        } catch { message = error.localizedDescription }
        await load()
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
