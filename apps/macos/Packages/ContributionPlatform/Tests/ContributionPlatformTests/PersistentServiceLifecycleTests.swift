import XCTest
@testable import ContributionPlatform

final class PersistentServiceLifecycleTests: XCTestCase {
    @MainActor func testIntentBeforeRegistrationAndExactPairedRetirement() async throws {
        let fm = FileManager.default, root = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? fm.removeItem(at: root) }
        let bundle = root.appendingPathComponent("Contribution.app"), executable = bundle.appendingPathComponent("Contents/Library/ContributionService"), plist = bundle.appendingPathComponent("Contents/Library/LaunchAgents/dev.contribution.service.plist")
        try fm.createDirectory(at: plist.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("fixture".utf8).write(to: executable); try fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: executable.path)
        let config: [String: Any] = ["Label": "dev.contribution.service", "BundleProgram": "Contents/Library/ContributionService", "KeepAlive": false]
        try PropertyListSerialization.data(fromPropertyList: config, format: .xml, options: 0).write(to: plist)
        let lifecycle = PersistentServiceLifecycle(home: root.appendingPathComponent("home"), bundle: bundle, hostIdentity: { String(repeating: "a", count: 64) })
        var registered = false, starts = 0
        try lifecycle.register(isRegistered: { registered }) { XCTAssertEqual(try lifecycle.receipt()?.phase, "registrationIntent"); starts += 1; registered = true }
        try lifecycle.register(isRegistered: { registered }) { XCTFail("duplicate registration") }
        XCTAssertEqual(starts, 1); XCTAssertEqual(try lifecycle.receipt()?.phase, "registered")
        try Data("replacement".utf8).write(to: executable)
        do { try await lifecycle.unregister(isUnloaded: { !registered }) { XCTFail("changed payload must remain protected") }; XCTFail("expected drift refusal") } catch { }
        try Data("fixture".utf8).write(to: executable)
        try await lifecycle.unregister(isUnloaded: { !registered }) { XCTAssertEqual(try lifecycle.receipt()?.phase, "retirementIntent"); registered = false }
        XCTAssertEqual(try lifecycle.receipt()?.phase, "retired")
        try await lifecycle.unregister(isUnloaded: { !registered }) { XCTFail("duplicate unload") }
    }
    @MainActor func testMissingPayloadAndInterruptedRegistrationDoNotRepeatStartup() throws {
        let fm = FileManager.default, root = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? fm.removeItem(at: root) }
        let bundle = root.appendingPathComponent("Contribution.app"), executable = bundle.appendingPathComponent("Contents/Library/ContributionService"), plist = bundle.appendingPathComponent("Contents/Library/LaunchAgents/dev.contribution.service.plist")
        let lifecycle = PersistentServiceLifecycle(home: root.appendingPathComponent("home"), bundle: bundle, hostIdentity: { String(repeating: "a", count: 64) })
        XCTAssertThrowsError(try lifecycle.register(isRegistered: { false }) { XCTFail("missing executable") })
        try fm.createDirectory(at: plist.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("fixture".utf8).write(to: executable); try fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: executable.path)
        try PropertyListSerialization.data(fromPropertyList: ["Label": "dev.contribution.service", "BundleProgram": "Contents/Library/ContributionService", "KeepAlive": false], format: .xml, options: 0).write(to: plist)
        var effects = 0
        XCTAssertThrowsError(try lifecycle.register(isRegistered: { false }) { effects += 1; throw NSError(domain: "fixture", code: 1) })
        XCTAssertEqual(try lifecycle.receipt()?.phase, "unresolved")
        XCTAssertThrowsError(try lifecycle.register(isRegistered: { false }) { effects += 1 })
        XCTAssertEqual(effects, 1)
        try lifecycle.reconcile(isRegistered: { true }, isUnloaded: { false })
        XCTAssertEqual(try lifecycle.receipt()?.phase, "registered")
    }
    @MainActor func testLostUnloadReplyHasFiniteDeadlineAndCannotRepeatWhileUnconfirmed() async throws {
        let fm = FileManager.default, root = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? fm.removeItem(at: root) }
        let bundle = root.appendingPathComponent("Contribution.app"), executable = bundle.appendingPathComponent("Contents/Library/ContributionService"), plist = bundle.appendingPathComponent("Contents/Library/LaunchAgents/dev.contribution.service.plist")
        try fm.createDirectory(at: plist.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("fixture".utf8).write(to: executable); try fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: executable.path)
        try PropertyListSerialization.data(fromPropertyList: ["Label": "dev.contribution.service", "BundleProgram": "Contents/Library/ContributionService", "KeepAlive": false], format: .xml, options: 0).write(to: plist)
        let lifecycle = PersistentServiceLifecycle(home: root.appendingPathComponent("home"), bundle: bundle, hostIdentity: { String(repeating: "a", count: 64) })
        var registered = false, effects = 0
        var late: CheckedContinuation<Void, Never>?
        try lifecycle.register(isRegistered: { registered }) { registered = true }
        let start = Date()
        do { try await lifecycle.unregister(isUnloaded: { !registered }) { effects += 1; await withCheckedContinuation { late = $0 } }; XCTFail("expected finite timeout") } catch { }
        XCTAssertLessThan(Date().timeIntervalSince(start), 7)
        XCTAssertEqual(try lifecycle.receipt()?.phase, "retirementUnconfirmed")
        do { try await lifecycle.unregister(isUnloaded: { !registered }) { effects += 1 }; XCTFail("uncertain unload must not repeat") } catch { }
        XCTAssertEqual(effects, 1)
        registered = false; late?.resume(); await Task.yield()
        try lifecycle.reconcile(isRegistered: { registered }, isUnloaded: { !registered })
        XCTAssertEqual(try lifecycle.receipt()?.phase, "retired")
    }

    @MainActor func testForeignHostAndUnsupportedReceiptVersionPreserveRegistration() async throws {
        let fm = FileManager.default, root = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? fm.removeItem(at: root) }
        let bundle = root.appendingPathComponent("Contribution.app"), executable = bundle.appendingPathComponent("Contents/Library/ContributionService"), plist = bundle.appendingPathComponent("Contents/Library/LaunchAgents/dev.contribution.service.plist")
        try fm.createDirectory(at: plist.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("fixture".utf8).write(to: executable); try fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: executable.path)
        try PropertyListSerialization.data(fromPropertyList: ["Label": "dev.contribution.service", "BundleProgram": "Contents/Library/ContributionService", "KeepAlive": false], format: .xml, options: 0).write(to: plist)
        var host = String(repeating: "a", count: 64), registered = false
        let lifecycle = PersistentServiceLifecycle(home: root.appendingPathComponent("home"), bundle: bundle, hostIdentity: { host })
        try lifecycle.register(isRegistered: { registered }) { registered = true }
        host = String(repeating: "b", count: 64)
        do { try await lifecycle.unregister(isUnloaded: { !registered }) { XCTFail("foreign host must not unload") }; XCTFail("expected host fence") } catch { }
        XCTAssertTrue(registered)
        host = String(repeating: "a", count: 64)
        let receipt = root.appendingPathComponent("home/Library/Application Support/Contribution/service-installation.json")
        var value = try JSONSerialization.jsonObject(with: Data(contentsOf: receipt)) as! [String: Any]
        value["schemaVersion"] = 99; try JSONSerialization.data(withJSONObject: value).write(to: receipt)
        XCTAssertThrowsError(try lifecycle.receipt())
        do { try await lifecycle.unregister(isUnloaded: { !registered }) { XCTFail("unsupported reader must not unload") }; XCTFail("expected version fence") } catch { }
        XCTAssertTrue(registered)
    }

}
