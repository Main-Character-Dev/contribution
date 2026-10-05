import Foundation
import CryptoKit
import Darwin

struct Manifest: Decodable { let schemaVersion: Int; let distribution: String; let files: [String: String]; let entrypoints: [String: String] }
do {
    let executable = URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath()
    let contents = executable.deletingLastPathComponent().deletingLastPathComponent()
    let payload = contents.appendingPathComponent("Resources/Engine")
    let manifest = try JSONDecoder().decode(Manifest.self, from: Data(contentsOf: payload.appendingPathComponent("manifest.json")))
    guard manifest.schemaVersion == 1, ["unsigned-development", "signed-release"].contains(manifest.distribution) else { throw CocoaError(.fileReadCorruptFile) }
    let enumerator = FileManager.default.enumerator(at: payload, includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey])!
    var found = Set<String>()
    for case let file as URL in enumerator {
        let values = try file.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
        guard values.isSymbolicLink != true else { throw CocoaError(.fileReadCorruptFile) }
        guard values.isRegularFile == true else { continue }
        let relative = String(file.path.dropFirst(payload.path.count + 1))
        if relative == "manifest.json" { continue }
        let digest = SHA256.hash(data: try Data(contentsOf: file)).map { String(format: "%02x", $0) }.joined()
        guard manifest.files[relative] == digest else { throw CocoaError(.fileReadCorruptFile) }; found.insert(relative)
    }
    guard found.count == manifest.files.count else { throw CocoaError(.fileReadCorruptFile) }
    let cli = CommandLine.arguments.dropFirst().first == "--cli"
    guard let entry = manifest.entrypoints[cli ? "cli" : "service"], found.contains(entry), found.contains("runtime/node") else { throw CocoaError(.fileReadCorruptFile) }
    let node = payload.appendingPathComponent("runtime/node").path
    let arguments = [node, payload.appendingPathComponent(entry).path] + (cli ? Array(CommandLine.arguments.dropFirst(2)) : ["--payload", payload.path])
    var pointers = arguments.map { strdup($0) }; pointers.append(nil)
    defer { for pointer in pointers { free(pointer) } }
    execv(node, &pointers)
    throw POSIXError(.init(rawValue: errno) ?? .EIO)
} catch {
    FileHandle.standardError.write(Data("Contribution payload could not be verified or started. Open the app to repair its installation.\n".utf8))
    exit(3)
}
