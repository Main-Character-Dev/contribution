import Foundation
import Darwin

public extension JSONValue {
    var object: [String: JSONValue] { if case .object(let value) = self { value } else { [:] } }
    var array: [JSONValue] { if case .array(let value) = self { value } else { [] } }
    var text: String { if case .string(let value) = self { value } else { "" } }
    var boolean: Bool { if case .bool(let value) = self { value } else { false } }
    var identity: String { object["id"]?.text ?? object["operationId"]?.text ?? "" }
    var formatted: String {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return (try? String(data: encoder.encode(self), encoding: .utf8)) ?? ""
    }
}
public struct ServiceClient: Sendable {
    public let directory: URL
    public init(directory: URL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Contribution")) { self.directory = directory }
    public func request(_ command: String, args: [String: JSONValue] = [:], cwd: String = NSHomeDirectory()) async throws -> ResponseEnvelope {
        let directory = directory
        return try await Task.detached(priority: .userInitiated) { try Self.exchange(directory, command: command, args: args, cwd: cwd) }.value
    }
    private static func exchange(_ directory: URL, command: String, args: [String: JSONValue], cwd: String) throws -> ResponseEnvelope {
        func failure(_ message: String) -> NSError { NSError(domain: "Contribution.Service", code: 3, userInfo: [NSLocalizedDescriptionKey: message]) }
        func readPrivate(_ name: String) throws -> Data {
            let url = directory.appendingPathComponent(name), attributes = try FileManager.default.attributesOfItem(atPath: url.path)
            guard attributes[.type] as? FileAttributeType == .typeRegular,
                  (attributes[.ownerAccountID] as? NSNumber)?.uint32Value == getuid(),
                  ((attributes[.posixPermissions] as? NSNumber)?.intValue ?? 0o777) & 0o077 == 0 else { throw failure("The service endpoint permissions need repair.") }
            return try Data(contentsOf: url)
        }
        let endpoint: [String: JSONValue], token: String
        do {
            endpoint = try JSONDecoder().decode([String: JSONValue].self, from: readPrivate("endpoint.json"))
            token = String(decoding: try readPrivate("client.token"), as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        } catch { throw failure("The Contribution service is unavailable. Open Settings to inspect background-service registration.") }
        guard endpoint["schemaVersion"] == .number(1), let path = endpoint["socket"]?.text, !path.isEmpty, !token.isEmpty else { throw failure("Incompatible service discovery record.") }
        var address = sockaddr_un(); address.sun_family = sa_family_t(AF_UNIX)
        let bytes = Array(path.utf8) + [0]
        guard bytes.count <= MemoryLayout.size(ofValue: address.sun_path) else { throw failure("Service socket path exceeds the platform limit.") }
        withUnsafeMutableBytes(of: &address.sun_path) { target in target.copyBytes(from: bytes) }
        let fd = socket(AF_UNIX, SOCK_STREAM, 0); guard fd >= 0 else { throw failure("Could not open the private service connection.") }
        defer { close(fd) }
        var timeout = timeval(tv_sec: 15, tv_usec: 0), noSignal: Int32 = 1
        _ = setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
        _ = setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
        _ = setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &noSignal, socklen_t(MemoryLayout<Int32>.size))
        let connected = withUnsafePointer(to: &address) { pointer in pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) } }
        guard connected == 0 else { throw failure("The user service is not reachable. Accepted work remains in its journal.") }
        let frame: JSONValue = .object(["token": .string(token), "request": .object(["schemaVersion": .number(1), "command": .string(command), "args": .object(args), "cwd": .string(cwd)])])
        var outbound = try JSONEncoder().encode(frame); outbound.append(10)
        guard outbound.count <= 1_048_576 else { throw failure("The request exceeds the service limit.") }
        try outbound.withUnsafeBytes { buffer in
            var offset = 0
            while offset < buffer.count {
                let written = send(fd, buffer.baseAddress!.advanced(by: offset), buffer.count - offset, 0)
                guard written > 0 else { throw failure("The request connection closed. Reuse the same request identity to reconcile acceptance.") }; offset += written
            }
        }
        var data = Data(), buffer = [UInt8](repeating: 0, count: 16384)
        while data.count <= 8_388_608 {
            let count = recv(fd, &buffer, buffer.count, 0)
            guard count > 0 else { throw failure("The bounded reply wait ended. The operation may continue; refresh its retained status.") }
            data.append(contentsOf: buffer.prefix(count))
            if let end = data.firstIndex(of: 10) { return try JSONDecoder().decode(ResponseEnvelope.self, from: data.prefix(upTo: end)) }
        }
        throw failure("The response exceeds the client limit. Request a smaller log range.")
    }
}
