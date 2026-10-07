import Foundation
import Darwin
import AppKit
import SystemConfiguration

// Mutable debounce state is confined to the main dispatch queue. Notification
// callbacks only enqueue categories; the pipe is inherited by this one child.
private final class ConnectivityHints: @unchecked Sendable {
    private let output: FileHandle
    private var pending: DispatchWorkItem?
    init(_ output: FileHandle) { self.output = output }
    func fact(_ status: String) {
        DispatchQueue.main.async { [self] in
            try? output.write(contentsOf: Data(("{\"event\":\"bridge\",\"status\":\"" + status + "\"}\n").utf8))
        }
    }
    #if CONTRIBUTION_TEST_SUPPORT_ROOT
    func forward(_ data: Data) { DispatchQueue.main.async { [self] in try? output.write(contentsOf: data) } }
    #endif
    func stop() { pending?.cancel(); pending = nil }
    func send(_ category: String) {
        DispatchQueue.main.async { [self] in
            pending?.cancel()
            let item = DispatchWorkItem { [self] in
                try? output.write(contentsOf: Data(("{\"event\":\"" + category + "\"}\n").utf8))
            }
            pending = item
            DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(500), execute: item)
        }
    }
}

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
            var arguments = [node, payload.root.appendingPathComponent(entry).path] + (cli ? forwarded : ["--payload", payload.root.path])
            #if CONTRIBUTION_TEST_SUPPORT_ROOT
            arguments += ["--state-dir", support.appendingPathComponent("Journal").path]
            #endif
            if !cli {
                // This is the existing launchd helper, supervising one verified
                // engine child. The inherited private pipe carries categories
                // only; no second service, network transport or queue is added.
                let worker = Process(), hints = Pipe()
                worker.executableURL = URL(fileURLWithPath: node)
                worker.arguments = Array(arguments.dropFirst())
                worker.standardInput = hints
                worker.standardOutput = FileHandle.standardOutput
                worker.standardError = FileHandle.standardError
                let relay = ConnectivityHints(hints.fileHandleForWriting)
                signal(SIGTERM, SIG_IGN); signal(SIGINT, SIG_IGN); signal(SIGPIPE, SIG_IGN)
                let termination = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
                let interruption = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
                termination.setEventHandler { relay.stop(); if worker.isRunning { worker.terminate() } }
                interruption.setEventHandler { relay.stop(); if worker.isRunning { worker.interrupt() } }
                termination.resume(); interruption.resume()
                worker.terminationHandler = { child in exit(child.terminationStatus) }
                try worker.run()
                #if CONTRIBUTION_TEST_SUPPORT_ROOT
                FileHandle.standardInput.readabilityHandler = { handle in
                    let data = handle.availableData
                    if !data.isEmpty { relay.forward(data) }
                }
                #endif
                let wake = NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { _ in relay.send("wake") }
                let network = SCDynamicStoreCreate(nil, "Contribution connectivity hints" as CFString, { _, _, _ in
                    NotificationCenter.default.post(name: Notification.Name("ContributionNetworkHint"), object: nil)
                }, nil)
                let observer = NotificationCenter.default.addObserver(forName: Notification.Name("ContributionNetworkHint"), object: nil, queue: .main) { _ in relay.send("network") }
                if let network {
                    if !SCDynamicStoreSetNotificationKeys(network, nil, ["State:/Network/Global/IPv4", "State:/Network/Global/IPv6", "State:/Network/Global/DNS", "State:/Network/Interface/.*/.*"] as CFArray) { relay.fact("subscription_failed") }
                    else if !SCDynamicStoreSetDispatchQueue(network, .main) { relay.fact("dispatch_failed") }
                    else { relay.fact("available") }
                } else { relay.fact("store_unavailable") }
                relay.send("launch")
                withExtendedLifetime((network, wake, observer, termination, interruption)) { RunLoop.main.run() }
                return
            }
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
