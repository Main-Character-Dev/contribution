import XCTest
@testable import ContributionPlatform

final class ConnectivityTests: XCTestCase {
    func testFreshAndStaleEvidenceNeverClaimTheSameReadiness() {
        XCTAssertEqual(ConnectivityPresentation(["state": .string("ready"), "freshness": .string("fresh"), "reasonCode": .string("NONE")]).title, "Connected")
        XCTAssertEqual(ConnectivityPresentation(["state": .string("ready"), "freshness": .string("stale")]).title, "Previously connected")
        XCTAssertEqual(ConnectivityPresentation(["state": .string("checking")]).title, "Checking connection…")
    }
    func testTrustAndHelperRecoveryAreDistinctAndFreeFormDetailsStayPrivate() {
        XCTAssertTrue(ConnectivityPresentation(["state": .string("requires_action"), "reasonCode": .string("SSH_HOST_KEY_CHANGED")]).message.contains("Verify"))
        XCTAssertTrue(ConnectivityPresentation(["reasonCode": .string("PEER_HELPER_UNAVAILABLE")]).message.contains("helper"))
        let unknown = ConnectivityPresentation(["state": .string("private-invalid-state"), "reasonCode": .string("private-endpoint")])
        XCTAssertEqual(unknown.title, "Connection not checked")
        XCTAssertFalse(unknown.message.contains("private-endpoint"))
    }
}
