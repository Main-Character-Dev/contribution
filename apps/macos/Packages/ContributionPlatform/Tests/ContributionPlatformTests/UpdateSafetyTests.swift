import XCTest
@testable import ContributionPlatform

final class UpdateSafetyTests: XCTestCase {
    func testInstallerLifecycleCannotReleaseOnAnOrdinaryCycleFinish() throws {
        var state = UpdateSafetyState()
        XCTAssertFalse(state.helperStopped)
        XCTAssertTrue(state.canReleaseAfterCycle)
        state.helperStopped = true; state.extracting()
        XCTAssertFalse(state.canReleaseAfterCycle)
        state.choice(skipped: false, installing: true)
        XCTAssertFalse(state.canReleaseAfterCycle, "Dismiss while installing leaves installation on quit possible")
        let restored = try JSONDecoder().decode(UpdateSafetyState.self, from: JSONEncoder().encode(state))
        XCTAssertEqual(restored, state)
        XCTAssertFalse(restored.canReleaseAfterCycle, "An app restart cannot clear an installer hold")
        state.choice(skipped: true, installing: true)
        XCTAssertTrue(state.canReleaseAfterCycle, "A completed explicit skip is a cancellation route")
        state.extracting()
        XCTAssertFalse(state.canReleaseAfterCycle, "Another extraction must invalidate the prior cancellation")
    }
}
