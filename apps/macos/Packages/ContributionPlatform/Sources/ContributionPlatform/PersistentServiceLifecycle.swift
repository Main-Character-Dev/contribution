import Foundation
import CryptoKit
import Darwin
import IOKit

/// This is the existing native installer owner's private receipt, independent
/// of editable checkouts and available before the service journal can open.
@MainActor public final class PersistentServiceLifecycle {
    public struct Receipt: Codable, Equatable, Sendable {
        public let schemaVersion: Int
        public let hostIdentity: String
        public let requestID: UUID
        public let domain: String
        public let label: String
        public let bundle: String
        public let executableDigest: String
        public let plistDigest: String
        public var phase: String
        public var retries: Int
        public var reason: String? = nil
    }
    private let home: URL, bundle: URL
    private let hostIdentity: @MainActor () throws -> String
    private var busy = false
    private var directory: URL { home.appendingPathComponent("Library/Application Support/Contribution") }
    private var url: URL { directory.appendingPathComponent("service-installation.json") }
    private var executable: URL { bundle.appendingPathComponent("Contents/Library/ContributionService") }
    private var plist: URL { bundle.appendingPathComponent("Contents/Library/LaunchAgents/dev.contribution.service.plist") }
    public init(home: URL = FileManager.default.homeDirectoryForCurrentUser, bundle: URL = Bundle.main.bundleURL, hostIdentity: (@MainActor () throws -> String)? = nil) {
        self.home = home; self.bundle = bundle; self.hostIdentity = hostIdentity ?? { try Self.platformHostIdentity() }
    }
    private static func platformHostIdentity() throws -> String {
        let service = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("IOPlatformExpertDevice"))
        guard service != 0 else { throw NSError(domain: "Contribution.ServiceLifecycle", code: 3, userInfo: [NSLocalizedDescriptionKey: "This host cannot establish an exact persistent service identity."]) }
        defer { IOObjectRelease(service) }
        guard let raw = IORegistryEntryCreateCFProperty(service, kIOPlatformUUIDKey as CFString, kCFAllocatorDefault, 0)?.takeRetainedValue() as? String, UUID(uuidString: raw) != nil else {
            throw NSError(domain: "Contribution.ServiceLifecycle", code: 3, userInfo: [NSLocalizedDescriptionKey: "Persistent host identity is unavailable; preserve the registration."])
        }
        // The hardware value never leaves this local owner or appears in logs.
        return SHA256.hash(data: Data((raw + ":" + String(getuid())).utf8)).map { String(format: "%02x", $0) }.joined()
    }
    private func failure(_ message: String) -> NSError { NSError(domain: "Contribution.ServiceLifecycle", code: 3, userInfo: [NSLocalizedDescriptionKey: message]) }
    private func privateDirectory() throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        var value = stat()
        guard lstat(directory.path, &value) == 0, value.st_mode & S_IFMT == S_IFDIR, value.st_uid == getuid(), value.st_mode & 0o077 == 0,
              directory.resolvingSymlinksInPath().path == directory.path else { throw failure("Preserve the changed service receipt directory for inspection.") }
    }
    private func bytes(_ path: URL, max: Int) throws -> Data {
        let fd = open(path.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC); guard fd >= 0 else { throw failure("The exact service payload or receipt is missing. No registration was attempted.") }; defer { close(fd) }
        var before = stat(), named = stat()
        guard fstat(fd, &before) == 0, lstat(path.path, &named) == 0, before.st_mode & S_IFMT == S_IFREG, before.st_uid == getuid(), before.st_nlink == 1,
              before.st_size > 0, before.st_size <= max, before.st_ino == named.st_ino, before.st_dev == named.st_dev,
              path.deletingLastPathComponent().resolvingSymlinksInPath().path == path.deletingLastPathComponent().path else { throw failure("Preserve the linked, replaced or uninspectable service file.") }
        var result = Data(count: Int(before.st_size)), offset = 0
        while offset < result.count {
            let count = result.withUnsafeMutableBytes { read(fd, $0.baseAddress!.advanced(by: offset), $0.count - offset) }
            guard count > 0 else { throw failure("Service file inspection was incomplete.") }; offset += count
        }
        var after = stat()
        guard fstat(fd, &after) == 0, lstat(path.path, &named) == 0, after.st_size == before.st_size, after.st_ino == before.st_ino, after.st_dev == before.st_dev,
              after.st_mtimespec.tv_sec == before.st_mtimespec.tv_sec, after.st_mtimespec.tv_nsec == before.st_mtimespec.tv_nsec, after.st_ctimespec.tv_sec == before.st_ctimespec.tv_sec, after.st_ctimespec.tv_nsec == before.st_ctimespec.tv_nsec, named.st_ino == before.st_ino, named.st_dev == before.st_dev else { throw failure("The service file changed during inspection.") }
        return result
    }
    public func receipt() throws -> Receipt? {
        try privateDirectory()
        var value = stat(); if lstat(url.path, &value) != 0 && errno == ENOENT { return nil }
        guard value.st_mode & 0o077 == 0 else { throw failure("Service ownership receipt permissions changed.") }
        let record = try JSONDecoder().decode(Receipt.self, from: bytes(url, max: 16_384))
        guard record.schemaVersion == 1, ["registrationIntent", "registered", "retirementIntent", "retirementUnconfirmed", "retired", "unresolved"].contains(record.phase), record.retries >= 0, record.retries <= 3 else { throw failure("The service receipt version/state is unsupported. Preserve it and use its compatible owning app.") }
        return record
    }
    private func save(_ value: Receipt) throws {
        try privateDirectory(); let data = try JSONEncoder().encode(value)
        try data.write(to: url, options: [.atomic]); try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
        for path in [url, directory] {
            let fd = open(path.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC); guard fd >= 0 else { throw failure("Could not open the service ownership receipt for synchronization.") }; defer { close(fd) }
            guard fsync(fd) == 0 else { throw failure("Could not retain service ownership before an external effect.") }
        }
    }
    private func selected() throws -> Receipt {
        guard bundle.resolvingSymlinksInPath().path == bundle.path, FileManager.default.isExecutableFile(atPath: executable.path) else { throw failure("The selected bundled service executable is missing or linked. No service was started.") }
        let executableData = try bytes(executable, max: 256 * 1_048_576), plistData = try bytes(plist, max: 65_536)
        let config = try PropertyListSerialization.propertyList(from: plistData, format: nil) as? [String: Any]
        guard config?["Label"] as? String == "dev.contribution.service", config?["BundleProgram"] as? String == "Contents/Library/ContributionService", config?["KeepAlive"] as? Bool == false else { throw failure("The bundled service label, executable or restart policy is unsupported.") }
        let hash: (Data) -> String = { SHA256.hash(data: $0).map { String(format: "%02x", $0) }.joined() }
        return Receipt(schemaVersion: 1, hostIdentity: try hostIdentity(), requestID: UUID(), domain: "gui/\(getuid())", label: "dev.contribution.service", bundle: bundle.path, executableDigest: hash(executableData), plistDigest: hash(plistData), phase: "registrationIntent", retries: 0)
    }
    private func exact(_ record: Receipt) throws {
        let selected = try selected()
        guard record.hostIdentity == selected.hostIdentity, record.domain == selected.domain, record.label == selected.label, record.bundle == selected.bundle, record.executableDigest == selected.executableDigest, record.plistDigest == selected.plistDigest,
              try receipt() == record else { throw failure("Service ownership or payload changed. Preserve it and reconcile the exact registered app.") }
    }
    public func register(isRegistered: () -> Bool, effect: () throws -> Void) throws {
        guard !busy else { throw failure("Service registration is already being reconciled.") }; busy = true; defer { busy = false }
        if let previous = try receipt(), previous.phase != "retired" {
            try exact(previous)
            guard previous.phase == "registered", isRegistered() else { throw failure("The retained registration has an uncertain result. Inspect Login Items for this exact app; startup will not be repeated.") }; return
        }
        guard !isRegistered() else { throw failure("This existing registration has no owned receipt. Preserve it and reconcile its owning installation before adopting it.") }
        var record = try selected(); try save(record); try exact(record)
        do { try effect(); guard isRegistered() else { throw failure("Registration needs approval or has an uncertain result. Open Login Items for this app.") }; record.phase = "registered"; try save(record) }
        catch { record.phase = "unresolved"; record.reason = String(error.localizedDescription.prefix(1024)); try save(record); throw error }
    }
    public func unregister(isUnloaded: () -> Bool, effect: @escaping @MainActor () async throws -> Void) async throws {
        guard !busy else { throw failure("Service retirement is already being reconciled.") }; busy = true; defer { busy = false }
        guard var record = try receipt() else { throw failure("No owned service registration receipt exists. Preserve the current registration.") }
        try exact(record); if record.phase == "retired" { guard isUnloaded() else { throw failure("A retired service was registered by another owner. Preserve it.") }; return }
        if record.phase == "retirementUnconfirmed" {
            guard isUnloaded() else { throw failure("The earlier unload reply is still uncertain. Inspect Login Items; do not repeat unload while it may still be running.") }
            record.phase = "retired"; record.reason = nil; try save(record); return
        }
        guard record.retries < 3 else { throw failure("Service retirement exhausted its bounded retries. Inspect the exact app in Login Items.") }
        record.phase = "retirementIntent"; record.retries += 1; try save(record); try exact(record)
        do {
            // SMAppService is the owning API. Retain its intent across a lost
            // reply; no launchctl fallback, log deletion or raw plist removal.
            if !isUnloaded() {
                try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                    let reply = ServiceRetirementReply(continuation)
                    Task { @MainActor in do { try await effect(); reply.finish(nil) } catch { reply.finish(error) } }
                    Task { @MainActor in try? await Task.sleep(for: .seconds(5)); reply.finish(self.failure("Service unload reached its finite reply deadline. Observe the exact registration before retrying.")) }
                }
            }
            try exact(record); guard isUnloaded() else { throw failure("The owning API has not confirmed unload. Service data remains retained.") }
            record.phase = "retired"; record.reason = nil; try save(record)
        } catch { record.phase = "retirementUnconfirmed"; record.reason = String(error.localizedDescription.prefix(1024)); try save(record); throw error }
    }
    public func reconcile(isRegistered: () -> Bool, isUnloaded: () -> Bool) throws {
        guard var record = try receipt() else { return }; try exact(record)
        if ["registrationIntent", "unresolved"].contains(record.phase) && isRegistered() { record.phase = "registered"; record.reason = nil; try save(record) }
        else if ["retirementIntent", "retirementUnconfirmed"].contains(record.phase) && isUnloaded() { record.phase = "retired"; record.reason = nil; try save(record) }
    }
}

@MainActor private final class ServiceRetirementReply {
    private var continuation: CheckedContinuation<Void, Error>?
    init(_ continuation: CheckedContinuation<Void, Error>) { self.continuation = continuation }
    func finish(_ error: Error?) {
        guard let retained = continuation else { return }; continuation = nil
        if let error { retained.resume(throwing: error) } else { retained.resume() }
    }
}
