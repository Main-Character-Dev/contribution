import XCTest
@testable import ContributionPlatform

final class RepositoryDiscoveryTests: XCTestCase {
    func testUnbornDetachedAndIncompleteScanRemainExplicit() throws {
        let result = try JSONDecoder().decode(JSONValue.self, from: Data(#"{"repositories":[{"path":"/fixture/unborn","commonDir":"/fixture/unborn/.git","branch":"dev","tip":null},{"path":"/fixture/task","commonDir":"/fixture/primary/.git","branch":null,"tip":"abc"},{"path":"relative","commonDir":"/fixture/invalid/.git","branch":"main","tip":null}],"scan":{"limitsReached":["directories","deadline"],"unreadableDirectories":["/fixture/private"],"invalidRepositories":["/fixture/broken"]}}"#.utf8))
        let presentation = RepositoryDiscovery(result)
        XCTAssertEqual(presentation.repositories.count, 2)
        XCTAssertEqual(presentation.repositories[0].historyLabel, "dev · No commits yet")
        XCTAssertNil(presentation.repositories[1].branch)
        XCTAssertTrue(presentation.repositories[1].historyLabel.contains("Detached"))
        XCTAssertEqual(presentation.notices.count, 3)
        XCTAssertTrue(presentation.notices[0].contains("deadline"))
        XCTAssertTrue(presentation.notices[1].contains("could not be read"))
    }
}
