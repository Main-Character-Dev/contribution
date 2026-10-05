import XCTest
@testable import ContributionPlatform

final class RepositorySettingsTests: XCTestCase {
    private func repository(_ adapter: String = "generic-v1") throws -> JSONValue {
        var fields = try JSONDecoder().decode(JSONValue.self, from: Data(#"{"id":"11111111-2222-4333-8444-555555555555","revision":"reviewed-revision","config":{"schemaVersion":1,"repositoryId":"11111111-2222-4333-8444-555555555555","name":"Project","integration":{"adapter":"generic-v1","branch":"dev"},"publication":{"remote":null,"branch":null,"pullRequestBase":null,"mode":"explicit"},"validation":{"profile":"local-development","gate":"inactive","adapter":"generic-v1","checks":[{"id":"original-check","argv":["original-tool"]}],"builtins":["original-builtin"]},"runtime":{"node":"repository","packageManager":"repository"}}}"#.utf8)).object
        var config = fields["config"]!.object, integration = config["integration"]!.object, validation = config["validation"]!.object
        integration["adapter"] = .string(adapter); validation["adapter"] = .string(adapter)
        config["integration"] = .object(integration); config["validation"] = .object(validation); fields["config"] = .object(config)
        return .object(fields)
    }
    func testSettingsReviewKeepsExactRevisionAndUntouchedPolicy() throws {
        let original = try repository(); var draft = try XCTUnwrap(RepositorySettingsDraft(original))
        XCTAssertNil(draft.review()); draft.remote = "origin"; XCTAssertNil(draft.review())
        draft.branch = "dev"; draft.name = "Reviewed name"; draft.pullRequestBase = "main"
        let change = try XCTUnwrap(draft.review())
        XCTAssertEqual(change.arguments["expectedRevision"], .string("reviewed-revision"))
        XCTAssertEqual(change.config.object["validation"], original.object["config"]?.object["validation"])
        XCTAssertEqual(change.config.object["runtime"], original.object["config"]?.object["runtime"])
        XCTAssertEqual(change.config.object["integration"], original.object["config"]?.object["integration"])
        XCTAssertEqual(change.config.object["publication"]?.object["mode"], .string("explicit"))
        XCTAssertEqual(change.differences.count, 4)
        draft.name = "Changed after review"; XCTAssertEqual(change.config.object["name"], .string("Reviewed name"))
        draft.remote = ""; draft.branch = ""; XCTAssertNil(draft.review()); draft.pullRequestBase = ""; XCTAssertNotNil(draft.review())
    }
    func testAdoptedProfileAndIncompleteMigrationCannotAcquireGenericSettingsAuthority() throws {
        XCTAssertNil(RepositorySettingsDraft(try repository("migration-required")))
        var draft = try XCTUnwrap(RepositorySettingsDraft(try repository("glassalpha-v1")))
        XCTAssertFalse(draft.allowsProfileChange); draft.name = "Reviewed name"; XCTAssertNotNil(draft.review())
        draft.profile = "standard"; XCTAssertNil(draft.review())
        draft.profile = "local-development"; draft.name = "Bad\0name"; XCTAssertNil(draft.review())
    }
}
