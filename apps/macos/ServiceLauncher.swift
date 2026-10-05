import Foundation
import Darwin

@main
enum ContributionLauncher {
    static func main() {
        do {
            let executable = URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath()
            let contents = executable.deletingLastPathComponent().deletingLastPathComponent()
            var support = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Contribution")
            #if CONTRIBUTION_TEST_SUPPORT_ROOT
            guard let testRoot = ProcessInfo.processInfo.environment["CONTRIBUTION_TEST_SUPPORT_ROOT"], testRoot.hasPrefix("/") else { throw CocoaError(.fileReadCorruptFile) }
            support = URL(fileURLWithPath: testRoot)
            #endif
            let payload = try VerifiedPayload.verify(contents.appendingPathComponent("Resources/Engine")).materialize(in: support)
            #if CONTRIBUTION_CLI
            let cli = true
            let forwarded = Array(CommandLine.arguments.dropFirst())
            #else
            let cli = CommandLine.arguments.dropFirst().first == "--cli"
            let forwarded = Array(CommandLine.arguments.dropFirst(2))
            #endif
            let node = payload.root.appendingPathComponent("runtime/node").path
            let entry = payload.manifest.entrypoints[cli ? "cli" : "service"]!
            let arguments = [node, payload.root.appendingPathComponent(entry).path] + (cli ? forwarded : ["--payload", payload.root.path])
            var pointers = arguments.map { strdup($0) }; pointers.append(nil)
            defer { for pointer in pointers { free(pointer) } }
            execv(node, &pointers)
            throw POSIXError(.init(rawValue: errno) ?? .EIO)
        } catch {
            #if CONTRIBUTION_TEST_SUPPORT_ROOT
            FileHandle.standardError.write(Data("Test launcher: \(error)\n".utf8))
            #endif
            FileHandle.standardError.write(Data("Contribution payload could not be verified or started. Open the app to repair its installation.\n".utf8))
            exit(3)
        }
    }
}
