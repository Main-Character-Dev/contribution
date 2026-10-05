import AppKit
import CryptoKit
import Foundation
import Observation
import Security
import Sparkle

/// Once extraction can hand an archive to Sparkle's installer, an ordinary
/// cycle-finished callback alone is not proof that installation was cancelled.
public struct UpdateSafetyState: Codable, Equatable, Sendable {
    public var helperStopped = false
    public var installerMayBePending = false
    public var cancellationConfirmed = false
    public init() {}
    public var canReleaseAfterCycle: Bool { !installerMayBePending || cancellationConfirmed }
    public mutating func extracting() { installerMayBePending = true; cancellationConfirmed = false }
    public mutating func choice(skipped: Bool, installing: Bool) {
        if installing { installerMayBePending = true }
        cancellationConfirmed = skipped
    }
}

@MainActor @Observable public final class ReleaseUpdater: NSObject, SPUUpdaterDelegate {
    public private(set) var message = "Signed updates are not configured for this build."
    public private(set) var busy = false
    public private(set) var recoveryRequired = false
    public var configured: Bool { configuration != nil }
    @ObservationIgnored private var controller: SPUStandardUpdaterController?
    @ObservationIgnored private let client = ServiceClient()
    @ObservationIgnored private var receipt: Receipt?
    @ObservationIgnored private var cycleActive = false
    @ObservationIgnored private var started = false
    @ObservationIgnored private var cancelRequested = false
    private struct Receipt: Codable {
        var requestID: String; var windowID: String?; var originalPayload: String?
        var originalManifest: String; var safety = UpdateSafetyState()
    }
    private let receiptKey = "Contribution.updateMaintenance.v1"
    private var manifest: Data? { try? Data(contentsOf: Bundle.main.bundleURL.appendingPathComponent("Contents/Resources/Engine/manifest.json")) }
    private var manifestDigest: String? { manifest.map { SHA256.hash(data: $0).map { String(format: "%02x", $0) }.joined() } }
    private var configuration: URL? {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: "SUFeedURL") as? String,
              let url = URL(string: raw), url.scheme == "https", url.host != nil, url.user == nil, url.password == nil,
              let key = Bundle.main.object(forInfoDictionaryKey: "SUPublicEDKey") as? String, Data(base64Encoded: key)?.count == 32,
              let manifest, let value = try? JSONSerialization.jsonObject(with: manifest) as? [String: Any], value["distribution"] as? String == "signed-release" else { return nil }
        var code: SecStaticCode?
        guard SecStaticCodeCreateWithPath(Bundle.main.bundleURL as CFURL, [], &code) == errSecSuccess, let code,
              SecStaticCodeCheckValidity(code, SecCSFlags(rawValue: kSecCSStrictValidate | kSecCSCheckAllArchitectures | kSecCSCheckNestedCode), nil) == errSecSuccess else { return nil }
        var info: CFDictionary?
        guard SecCodeCopySigningInformation(code, SecCSFlags(rawValue: kSecCSSigningInformation), &info) == errSecSuccess,
              let values = info as? [String: Any], let team = values[kSecCodeInfoTeamIdentifier as String] as? String, !team.isEmpty else { return nil }
        return url
    }
    public override init() {
        super.init()
        if let data = UserDefaults.standard.data(forKey: receiptKey) { receipt = try? JSONDecoder().decode(Receipt.self, from: data) }
        recoveryRequired = receipt != nil
        if receipt != nil { message = "An update maintenance window is retained. Reconcile it before starting jobs." }
        else if configured { message = "Updates run only while the service is stopped. Automatic installation is off." }
    }
    private func fail(_ text: String) -> NSError { NSError(domain: "Contribution.Update", code: 4, userInfo: [NSLocalizedDescriptionKey: text]) }
    private func save() {
        if let receipt, let bytes = try? JSONEncoder().encode(receipt) { UserDefaults.standard.set(bytes, forKey: receiptKey) }
        else { UserDefaults.standard.removeObject(forKey: receiptKey) }
        // The authoritative hold is in the service journal. The app receipt is
        // only a recovery pointer; losing it never clears that hold.
        recoveryRequired = receipt != nil
    }
    private func call(_ command: String, _ args: [String: JSONValue] = [:]) async throws -> [String: JSONValue] {
        let response = try await client.request(command, args: args)
        if case .object(let error) = response.fields["error"] { throw fail(error["message"]?.text ?? "Update maintenance request failed.") }
        return response.fields["result"]?.object ?? [:]
    }
    public func check() async {
        guard !busy, !cycleActive, configured, let manifestDigest else { return }
        busy = true; cancelRequested = false; defer { busy = false }
        do {
            if receipt == nil {
                guard ServiceRegistration.isEnabled else { throw fail("Register and approve the bundled service before using signed updates.") }
                receipt = Receipt(requestID: UUID().uuidString, originalManifest: manifestDigest); save()
            }
            // Re-enter a retained window after an interrupted app invocation.
            if receipt?.safety.helperStopped != true {
                message = "Draining accepted work before checking for an update…"
                let held = try await call("maintenance.begin", ["requestId": .string(receipt!.requestID)])
                receipt?.windowID = held["window"]?.object["id"]?.text
                receipt?.originalPayload = held["window"]?.object["payload"]?.text; save()
                var ready = false
                for _ in 0..<300 {
                    if cancelRequested { try await resume(cancelled: true); return }
                    let status = try await call("maintenance.status")
                    if status["ready"]?.boolean == true { ready = true; break }
                    message = "Waiting for active work or retained effects to settle. Queued jobs stay saved."
                    try await Task.sleep(for: .seconds(1))
                }
                guard ready, let windowID = receipt?.windowID else { throw fail("The service still needs work or device effects reconciled. Maintenance remains held; cancel it to continue normal work.") }
                let before = try await call("service.status")
                guard case .number(let processID) = before["processId"], processID > 1, processID < Decimal(Int32.max), Decimal(NSDecimalNumber(decimal: processID).int32Value) == processID else { throw fail("The helper process identity is unavailable.") }
                _ = try await call("maintenance.stop", ["windowId": .string(windowID)])
                try await ServiceRegistration.unregister()
                var exited = false
                for _ in 0..<100 {
                    if kill(NSDecimalNumber(decimal: processID).int32Value, 0) == -1 && errno == ESRCH { exited = true; break }
                    try await Task.sleep(for: .milliseconds(100))
                }
                guard exited else { throw fail("The helper has not verifiably exited. Bundle replacement remains disabled.") }
                receipt?.safety.helperStopped = true; save()
            }
            guard !ServiceRegistration.isEnabled else { throw fail("The helper was registered again during maintenance. Reconcile the retained window before updating.") }
            if controller == nil { controller = SPUStandardUpdaterController(startingUpdater: false, updaterDelegate: self, userDriverDelegate: nil) }
            guard let controller else { return }
            controller.updater.automaticallyChecksForUpdates = false
            controller.updater.automaticallyDownloadsUpdates = false
            controller.updater.sendsSystemProfile = false
            if !started { try controller.updater.start(); started = true }
            cycleActive = true; message = "Service stopped. Follow the signed update window."
            controller.checkForUpdates(nil)
        } catch { message = error.localizedDescription }
    }
    public func cancelBeforeUpdate() async {
        guard !cycleActive else { message = "Cancel or skip the update in its Sparkle window first."; return }
        if busy { cancelRequested = true; return }
        busy = true; defer { busy = false }
        do {
            guard receipt?.safety.canReleaseAfterCycle != false else { throw fail("An installer may still be pending. Continue the update and use its Skip action before resuming the service.") }
            try await resume(cancelled: true)
        } catch { message = error.localizedDescription }
    }
    public func reconcileInstalledUpdate() async {
        guard !busy, !cycleActive, let receipt, let manifestDigest, receipt.originalManifest != manifestDigest, configured else { return }
        busy = true; defer { busy = false }
        do { try await resume(cancelled: false) } catch { message = error.localizedDescription }
    }
    private func resume(cancelled: Bool) async throws {
        guard let retained = receipt else { return }
        if cancelled && retained.originalManifest != manifestDigest { throw fail("The app payload changed. Reconcile the installed update instead of cancelling.") }
        if !ServiceRegistration.isEnabled { try ServiceRegistration.register() }
        var version: [String: JSONValue]?
        for _ in 0..<40 {
            version = try? await call("version")
            if version != nil { break }; try await Task.sleep(for: .milliseconds(250))
        }
        guard let version, version["manifestDigest"]?.text == manifestDigest else { throw fail("The registered service does not yet match this app's verified payload. Maintenance remains held.") }
        let status = try await call("maintenance.status")
        if let window = status["window"]?.object, !window.isEmpty {
            guard window["requestId"]?.text == retained.requestID, let windowID = window["id"]?.text else { throw fail("A different maintenance window is retained. Inspect the service status before releasing it.") }
            _ = try await call("maintenance.resume", ["windowId": .string(windowID), "observedPayload": version["payload"] ?? .null, "outcome": .string(cancelled ? "cancelled" : "activated")])
        }
        receipt = nil; save(); message = cancelled ? "Update cancelled. Accepted jobs remain unchanged." : "Installed payload verified. Retained jobs can continue."
    }
    public func updater(_ updater: SPUUpdater, mayPerform updateCheck: SPUUpdateCheck) throws {
        guard configured, receipt?.safety.helperStopped == true, !ServiceRegistration.isEnabled else { throw fail("A held maintenance window and stopped helper are required for every update cycle.") }
    }
    public func updater(_ updater: SPUUpdater, shouldProceedWithUpdate item: SUAppcastItem, updateCheck: SPUUpdateCheck) throws {
        try self.updater(updater, mayPerform: updateCheck)
    }
    public func updater(_ updater: SPUUpdater, willExtractUpdate item: SUAppcastItem) { receipt?.safety.extracting(); save() }
    public func updater(_ updater: SPUUpdater, userDidMake choice: SPUUserUpdateChoice, forUpdate item: SUAppcastItem, state: SPUUserUpdateState) {
        receipt?.safety.choice(skipped: choice == .skip, installing: state.stage == .installing); save()
    }
    public func updater(_ updater: SPUUpdater, willInstallUpdateOnQuit item: SUAppcastItem, immediateInstallationBlock immediateInstallHandler: @escaping () -> Void) -> Bool {
        receipt?.safety.extracting(); save(); message = "An update is pending on quit. The service remains stopped."; return true
    }
    public func updater(_ updater: SPUUpdater, willInstallUpdate item: SUAppcastItem) { receipt?.safety.extracting(); save() }
    public func updater(_ updater: SPUUpdater, didFinishUpdateCycleFor updateCheck: SPUUpdateCheck, error: (any Error)?) {
        cycleActive = false
        guard receipt?.safety.canReleaseAfterCycle == true, !(receipt?.safety.installerMayBePending == true && error != nil) else { message = "The updater may still own an installation. Continue the update; the service remains stopped."; return }
        Task { [weak self] in await self?.cancelBeforeUpdate() }
    }
    public func updaterShouldPromptForPermissionToCheck(forUpdates updater: SPUUpdater) -> Bool { false }
    public func allowedSystemProfileKeys(for updater: SPUUpdater) -> [String]? { [] }
}
