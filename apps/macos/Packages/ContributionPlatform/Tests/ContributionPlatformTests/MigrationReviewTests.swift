import XCTest
@testable import ContributionPlatform

final class MigrationReviewTests: XCTestCase {
    let repoID = "11111111-2222-4333-8444-555555555555"
    func plan(_ phase: String, registrationOnly: Bool = false) -> JSONValue {
        .object(["proposalId": .string("22222222-2222-4333-8444-555555555555"), "repositoryId": .string(repoID), "phase": .string(phase),
            "expectedRevision": .string("before-revision"), "registrationOnly": .bool(registrationOnly), "files": .array([.object(["path": .string(".husky/pre-push")])])])
    }
    func testActionScopeRetainsPlanRevisionAndRegistrationOnlyBoundary() throws {
        let repository = JSONValue.object(["id": .string(repoID), "revision": .string("before-revision")])
        let applied = try XCTUnwrap(MigrationReview(plan("applied"), repositoryID: repoID))
        XCTAssertEqual(applied.actions, [.activate, .rollback]); XCTAssertNil(applied.arguments(for: .apply, repository: repository))
        let args = try XCTUnwrap(applied.arguments(for: .activate, repository: repository))
        XCTAssertEqual(args["activateAdoption"], .string(applied.id)); XCTAssertEqual(args["expectedRevision"], .string("before-revision"))
        let changed = JSONValue.object(["id": .string(repoID), "revision": .string("after-revision")])
        XCTAssertNil(applied.arguments(for: .activate, repository: changed))
        XCTAssertEqual(applied.arguments(for: .rollback, repository: changed)?["expectedRevision"], .string("after-revision"))
        for phase in ["applying", "rolling_back", "rolled_back"] { XCTAssertEqual(MigrationReview(plan(phase), repositoryID: repoID)?.actions, []) }
        XCTAssertEqual(MigrationReview(plan("prepared", registrationOnly: true), repositoryID: repoID)?.actions, [.activate])
        XCTAssertEqual(MigrationReview(plan("active", registrationOnly: true), repositoryID: repoID)?.actions, [.rollback])
        XCTAssertNil(MigrationReview(plan("active"), repositoryID: UUID().uuidString)); XCTAssertNil(MigrationReview(plan("unknown"), repositoryID: repoID))
    }
    func testExistingRegistrationRequiresDistinctFullHistorySelectors() {
        let original = String(repeating: "a", count: 40), migration = String(repeating: "b", count: 40)
        XCTAssertEqual(MigrationReview.existingHistoryArguments(repositoryID: repoID, original: original, migration: migration)?["originalTip"], .string(original))
        for invalid in ["main", "HEAD~1", "abc123", String(repeating: "z", count: 40), original] {
            XCTAssertNil(MigrationReview.existingHistoryArguments(repositoryID: repoID, original: original, migration: invalid))
        }
    }
}
