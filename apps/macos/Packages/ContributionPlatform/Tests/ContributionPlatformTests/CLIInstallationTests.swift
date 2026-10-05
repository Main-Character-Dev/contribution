import XCTest
@testable import ContributionPlatform

final class CLIInstallationTests: XCTestCase {
    func testExplicitInstallationPreservesForeignFilesAndRemovesOnlyOwnedLink() throws {
        let manager = FileManager.default, root = manager.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? manager.removeItem(at: root) }
        let bundle = root.appendingPathComponent("Contribution.app"), binary = bundle.appendingPathComponent("Contents/MacOS/contribution")
        try manager.createDirectory(at: binary.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("fixture".utf8).write(to: binary); try manager.setAttributes([.posixPermissions: 0o700], ofItemAtPath: binary.path)
        let installer = CLIInstallation(home: root.appendingPathComponent("home"), bundle: bundle)
        try installer.install(); XCTAssertTrue(installer.status.hasPrefix("Installed")); try installer.install()
        let receipt = root.appendingPathComponent("home/Library/Application Support/Contribution/cli-installation.json")
        let record = try JSONDecoder().decode([String: String].self, from: Data(contentsOf: receipt))
        XCTAssertEqual(record["destination"], installer.destination.path)
        XCTAssertEqual(record["target"], try manager.destinationOfSymbolicLink(atPath: installer.destination.path))
        try installer.uninstallOwnedLink(); XCTAssertEqual(installer.status, "Not installed")
        try Data("owner executable".utf8).write(to: installer.destination)
        XCTAssertThrowsError(try installer.install()); XCTAssertThrowsError(try installer.uninstallOwnedLink())
        XCTAssertEqual(try String(contentsOf: installer.destination, encoding: .utf8), "owner executable")
    }
}
