import Foundation
import XCTest
@testable import ContributionPlatform

final class EnvelopeTests: XCTestCase {
    func testFixtureAndNegativeParity() throws {
        guard let root = ProcessInfo.processInfo.environment["CONTRIBUTION_ROOT"] else {
            throw XCTSkip("Run scripts/native-test.sh to supply canonical fixtures")
        }
        let manifest = URL(fileURLWithPath: root).appendingPathComponent(".build/swift-parity.json")
        let data = try Data(contentsOf: manifest)
        guard case .object(let cases) = try JSONDecoder().decode(JSONValue.self, from: data),
              case .array(let positives) = cases["positive"], case .array(let negatives) = cases["negative"] else {
            XCTFail("Invalid parity manifest"); return
        }
        XCTAssertGreaterThanOrEqual(positives.count, 7)
        XCTAssertGreaterThanOrEqual(negatives.count, 9)
        for value in positives {
            let encoded = try JSONEncoder().encode(value)
            let envelope = try JSONDecoder().decode(ResponseEnvelope.self, from: encoded)
            XCTAssertEqual(try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(envelope)), value)
        }
        for value in negatives {
            XCTAssertThrowsError(try JSONDecoder().decode(ResponseEnvelope.self, from: JSONEncoder().encode(value)))
        }
    }
    func testDevelopmentClientMatchesEngine() throws {
        guard let root = ProcessInfo.processInfo.environment["CONTRIBUTION_ROOT"] else {
            throw XCTSkip("Run scripts/native-test.sh")
        }
        for (name, response) in [("version", try DevelopmentClient().version()),
                                 ("unavailable", try DevelopmentClient().availability())] {
            let expected = try JSONDecoder().decode(JSONValue.self, from:
                Data(contentsOf: URL(fileURLWithPath: root).appendingPathComponent(".build/\(name).json")))
            XCTAssertEqual(try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(response)), expected)
        }
    }
}
