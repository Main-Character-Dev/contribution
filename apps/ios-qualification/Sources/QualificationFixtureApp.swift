import SwiftUI
import Observation
import Security
import CryptoKit

private struct FixtureState: Codable {
    let schemaVersion: Int
    let installationMarker: UUID
    let createdAt: Date
    var records: [String]
    var draft: String
    var configuration: String
    var pendingOperation: String
    let keychainProof: String
}

@MainActor @Observable private final class FixtureStore {
    var state: FixtureState?
    var error: String?
    var keychainStatus = "Not checked"
    private let location: URL
    private let account = "qualification-continuity-v1"
    init() {
        location = URL.applicationSupportDirectory.appendingPathComponent("Qualification/state.json")
        load()
    }
    private func hash(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
    private var keyQuery: [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: Bundle.main.bundleIdentifier ?? "QualificationFixture", kSecAttrAccount as String: account] }
    private func readKey() throws -> Data? {
        var query = keyQuery; query[kSecReturnData as String] = true; query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw NSError(domain: NSOSStatusErrorDomain, code: Int(status)) }
        return data
    }
    func load() {
        do {
            if FileManager.default.fileExists(atPath: location.path) {
                let value = try JSONDecoder().decode(FixtureState.self, from: Data(contentsOf: location))
                guard value.schemaVersion == 1 else { throw CocoaError(.fileReadUnknown) }
                state = value
            }
            let key = try readKey()
            if let state { keychainStatus = key.map { hash($0) == state.keychainProof ? "Continuity confirmed" : "Key differs from retained state" } ?? "Key missing" }
            else { keychainStatus = key == nil ? "No fixture key yet" : "Retained key found without local fixture state" }
        } catch { self.error = "Existing state was preserved: \(error.localizedDescription)" }
    }
    func create() {
        guard state == nil, !FileManager.default.fileExists(atPath: location.path) else { return }
        do {
            let key: Data
            if let retained = try readKey() { key = retained }
            else {
                key = Data(UUID().uuidString.utf8)
                var query = keyQuery; query[kSecValueData as String] = key
                query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
                let status = SecItemAdd(query as CFDictionary, nil)
                guard status == errSecSuccess else { throw NSError(domain: NSOSStatusErrorDomain, code: Int(status)) }
            }
            state = FixtureState(schemaVersion: 1, installationMarker: UUID(), createdAt: Date(), records: ["First retained fixture record"], draft: "An unfinished draft", configuration: "Local only", pendingOperation: "Simulated unsent operation", keychainProof: hash(key))
            try save(); load()
        } catch { self.error = error.localizedDescription }
    }
    private func save() throws {
        guard let state else { return }
        try FileManager.default.createDirectory(at: location.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(state).write(to: location, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    func edit(_ change: (inout FixtureState) -> Void) {
        guard var value = state else { return }; change(&value); state = value
        do { try save() } catch { self.error = "The edit could not be saved: \(error.localizedDescription)" }
    }
    var summary: String {
        guard let state else { return "Fixture state has not been created." }
        let snapshot: [String: String] = ["schemaVersion": "1", "installationMarker": state.installationMarker.uuidString,
            "createdAt": state.createdAt.ISO8601Format(), "recordsDigest": hash(Data(state.records.joined(separator: "\n").utf8)),
            "draftDigest": hash(Data(state.draft.utf8)), "configurationDigest": hash(Data(state.configuration.utf8)),
            "pendingOperationDigest": hash(Data(state.pendingOperation.utf8)), "keychainProof": state.keychainProof, "keychainStatus": keychainStatus,
            "bundleId": Bundle.main.bundleIdentifier ?? "unknown", "version": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown",
            "build": Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "unknown"]
        let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return (try? String(decoding: encoder.encode(snapshot), as: UTF8.self)) ?? "Snapshot unavailable"
    }
}

@main struct QualificationFixtureApp: App {
    @State private var store = FixtureStore()
    var body: some Scene {
        WindowGroup {
            NavigationStack {
                Form {
                    Section("Qualification state") {
                        Text("Use this disposable app to compare state before and after an in-place development update.")
                        Text("Build \(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "unknown")").accessibilityIdentifier("fixture.build")
                        if let state = store.state {
                            LabeledContent("Marker", value: state.installationMarker.uuidString).font(.caption).textSelection(.enabled).accessibilityIdentifier("fixture.marker")
                            LabeledContent("Keychain", value: store.keychainStatus).accessibilityIdentifier("fixture.keychain")
                        } else { Button("Create fixture state") { store.create() }.accessibilityIdentifier("fixture.create") }
                    }
                    if let state = store.state {
                        Section("Retained records") {
                            ForEach(Array(state.records.enumerated()), id: \.offset) { _, record in Text(record) }
                            Button("Add record") { store.edit { $0.records.append("Fixture record \($0.records.count + 1)") } }.accessibilityIdentifier("fixture.addRecord")
                        }
                        Section("Unfinished work") {
                            TextField("Draft", text: Binding(get: { store.state?.draft ?? "" }, set: { text in store.edit { $0.draft = text } }), axis: .vertical).accessibilityIdentifier("fixture.draft")
                            TextField("Configuration", text: Binding(get: { store.state?.configuration ?? "" }, set: { text in store.edit { $0.configuration = text } })).accessibilityIdentifier("fixture.configuration")
                            Text(state.pendingOperation).accessibilityIdentifier("fixture.pending")
                            Text("The pending operation is fixture data. This app has no network or product-control commands.").font(.caption)
                        }
                        Section("Compare updates") {
                            Button("Recheck continuity") { store.load() }.accessibilityIdentifier("fixture.recheck")
                            ShareLink("Export continuity snapshot", item: store.summary)
                            Text("The snapshot includes hashes and fixture identities. It never includes the Keychain value, draft text, or record text.").font(.caption)
                        }
                    }
                    if let error = store.error { Section("Needs attention") { Text(error).foregroundStyle(.red).accessibilityIdentifier("fixture.error") } }
                }.navigationTitle("Contribution Fixture")
            }
        }
    }
}
