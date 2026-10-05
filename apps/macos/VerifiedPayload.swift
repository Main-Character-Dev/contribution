import Foundation
import CryptoKit
import Darwin

struct PayloadFailure: Error { let line: Int }

struct PayloadManifest: Decodable {
    let schemaVersion: Int
    let distribution: String
    let files: [String: String]
    let entrypoints: [String: String]
}

struct VerifiedPayload {
    let root: URL
    let manifest: PayloadManifest
    let manifestBytes: Data
    var identity: String { Self.hash(manifestBytes) }
    static func hash(_ bytes: Data) -> String { SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined() }
    static func info(_ path: URL) throws -> stat {
        var value = stat()
        guard lstat(path.path, &value) == 0 else { throw POSIXError(.init(rawValue: errno) ?? .EIO) }
        return value
    }
    static func canonicalPath(_ path: URL) throws -> String {
        guard let resolved = realpath(path.path, nil) else { throw POSIXError(.init(rawValue: errno) ?? .EIO) }
        defer { free(resolved) }; return String(cString: resolved)
    }
    static func verify(_ input: URL) throws -> VerifiedPayload {
        guard try info(input).st_mode & S_IFMT == S_IFDIR else { throw PayloadFailure(line: #line) }
        let root = input.resolvingSymlinksInPath()
        let prefix = try canonicalPath(root) + "/"
        let manifestURL = root.appendingPathComponent("manifest.json")
        guard try info(manifestURL).st_mode & S_IFMT == S_IFREG else { throw PayloadFailure(line: #line) }
        let bytes = try Data(contentsOf: manifestURL)
        guard bytes.count <= 4_194_304 else { throw PayloadFailure(line: #line) }
        let manifest = try JSONDecoder().decode(PayloadManifest.self, from: bytes)
        guard manifest.schemaVersion == 1, ["unsigned-development", "signed-release"].contains(manifest.distribution),
              !manifest.files.isEmpty, manifest.files.count <= 100_000 else { throw PayloadFailure(line: #line) }
        guard let enumerator = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil) else { throw PayloadFailure(line: #line) }
        var found = Set<String>()
        for case let file as URL in enumerator {
            let mode = try info(file).st_mode & S_IFMT
            guard mode == S_IFREG || mode == S_IFDIR else { throw PayloadFailure(line: #line) }
            if mode == S_IFDIR { continue }
            let path = try canonicalPath(file)
            guard path.hasPrefix(prefix) else { throw PayloadFailure(line: #line) }
            let relative = String(path.dropFirst(prefix.count))
            if relative == "manifest.json" { continue }
            guard manifest.files[relative] == hash(try Data(contentsOf: file)) else {
                #if CONTRIBUTION_TEST_SUPPORT_ROOT
                FileHandle.standardError.write(Data("Mismatch: root=\(root.path) file=\(file.path) key=\(relative)\n".utf8))
                #endif
                throw PayloadFailure(line: #line)
            }
            found.insert(relative)
        }
        guard found == Set(manifest.files.keys), found.contains("runtime/node"),
              let cli = manifest.entrypoints["cli"], let service = manifest.entrypoints["service"],
              found.contains(cli), found.contains(service) else { throw PayloadFailure(line: #line) }
        return VerifiedPayload(root: root, manifest: manifest, manifestBytes: bytes)
    }
    static func privateDirectory(_ url: URL) throws {
        if !FileManager.default.fileExists(atPath: url.path) {
            try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        }
        let value = try info(url)
        guard value.st_mode & S_IFMT == S_IFDIR, value.st_uid == getuid(), value.st_mode & 0o077 == 0 else { throw CocoaError(.fileWriteNoPermission) }
    }
    static func sync(_ url: URL) throws {
        let fd = open(url.path, O_RDONLY | O_NOFOLLOW)
        guard fd >= 0 else { throw POSIXError(.init(rawValue: errno) ?? .EIO) }
        defer { close(fd) }
        guard fsync(fd) == 0 else { throw POSIXError(.init(rawValue: errno) ?? .EIO) }
    }
    func materialize(in input: URL) throws -> VerifiedPayload {
        try Self.privateDirectory(input)
        let support = input.resolvingSymlinksInPath()
        let payloads = support.appendingPathComponent("Payloads", isDirectory: true)
        try Self.privateDirectory(payloads)
        let target = payloads.appendingPathComponent(identity, isDirectory: true)
        func retained() throws -> VerifiedPayload {
            let value = try Self.info(target)
            guard value.st_uid == getuid(), value.st_mode & 0o077 == 0 else { throw CocoaError(.fileReadNoPermission) }
            let existing = try Self.verify(target)
            guard existing.manifestBytes == manifestBytes else { throw PayloadFailure(line: #line) }
            return existing
        }
        if FileManager.default.fileExists(atPath: target.path) { return try retained() }
        // Staging is never executed. Publish a complete fsynced copy with one rename.
        let temporary = payloads.appendingPathComponent(".staging-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.copyItem(at: root, to: temporary)
        let copied = try Self.verify(temporary)
        guard copied.manifestBytes == manifestBytes else { throw PayloadFailure(line: #line) }
        let enumerator = FileManager.default.enumerator(at: temporary, includingPropertiesForKeys: nil)!
        var directories = [temporary]
        for case let file as URL in enumerator {
            if try Self.info(file).st_mode & S_IFMT == S_IFDIR { directories.append(file); continue }
            let executable = try Self.canonicalPath(file) == Self.canonicalPath(temporary.appendingPathComponent("runtime/node"))
            guard chmod(file.path, executable ? 0o500 : 0o400) == 0 else { throw CocoaError(.fileWriteNoPermission) }
            try Self.sync(file)
        }
        for directory in directories.reversed() {
            guard chmod(directory.path, 0o500) == 0 else { throw CocoaError(.fileWriteNoPermission) }
            try Self.sync(directory)
        }
        if rename(temporary.path, target.path) != 0 {
            // A concurrent launcher may win. Preserve our staging copy for cleanup.
            guard FileManager.default.fileExists(atPath: target.path) else { throw POSIXError(.init(rawValue: errno) ?? .EIO) }
        }
        try Self.sync(payloads)
        return try retained()
    }
}
