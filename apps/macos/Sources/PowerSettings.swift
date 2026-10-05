import SwiftUI
import ContributionPlatform

struct PowerSettings: View {
    @Bindable var workspace: Workspace
    @State private var keepAwake = false
    @State private var revision = ""
    @State private var status = "Not observed"
    @State private var pending: RetainedRequest?
    @State private var busy = false
    @State private var message = ""
    private var journal: NativeRequestJournal { NativeRequestJournal(directory: workspace.client.directory, slot: .powerSettings) }
    var body: some View {
        Section("Power during work") {
            Toggle("Keep this Mac awake while work runs", isOn: $keepAwake).disabled(busy || pending != nil)
            LabeledContent("Current request", value: status)
            Text("Prevents idle sleep during active Contribution jobs. Display sleep, deliberate sleep, lid closure and shutdown still apply. Waiting for an offline host does not keep this Mac awake.").font(.caption).foregroundStyle(.secondary)
            if pending != nil {
                Text("An earlier power preference has an unresolved reply. Its exact selection is retained.").font(.caption)
                Button("Reconcile power preference") { Task { await send() } }.disabled(busy)
            } else {
                Button("Save power preference") { Task { await save() } }.disabled(busy || revision.isEmpty)
            }
            Button("Refresh power status") { Task { await load() } }.disabled(busy)
            if !message.isEmpty { Text(message).font(.caption).textSelection(.enabled) }
        }.task { await load() }
    }
    private func load() async {
        guard !busy else { return }; busy = true; defer { busy = false }
        do {
            pending = try journal.pending()
            let response = try await workspace.client.request("service.power-policy")
            if let failure = response.fields["error"], failure != .null { message = failure.object["message"]?.text ?? "Power status is unavailable"; revision = ""; return }
            let result = response.fields["result"]?.object ?? [:]
            keepAwake = result["policy"]?.object["keepAwakeWhileWorking"]?.boolean ?? false
            revision = result["revision"]?.text ?? ""
            switch result["state"]?.text {
            case "requested": status = "Idle-sleep prevention requested"
            case "requesting": status = "Starting idle-sleep request"
            case "inactive": status = "Inactive"
            case "unavailable": status = "Unavailable — work can continue without sleep prevention"
            default: status = "Not observed"
            }
        } catch { revision = ""; message = error.localizedDescription }
    }
    private func save() async {
        guard !busy, pending == nil, !revision.isEmpty else { return }
        do {
            let request = RetainedRequest(command: "service.power-policy", args: ["expectedRevision": .string(revision), "config": .object(["schemaVersion": .number(1), "keepAwakeWhileWorking": .bool(keepAwake)])])
            try journal.retain(request); pending = request; await send()
        } catch { message = error.localizedDescription }
    }
    private func send() async {
        guard !busy, let request = pending else { return }; busy = true
        do {
            let response = try await workspace.client.request(request.command, args: request.args)
            if try journal.resolveIfComplete(request, response: response) { pending = nil }
            if let failure = response.fields["error"], failure != .null { message = failure.object["message"]?.text ?? "Preference was not saved" }
            else { message = "Power preference saved." }
        } catch { message = error.localizedDescription }
        busy = false; await load()
    }
}
