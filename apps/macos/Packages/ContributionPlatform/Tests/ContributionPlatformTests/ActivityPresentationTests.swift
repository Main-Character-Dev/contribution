import Foundation
import XCTest
import AppKit
@testable import ContributionPlatform

final class ActivityPresentationTests: XCTestCase {
    func testAttentionAndFiltersNeverTreatUncertainOrInactiveAsSuccess() throws {
        func row(_ state: String) -> ActivityItem {
            ActivityItem(.object(["operationId": .string("op"), "repositoryId": .string("repo"), "kind": .string("remote.push"),
                "state": .string(state), "createdAt": .string("2026-10-05T12:00:00.000Z"),
                "result": .object(["canonicalHostId": .string("mini")]), "error": .object(["message": .string("Authentication required")])]),
                localHostID: "laptop", repositoryName: "Fixture project")
        }
        for state in ["failed", "waiting", "needs_attention", "outcome_unknown", "interrupted", "unexpected"] { XCTAssertEqual(row(state).group, .attention) }
        for state in ["queued", "queued_local", "running"] { XCTAssertEqual(row(state).group, .active) }
        XCTAssertEqual(row("succeeded").group, .recent)
        XCTAssertTrue(row("failed").matches(query: "authentication", repository: "repo", host: "mini", outcome: "failed", since: Date(timeIntervalSince1970: 0)))
        XCTAssertFalse(row("failed").matches(host: "laptop")); XCTAssertFalse(row("failed").matches(repository: "other"))
        XCTAssertFalse(row("failed").matches(since: Date.distantFuture)); XCTAssertFalse(row("failed").matches(outcome: "succeeded"))
        XCTAssertTrue(row("succeeded").matches(query: "Fixture project"))
        XCTAssertEqual(ActivityItem.gateLabel("inactive"), "Inactive"); XCTAssertEqual(ActivityItem.gateLabel("not_run"), "Not run")
        XCTAssertEqual(ActivityItem.gateLabel(nil), "Not observed"); XCTAssertEqual(ActivityItem.gateLabel("unknown"), "Not observed")
    }
    @MainActor func testProgrammaticLogUpdatesPreserveSelectionAndUserScrollPausesFollow() {
        let controller = RetainedLogView.Controller(); var pauses = 0; controller.pause = { pauses += 1 }
        controller.update(text: "first line\nsecond line\n", following: false)
        controller.textView.setSelectedRange(NSRange(location: 0, length: 5))
        controller.update(text: "first line\nsecond line\nthird line\n", following: false)
        XCTAssertEqual(controller.textView.selectedRange(), NSRange(location: 0, length: 5)); XCTAssertEqual(pauses, 0)
        XCTAssertEqual(controller.textView.string, "first line\nsecond line\n")
        NotificationCenter.default.post(name: NSScrollView.didLiveScrollNotification, object: controller.scrollView)
        XCTAssertEqual(pauses, 1)
        controller.update(text: "short", following: false)
        XCTAssertLessThanOrEqual(NSMaxRange(controller.textView.selectedRange()), 5)
        controller.update(text: "short\nnew", following: true); XCTAssertEqual(pauses, 1)
        XCTAssertEqual(controller.textView.string, "short\nnew")
    }
}
