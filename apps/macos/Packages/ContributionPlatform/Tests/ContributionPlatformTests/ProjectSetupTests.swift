import XCTest
@testable import ContributionPlatform

final class ProjectSetupTests: XCTestCase {
    func testCreationSelectsOneNamedChildOfAnAbsoluteFolder() throws {
        let selection = try XCTUnwrap(ProjectSetup.newProject(name: "  My project  ", parent: "/fixture/parent"))
        XCTAssertEqual(selection.command, "repos.create"); XCTAssertEqual(selection.branch, "dev")
        XCTAssertEqual(selection.arguments, ["path": .string("/fixture/parent/My project")])
        for name in ["", "  ", ".", "..", "../escape", "nested/project", "/absolute", "bad\0name", "line\nbreak", "bad:name"] {
            XCTAssertNil(ProjectSetup.newProject(name: name, parent: "/fixture"))
        }
        XCTAssertNil(ProjectSetup.newProject(name: "project", parent: "relative"))
    }
    func testInitializationRequiresExplicitUnbornObservationForThisExactLocalOwner() throws {
        let id = UUID().uuidString, host = UUID().uuidString
        let repository: JSONValue = .object(["id": .string(id), "path": .string("/fixture/project"), "revision": .string("reviewed-policy"), "canonicalHostId": .string(host),
            "config": .object(["repositoryId": .string(id), "name": .string("Project"), "integration": .object(["branch": .string("dev")])])])
        let status: JSONValue = .object(["repositoryId": .string(id), "checkout": .object(["tip": .null, "branch": .string("dev")])])
        let selection = try XCTUnwrap(ProjectSetup.initialize(repository: repository, status: status, localHostID: host))
        XCTAssertEqual(selection.arguments, ["repo": .string(id), "expectedRevision": .string("reviewed-policy")])
        XCTAssertNil(ProjectSetup.initialize(repository: repository, status: .null, localHostID: host))
        XCTAssertNil(ProjectSetup.initialize(repository: repository, status: status, localHostID: "different"))
        let invalid: [JSONValue] = [.null, .object([:]), .object(["tip": .string("commit"), "branch": .string("dev")]), .object(["tip": .null, "branch": .string("other")])]
        for checkout in invalid {
            var changed = status.object; changed["checkout"] = checkout
            XCTAssertNil(ProjectSetup.initialize(repository: repository, status: .object(changed), localHostID: host))
        }
        var other = status.object; other["repositoryId"] = .string(UUID().uuidString)
        XCTAssertNil(ProjectSetup.initialize(repository: repository, status: .object(other), localHostID: host))
    }
}
