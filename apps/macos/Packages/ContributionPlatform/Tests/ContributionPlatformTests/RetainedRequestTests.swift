import XCTest
@testable import ContributionPlatform

final class RetainedRequestTests: XCTestCase {
    @MainActor func testLostReplySurvivesReopeningAndCannotChangeScope() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        defer { try? FileManager.default.removeItem(at: directory) }
        let original = RetainedRequest(command: "devices.install", args: ["repo": .string("fixture"), "artifact": .string("sealed-artifact")])
        let journal = NativeRequestJournal(directory: directory)
        try journal.retain(original)
        let reopened = NativeRequestJournal(directory: directory)
        XCTAssertEqual(try reopened.pending(), original)
        try reopened.retain(original)
        XCTAssertThrowsError(try reopened.retain(RetainedRequest(command: original.command, args: original.args)))
        XCTAssertThrowsError(try reopened.resolve(RetainedRequest(command: "devices.launch", args: [:])))
        XCTAssertEqual(try reopened.pending()?.requestID, original.requestID)
        try reopened.resolve(original)
        XCTAssertNil(try journal.pending())
    }
    @MainActor func testUnreadableOrPublicPendingRequestsRemainBlocked() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        defer { try? FileManager.default.removeItem(at: directory) }
        let journal = NativeRequestJournal(directory: directory), path = directory.appendingPathComponent("native-pending-request.json")
        try Data("incomplete".utf8).write(to: path)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path.path)
        XCTAssertThrowsError(try journal.pending())
        XCTAssertThrowsError(try journal.retain(RetainedRequest(command: "devices.install", args: [:])))
        XCTAssertEqual(try String(contentsOf: path, encoding: .utf8), "incomplete")
        try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: path.path)
        XCTAssertThrowsError(try journal.pending())
    }
}
