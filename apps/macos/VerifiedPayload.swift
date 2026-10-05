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
    static func readBounded(_ path: URL, limit: Int64, consume: (Data) -> Void) throws -> Int64 {
        let before = try info(path)
        func same(_ value: stat) -> Bool {
            before.st_dev == value.st_dev && before.st_ino == value.st_ino && before.st_mode == value.st_mode &&
            before.st_uid == value.st_uid && before.st_nlink == value.st_nlink && before.st_size == value.st_size &&
            before.st_mtimespec.tv_sec == value.st_mtimespec.tv_sec && before.st_mtimespec.tv_nsec == value.st_mtimespec.tv_nsec &&
            before.st_ctimespec.tv_sec == value.st_ctimespec.tv_sec && before.st_ctimespec.tv_nsec == value.st_ctimespec.tv_nsec
        }
        guard before.st_mode & S_IFMT == S_IFREG, before.st_nlink == 1, before.st_size >= 0, before.st_size <= limit else { throw PayloadFailure(line: #line) }
        let fd = open(path.path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
        guard fd >= 0 else { throw PayloadFailure(line: #line) }
        defer { close(fd) }
        var opened = stat()
        guard fstat(fd, &opened) == 0, same(opened) else { throw PayloadFailure(line: #line) }
        var buffer = [UInt8](repeating: 0, count: 1_048_576), offset: Int64 = 0
        while offset < before.st_size {
            let count = read(fd, &buffer, min(buffer.count, Int(before.st_size - offset)))
            guard count > 0 else { throw PayloadFailure(line: #line) }
            consume(Data(buffer.prefix(count))); offset += Int64(count)
        }
        guard fstat(fd, &opened) == 0, same(opened), same(try info(path)) else { throw PayloadFailure(line: #line) }
        return offset
    }
    static func verify(_ input: URL) throws -> VerifiedPayload {
        guard try info(input).st_mode & S_IFMT == S_IFDIR else { throw PayloadFailure(line: #line) }
        let root = input.resolvingSymlinksInPath()
        let prefix = try canonicalPath(root) + "/"
        let manifestURL = root.appendingPathComponent("manifest.json")
        guard try info(manifestURL).st_mode & S_IFMT == S_IFREG else { throw PayloadFailure(line: #line) }
        var bytes = Data()
        _ = try readBounded(manifestURL, limit: 4_194_304) { bytes.append($0) }
        guard bytes.count <= 4_194_304 else { throw PayloadFailure(line: #line) }
        let manifest = try JSONDecoder().decode(PayloadManifest.self, from: bytes)
        guard manifest.schemaVersion == 1, ["unsigned-development", "signed-release"].contains(manifest.distribution),
              !manifest.files.isEmpty, manifest.files.count <= 100_000 else { throw PayloadFailure(line: #line) }
        guard let enumerator = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil) else { throw PayloadFailure(line: #line) }
        var found = Set<String>()
        var total: Int64 = 0, entries = 0
        for case let file as URL in enumerator {
            entries += 1
            guard entries <= 100_000, file.pathComponents.count - root.pathComponents.count <= 33 else { throw PayloadFailure(line: #line) }
            let mode = try info(file).st_mode & S_IFMT
            guard mode == S_IFREG || mode == S_IFDIR else { throw PayloadFailure(line: #line) }
            if mode == S_IFDIR { continue }
            let path = try canonicalPath(file)
            guard path.hasPrefix(prefix) else { throw PayloadFailure(line: #line) }
            let relative = String(path.dropFirst(prefix.count))
            if relative == "manifest.json" { continue }
            var hasher = SHA256()
            total += try readBounded(file, limit: min(536_870_912, 4_294_967_296 - total)) { hasher.update(data: $0) }
            let fileHash = hasher.finalize().map { String(format: "%02x", $0) }.joined()
            guard manifest.files[relative] == fileHash else {
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
