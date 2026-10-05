import XCTest
@testable import ContributionPlatform

final class StorageReviewTests: XCTestCase {
    func testReviewBindsKindAndExactScopeBeforeCleanup() throws {
        let token = UUID().uuidString
        let value: JSONValue = .object(["scopeToken": .string(token), "mutation": .string("none"), "worktrees": .bool(true), "candidates": .array([.object(["directory": .string("/fixture/owned")])]), "protected": .array([])])
        let review = try XCTUnwrap(StorageReview(category: .worktrees, value: value))
        XCTAssertEqual(review.cleanupArguments, ["scopeToken": .string(token), "worktrees": .bool(true)])
        XCTAssertNil(StorageReview(category: .output, value: value))
        var empty = value.object; empty["candidates"] = .array([])
        XCTAssertNil(StorageReview(category: .worktrees, value: .object(empty))?.cleanupArguments)
        empty["scopeToken"] = .string("unconfirmed")
        XCTAssertNil(StorageReview(category: .worktrees, value: .object(empty)))
    }
    func testLogPolicyPreservesSummarySettingAndExactByteUnits() {
        let existing: JSONValue = .object(["summaryDays": .number(365), "rawLogDays": .number(30), "maxLogBytes": .number(10)])
        let value = StorageReview.retention(rawDays: "14", capMiB: "0.5", existing: existing)
        XCTAssertEqual(value?.object["maxLogBytes"], .number(524_288)); XCTAssertEqual(value?.object["summaryDays"], .number(365))
        for bad in ["0", "-1", "2junk", "NaN", "0.00000001", "99999999999999999999"] {
            XCTAssertNil(StorageReview.retention(rawDays: "14", capMiB: bad, existing: existing))
        }
        XCTAssertNil(StorageReview.retention(rawDays: "0", capMiB: "2", existing: existing))
        XCTAssertEqual(StorageReview.managedPolicy(capGiB: "10")?.object["maxStateBytes"], .number(10_737_418_240))
        XCTAssertEqual(StorageReview.managedPolicy(capGiB: "0.0009765625")?.object["maxStateBytes"], .number(1_048_576))
        for bad in ["0", "0.0001", "-1", "2junk", "1e3", "99999999999999999999", "0.00097656251"] { XCTAssertNil(StorageReview.managedPolicy(capGiB: bad)) }
    }
    @MainActor func testPartialCleanupErrorRetainsTheNativeRequestAcrossReopening() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        defer { try? FileManager.default.removeItem(at: directory) }
        let request = RetainedRequest(command: "service.storage", args: ["scopeToken": .string(UUID().uuidString), "worktrees": .bool(true)])
        let journal = NativeRequestJournal(directory: directory); try journal.retain(request)
        let response = try ResponseEnvelope(fields: ["schemaVersion": .number(1), "requestStatus": .string("rejected"), "operationId": .null, "operationState": .null,
            "result": .object(["requestRetained": .bool(true), "requestId": .string(request.requestID)]),
            "error": .object(["code": .string("STORAGE_SELECTION_CHANGED"), "message": .string("New files remain protected."), "retryable": .bool(false), "nextActions": .array([])])])
        XCTAssertFalse(try journal.resolveIfComplete(request, response: response))
        XCTAssertEqual(try NativeRequestJournal(directory: directory).pending(), request)
        let completed = try ResponseEnvelope(fields: ["schemaVersion": .number(1), "requestStatus": .string("completed"), "operationId": .null, "operationState": .null, "result": .object([:]), "error": .null])
        XCTAssertTrue(try journal.resolveIfComplete(request, response: completed)); XCTAssertNil(try journal.pending())
    }
}
