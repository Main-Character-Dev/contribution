import Foundation

public struct CLIInstallation: Sendable {
    public let home: URL
    public let bundle: URL
    public init(home: URL = FileManager.default.homeDirectoryForCurrentUser, bundle: URL = Bundle.main.bundleURL) { self.home = home; self.bundle = bundle }
    public var destination: URL { home.appendingPathComponent(".local/bin/contribution") }
    private var target: URL { bundle.appendingPathComponent("Contents/MacOS/contribution") }
    private var receipt: URL { home.appendingPathComponent("Library/Application Support/Contribution/cli-installation.json") }
    private func error(_ reason: String) -> NSError { NSError(domain: "Contribution.Installation", code: 1, userInfo: [NSLocalizedDescriptionKey: reason]) }
    public var status: String {
        guard let link = try? FileManager.default.destinationOfSymbolicLink(atPath: destination.path) else { return FileManager.default.fileExists(atPath: destination.path) ? "Another file occupies the CLI location" : "Not installed" }
        return link == target.path ? "Installed at ~/.local/bin/contribution" : "CLI points to another installation"
    }
    public func install() throws {
        let manager = FileManager.default
        guard manager.isExecutableFile(atPath: target.path) else { throw error("This app does not contain the packaged CLI.") }
        let expected = target.path
        if (try? manager.destinationOfSymbolicLink(atPath: destination.path)) == expected { return }
        // Refuse any existing file, directory or dangling link. No unrelated executable is replaced.
        guard (try? manager.attributesOfItem(atPath: destination.path)) == nil else { throw error("The CLI location is occupied. Preserve that file and choose which installation to keep.") }
        try manager.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
        try manager.createDirectory(at: receipt.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let data = try JSONEncoder().encode(["target": expected, "destination": destination.path])
        try data.write(to: receipt, options: [.atomic, .completeFileProtectionUnlessOpen])
        try manager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: receipt.path)
        try manager.createSymbolicLink(atPath: destination.path, withDestinationPath: expected)
    }
    public func uninstallOwnedLink() throws {
        let manager = FileManager.default
        guard let data = try? Data(contentsOf: receipt), let record = try? JSONDecoder().decode([String: String].self, from: data), record["destination"] == destination.path,
              let expected = record["target"], (try? manager.destinationOfSymbolicLink(atPath: destination.path)) == expected else { throw error("The CLI link no longer matches its installation receipt. It has been preserved.") }
        try manager.removeItem(at: destination)
        try manager.removeItem(at: receipt)
    }
}
