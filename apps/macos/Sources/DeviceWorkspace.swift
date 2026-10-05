import AppKit
import SwiftUI
import ContributionPlatform

/// Selections and observations stay local to this sheet; the service owns all work.
struct DeviceWorkspace: View {
    let repository: String
    let client: ServiceClient
    let onAccepted: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var hosts: [JSONValue] = []
    @State private var localHost = ""
    @State private var host = ""
    @State private var device = ""
    @State private var devices: [JSONValue] = []
    @State private var profile: JSONValue = .null
    @State private var status: JSONValue = .null
    @State private var artifacts: [JSONValue] = []
    @State private var apps: [JSONValue] = []
    @State private var action = "prepare"
    @State private var buildProfile = ""
    @State private var sourceTip = ""
    @State private var artifact = ""
    @State private var appRef = ""
    @State private var plan = ""
    @State private var sessionProfile = ""
    @State private var duration = 30
    @State private var error = ""
    @State private var message = ""
    @State private var loading = false
    @State private var sending = false
    @State private var generation = UUID()
    @State private var pending: RetainedRequest?
    @State private var profileDraft: JSONValue = .null
    private let actions = ["prepare", "connect", "install", "launch", "logs", "test", "ui", "debug", "screenshot", "screen_capture", "disconnect", "qualify"]
    private var scope: String { host + ":" + device }
    private var base: [String: JSONValue] { ["repo": .string(repository), "host": .string(host), "device": .string(device)] }
    private var config: [String: JSONValue] { profile.object["config"]?.object ?? [:] }
    private var plans: [JSONValue] { config["qualificationPlans"]?.array ?? [] }
    private var selectedAction: String { action == "qualify" ? plans.first { $0.object["id"]?.text == plan }?.object["operation"]?.text ?? "" : action }
    private var availability: JSONValue { status.object["availability"]?.array.first { $0.object["operation"]?.text == selectedAction } ?? .null }
    private var journal: NativeRequestJournal { NativeRequestJournal(directory: client.directory) }
    private var selectedDeviceIDs: [String] {
        Array(Set(devices.compactMap { $0.object["deviceId"]?.text } + (config["eligibleDeviceRefs"]?.array.compactMap { $0.text } ?? []))).sorted()
    }
    private var formValid: Bool {
        guard !host.isEmpty, !device.isEmpty, profile != .null, !selectedAction.isEmpty else { return false }
        if action == "qualify", plan.isEmpty { return false }
        if selectedAction == "prepare", buildProfile.isEmpty || sourceTip.range(of: "^[0-9a-f]{40}$", options: .regularExpression) == nil { return false }
        if selectedAction == "install", artifact.isEmpty { return false }
        if selectedAction == "launch", appRef.isEmpty { return false }
        if ["test", "ui", "debug"].contains(selectedAction), sessionProfile.isEmpty { return false }
        if selectedAction != "prepare", action != "qualify", availability.object["callable"]?.boolean != true { return false }
        return true
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack { Text("Devices").font(.title2); Spacer(); Button("Refresh") { Task { await refresh() } }.disabled(loading || sending || host.isEmpty); Button("Done") { dismiss() }.disabled(sending) }
            if !error.isEmpty { Text(error).foregroundStyle(.orange).textSelection(.enabled).accessibilityIdentifier("devices.error") }
            if !message.isEmpty { Text(message).textSelection(.enabled) }
            if let pending {
                GroupBox("Awaiting a confirmed reply") {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("\(pending.command) · \(pending.requestID)").textSelection(.enabled)
                        DisclosureGroup("Retained selection") { Text(JSONValue.object(pending.args).formatted).font(.caption.monospaced()).textSelection(.enabled) }
                        Text("The service may have accepted this request. Reconcile the same request before submitting another action.").font(.caption)
                        Button("Reconcile retained request") { Task { await sendPending() } }.disabled(sending)
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            Form {
                Section("Selection") {
                    Picker("Execution Mac", selection: $host) {
                        Text("Choose a Mac").tag("")
                        ForEach(Array(hosts.enumerated()), id: \.offset) { _, row in
                            Text(row.object["label"]?.text ?? row.object["alias"]?.text ?? "Paired Mac").tag(row.object["hostId"]?.text ?? "")
                        }
                    }
                    Picker("iPhone", selection: $device) {
                        Text("Choose an iPhone").tag("")
                        ForEach(selectedDeviceIDs, id: \.self) { id in Text(devices.first { $0.object["deviceId"]?.text == id }?.object["label"]?.text ?? id).tag(id) }
                    }
                    Text("Discovery and saved build eligibility do not grant device access.").font(.caption).foregroundStyle(.secondary)
                }.disabled(sending || pending != nil)
                DeviceReadiness(value: status)
                actionFields.disabled(sending || pending != nil || loading)
                Section("Project profile and permissions") {
                    if host == localHost && !host.isEmpty {
                        Button("Choose private profile file…") { chooseProfile() }.disabled(sending || pending != nil)
                        if profileDraft != .null {
                            DisclosureGroup("Review selected profile") { Text(profileDraft.formatted).font(.caption.monospaced()).textSelection(.enabled) }
                            Button("Apply reviewed profile") { Task { await submit("devices.configure", args: ["repo": .string(repository), "host": .string(host), "config": profileDraft, "expectedRevision": profile.object["revision"] ?? .string("none")]) } }.disabled(sending || pending != nil || profile == .null)
                        }
                        HStack {
                            Button("Authorize \(label(selectedAction))") { Task { await permission(false) } }
                            Button("Revoke \(label(selectedAction))") { Task { await permission(true) } }
                        }.disabled(sending || pending != nil || device.isEmpty || selectedAction.isEmpty || profile == .null)
                        Text("Authorization is limited to this project, Mac, iPhone and named action. Qualification and current readiness are checked separately.").font(.caption).foregroundStyle(.secondary)
                    } else { Text("Configure the project profile and grant permissions in Contribution on the selected Mac.").foregroundStyle(.secondary) }
                }
            }.formStyle(.grouped)
            HStack {
                if loading || sending { ProgressView().controlSize(.small) }
                Spacer()
                Button(action == "qualify" ? "Run selected qualification" : label(action)) { Task { await runAction() } }
                    .disabled(!formValid || loading || sending || pending != nil)
                    .accessibilityIdentifier("devices.submit")
            }
        }.padding(20).frame(width: 800, height: 740)
        .task { await loadHosts() }
        .task(id: scope) { await refresh() }
        .onChange(of: host) { _, _ in device = ""; profileDraft = .null }
        .onChange(of: action) { _, _ in message = "" }
        .onDisappear { generation = UUID() }
    }
    private var actionFields: some View {
        Section("Action") {
            Picker("Action", selection: $action) { ForEach(actions, id: \.self) { Text(label($0)).tag($0) } }
            if action == "qualify" {
                Picker("Approved qualification plan", selection: $plan) {
                    Text("Choose a plan").tag("")
                    ForEach(Array(plans.enumerated()), id: \.offset) { _, row in Text("\(row.object["id"]?.text ?? "") · \(label(row.object["operation"]?.text ?? ""))").tag(row.object["id"]?.text ?? "") }
                }
            }
            if selectedAction == "prepare" {
                Picker("Build profile", selection: $buildProfile) {
                    Text("Choose a build").tag("")
                    ForEach(Array((config["builds"]?.array ?? []).enumerated()), id: \.offset) { _, row in Text(row.object["id"]?.text ?? "").tag(row.object["id"]?.text ?? "") }
                }
                TextField("Exact committed source (40-character SHA)", text: $sourceTip)
                Text("Prepares a signed artifact on the selected Mac. The phone is not contacted.").font(.caption).foregroundStyle(.secondary)
            }
            if selectedAction == "install" {
                Picker("Prepared artifact", selection: $artifact) {
                    Text("Choose a verified artifact").tag("")
                    ForEach(Array(artifacts.enumerated()), id: \.offset) { _, row in
                        let p = row.object["provenance"]?.object ?? [:]
                        Text("\(p["app"]?.object["bundleId"]?.text ?? "App") · build \(p["app"]?.object["buildVersion"]?.text ?? "?") · \(p["artifactId"]?.text ?? "")").tag(p["artifactId"]?.text ?? "")
                    }
                }
                Text("Updates the selected app in place. Launch is a separate action.").font(.caption).foregroundStyle(.secondary)
            }
            if selectedAction == "launch" {
                Picker("Observed installed app", selection: $appRef) {
                    Text("Choose an installed app").tag("")
                    ForEach(Array(apps.enumerated()), id: \.offset) { _, row in Text("\(row.object["app"]?.object["bundleId"]?.text ?? "App") · build \(row.object["app"]?.object["buildVersion"]?.text ?? "?")").tag(row.object["appRef"]?.text ?? "") }
                }
                Text("This action may bring the app to the foreground. The installed identity is checked again before launch.").font(.caption).foregroundStyle(.secondary)
            }
            if ["test", "ui", "debug"].contains(selectedAction) { TextField("Registered session profile", text: $sessionProfile) }
            if ["logs", "test", "ui", "debug", "screen_capture"].contains(selectedAction) { Stepper("Duration limit: \(duration) seconds", value: $duration, in: 1...300) }
            if availability != .null {
                Text(availability.object["callable"]?.boolean == true ? "Available in the last observation. The service checks readiness again before execution." : "Requires attention: \(reasons(availability))").font(.caption).foregroundStyle(.secondary)
            } else if selectedAction != "prepare" { Text("Refresh an explicit device selection to inspect readiness. Unsupported or unqualified actions remain blocked by the service.").font(.caption).foregroundStyle(.secondary) }
        }
    }
    private func label(_ value: String) -> String { value.replacingOccurrences(of: "_", with: " ").capitalized }
    private func reasons(_ value: JSONValue) -> String { value.object["reasonCodes"]?.array.map { label($0.text) }.joined(separator: " · ") ?? "Readiness unknown" }
    private func request(_ command: String, _ args: [String: JSONValue] = [:]) async throws -> ResponseEnvelope {
        let result = try await client.request(command, args: args)
        if let failure = result.fields["error"], failure != .null { throw NSError(domain: "Contribution.Device", code: 3, userInfo: [NSLocalizedDescriptionKey: failure.object["message"]?.text ?? "The service could not complete this request."]) }
        return result
    }
    private func loadHosts() async {
        do {
            pending = try journal.pending()
            let service = try await request("service.status"), response = try await request("hosts.list")
            guard !Task.isCancelled else { return }
            localHost = service.fields["result"]?.object["hostId"]?.text ?? ""
            hosts = response.fields["result"]?.object["hosts"]?.array ?? []
        } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }
    private func refresh() async {
        let token = UUID(); generation = token
        status = .null; profile = .null; devices = []; artifacts = []; apps = []
        artifact = ""; appRef = ""; buildProfile = ""; plan = ""
        guard !host.isEmpty else { loading = false; return }
        loading = true; error = ""
        let selected = base
        defer { if generation == token { loading = false } }
        do {
            let value = try await request("devices.profile", ["repo": .string(repository), "host": .string(host)])
            guard !Task.isCancelled, generation == token else { return }; profile = value.fields["result"] ?? .null
            let readScope: [String: JSONValue] = ["repo": .string(repository), "host": selected["host"] ?? .null]
            let prepared = try await request("devices.artifacts.list", readScope)
            guard !Task.isCancelled, generation == token else { return }; artifacts = prepared.fields["result"]?.object["artifacts"]?.array ?? []
            do {
                let inventory = try await request("devices.list", readScope)
                guard !Task.isCancelled, generation == token else { return }; devices = inventory.fields["result"]?.object["devices"]?.array ?? []
            } catch { if !Task.isCancelled, generation == token { self.error = error.localizedDescription } }
            guard !device.isEmpty, config["app"] != nil else { return }
            let installed = try await request("devices.apps", selected)
            guard !Task.isCancelled, generation == token else { return }; apps = installed.fields["result"]?.object["apps"]?.array ?? []
            var args = selected; args["refresh"] = .bool(true)
            let observed = try await request("devices.status", args)
            guard !Task.isCancelled, generation == token else { return }; status = observed.fields["result"] ?? .null
        } catch { if !Task.isCancelled, generation == token { self.error = error.localizedDescription } }
    }
    private func chooseProfile() {
        let panel = NSOpenPanel(); panel.canChooseFiles = true; panel.canChooseDirectories = false; panel.allowsMultipleSelection = false
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            let values = try url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
            guard values.isRegularFile == true, let count = values.fileSize, count <= 524_288 else { throw NSError(domain: "Contribution.Device", code: 2, userInfo: [NSLocalizedDescriptionKey: "Choose a JSON profile file smaller than 512 KiB."]) }
            profileDraft = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: url)); error = ""
        } catch { self.error = error.localizedDescription }
    }
    private func permission(_ revoke: Bool) async {
        var args = base; args["operations"] = .array([.string(selectedAction)])
        await submit(revoke ? "devices.revoke" : "devices.authorize", args: args)
    }
    private func runAction() async {
        var args = base, command = "devices.\(action)"
        if action == "qualify" { args["plan"] = .string(plan) }
        if selectedAction == "prepare" { args["buildProfile"] = .string(buildProfile); args["sourceTip"] = .string(sourceTip) }
        if selectedAction == "install" { args["artifact"] = .string(artifact) }
        if selectedAction == "launch" { args["appRef"] = .string(appRef) }
        if ["test", "ui", "debug"].contains(selectedAction) { args["sessionProfile"] = .string(sessionProfile) }
        if ["logs", "test", "ui", "debug", "screen_capture"].contains(selectedAction) { args["durationSeconds"] = .number(Decimal(duration)); args["maxBytes"] = .number(8_388_608) }
        if action == "screenshot" || action == "screen_capture" { command = "devices.capture"; args["kind"] = .string(action == "screenshot" ? "screenshot" : "screen") }
        await submit(command, args: args)
    }
    private func submit(_ command: String, args: [String: JSONValue]) async {
        guard !sending, pending == nil else { return }
        do { let value = RetainedRequest(command: command, args: args); try journal.retain(value); pending = value; await sendPending() }
        catch { self.error = error.localizedDescription; pending = try? journal.pending() }
    }
    private func sendPending() async {
        guard let value = pending, !sending else { return }
        sending = true; error = ""; defer { sending = false }
        do {
            let response = try await client.request(value.command, args: value.args)
            try journal.resolve(value); pending = nil
            if let failure = response.fields["error"], failure != .null { error = failure.object["message"]?.text ?? "Request declined." }
            else {
                if let id = response.operationID { onAccepted(id); message = "Request retained. Follow its result in Activity." }
                else { message = "Change recorded. Refresh to inspect current readiness." }
                profileDraft = .null
            }
        } catch { self.error = error.localizedDescription }
    }
}

