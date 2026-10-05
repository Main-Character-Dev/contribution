import XCTest
@testable import ContributionPlatform

final class RetainedRequestTests: XCTestCase {
    @MainActor func testStorageRecoveryRetainsItsOwnReviewWithoutDiscardingAnUnresolvedOperation() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        defer { try? FileManager.default.removeItem(at: directory) }
        let operation = NativeRequestJournal(directory: directory), control = NativeRequestJournal(directory: directory, slot: .storageSettings)
        let original = RetainedRequest(command: "repos.create", args: ["path": .string("/fixture/project")])
        let recovery = RetainedRequest(command: "service.storage-policy", args: ["config": .object(["schemaVersion": .number(1), "maxStateBytes": .number(10_737_418_240)])])
        try operation.retain(original); try control.retain(recovery)
        XCTAssertEqual(try operation.pending(), original)
        XCTAssertEqual(try NativeRequestJournal(directory: directory, slot: .storageSettings).pending(), recovery)
        XCTAssertThrowsError(try control.retain(RetainedRequest(command: "devices.install", args: [:])))
        XCTAssertThrowsError(try control.resolve(original))
        try control.resolve(recovery)
        XCTAssertEqual(try operation.pending(), original); XCTAssertNil(try control.pending())
        XCTAssertThrowsError(try control.retain(RetainedRequest(command: "devices.install", args: [:])))
        XCTAssertNil(try control.pending())
        let logs = RetainedRequest(command: "settings.apply", args: [:]); try control.retain(logs)
        XCTAssertEqual(try operation.pending(), original); XCTAssertEqual(try control.pending(), logs)
    }
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
