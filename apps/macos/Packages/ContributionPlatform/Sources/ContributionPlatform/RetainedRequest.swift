import Foundation
import Darwin

/// A lost admission reply must be retried with the original immutable identity.
/// The native client retains an unresolved request before any service effect.
public struct RetainedRequest: Codable, Equatable, Sendable {
    public let command: String
    public let args: [String: JSONValue]
    public var requestID: String { args["requestId"]?.text ?? "" }
    public init(command: String, args: [String: JSONValue]) {
        self.command = command
        var values = args; values["requestId"] = .string(UUID().uuidString)
        self.args = values
    }
}

public enum NativeRequestSlot: Equatable, Sendable {
    case operation, storageSettings, powerSettings
    fileprivate var fileName: String {
        switch self { case .operation: "native-pending-request.json"; case .storageSettings: "native-storage-settings-request.json"; case .powerSettings: "native-power-settings-request.json" }
    }
    fileprivate func accepts(_ command: String) -> Bool {
        switch self { case .operation: true; case .storageSettings: ["settings.apply", "service.storage-policy"].contains(command); case .powerSettings: command == "service.power-policy" }
    }
}

@MainActor public final class NativeRequestJournal {
    private let directory: URL
    private let slot: NativeRequestSlot
    private var url: URL { directory.appendingPathComponent(slot.fileName) }
    public init(directory: URL, slot: NativeRequestSlot = .operation) { self.directory = directory; self.slot = slot }
    private func failure(_ message: String) -> NSError { NSError(domain: "Contribution.NativeRequest", code: 3, userInfo: [NSLocalizedDescriptionKey: message]) }
    private func verifyDirectory() throws {
        var value = stat()
        guard lstat(directory.path, &value) == 0, value.st_mode & S_IFMT == S_IFDIR, value.st_uid == getuid(), value.st_mode & 0o077 == 0 else {
            throw failure("The private service directory must be available before submitting work.")
        }
    }
    public func pending() throws -> RetainedRequest? {
        try verifyDirectory()
        let fd = open(url.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { if errno == ENOENT { return nil }; throw failure("The retained request could not be read.") }
        defer { close(fd) }
        var value = stat()
        guard fstat(fd, &value) == 0, value.st_mode & S_IFMT == S_IFREG, value.st_uid == getuid(), value.st_mode & 0o077 == 0, value.st_size > 0, value.st_size <= 1_048_576 else {
            throw failure("The retained request has invalid ownership, permissions or size. Preserve it for reconciliation.")
        }
        var bytes = [UInt8](repeating: 0, count: Int(value.st_size)), offset = 0
        while offset < bytes.count {
            let count = bytes.withUnsafeMutableBytes { read(fd, $0.baseAddress!.advanced(by: offset), $0.count - offset) }
            guard count > 0 else { throw failure("The retained request is incomplete. Preserve it for reconciliation.") }; offset += count
        }
        let result = try JSONDecoder().decode(RetainedRequest.self, from: Data(bytes))
        guard UUID(uuidString: result.requestID) != nil, !result.command.isEmpty, slot.accepts(result.command) else { throw failure("The retained request identity or control scope is invalid.") }
        return result
    }
    public func retain(_ request: RetainedRequest) throws {
        try verifyDirectory()
        guard slot.accepts(request.command) else { throw failure("This recovery slot only accepts its designated setting changes.") }
        if let prior = try pending() {
            guard prior == request else { throw failure("An earlier request has an uncertain reply. Reconcile it before submitting another action.") }; return
        }
        let data = try JSONEncoder().encode(request)
        guard data.count <= 1_048_576 else { throw failure("The request exceeds the private journal limit.") }
        let fd = open(url.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard fd >= 0 else { throw failure("Another native request needs reconciliation before this action can start.") }
        defer { close(fd) }
        try data.withUnsafeBytes { bytes in
            var offset = 0
            while offset < bytes.count {
                let count = write(fd, bytes.baseAddress!.advanced(by: offset), bytes.count - offset)
                guard count > 0 else { throw failure("Could not retain the complete request. Nothing has been submitted.") }; offset += count
            }
        }
        guard fsync(fd) == 0 else { throw failure("Could not synchronize the request. Nothing has been submitted.") }
        try synchronizeDirectory()
    }
    public func resolve(_ request: RetainedRequest) throws {
        guard try pending() == request else { throw failure("The native request changed while awaiting its reply.") }
        guard unlink(url.path) == 0 else { throw failure("The service replied, but its retained request still needs reconciliation.") }
        try synchronizeDirectory()
    }
    /// Some synchronous operations can return an actionable error after
    /// partial effects. Their durable continuation still owns this identity.
    @discardableResult public func resolveIfComplete(_ request: RetainedRequest, response: ResponseEnvelope) throws -> Bool {
        if response.fields["result"]?.object["requestRetained"] == .bool(true) {
            guard try pending() == request, response.fields["result"]?.object["requestId"]?.text == request.requestID else {
                throw failure("The service's retained continuation does not match this request. Preserve it for reconciliation.")
            }
            return false
        }
        try resolve(request); return true
    }
    private func synchronizeDirectory() throws {
        let fd = open(directory.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { throw failure("The private request directory is unavailable.") }; defer { close(fd) }
        guard fsync(fd) == 0 else { throw failure("The private request directory could not be synchronized.") }
    }
}