private struct DeviceReadiness: View {
    let value: JSONValue
    var body: some View {
        Section("Readiness") {
            if value == .null { Text("Select a Mac and iPhone to inspect readiness.").foregroundStyle(.secondary) }
            else {
                ForEach([("host", "Mac"), ("trust", "Trust"), ("developerService", "Developer service"), ("ownership", "Ownership")], id: \.0) { key, title in
                    LabeledContent(title, value: value.object[key]?.object["state"]?.text.replacingOccurrences(of: "_", with: " ").capitalized ?? "Unknown")
                }
                LabeledContent("Network context", value: value.object["network"]?.object["scenario"]?.text.replacingOccurrences(of: "_", with: " ") ?? "Unknown")
                Text("Observed \(value.object["observedAt"]?.text ?? "at an unknown time"). Support is specific to this operation, device and connection.").font(.caption).foregroundStyle(.secondary)
                DisclosureGroup("Operation capabilities") {
                    ForEach(Array((value.object["capabilities"]?.array ?? []).enumerated()), id: \.offset) { _, row in
                        LabeledContent(row.object["operation"]?.text.replacingOccurrences(of: "_", with: " ").capitalized ?? "Action", value: row.object["support"]?.text.replacingOccurrences(of: "_", with: " ") ?? "Unknown")
                    }
                }
            }
        }
    }
}
