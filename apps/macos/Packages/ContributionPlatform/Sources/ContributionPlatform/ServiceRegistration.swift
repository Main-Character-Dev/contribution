import Foundation
import ServiceManagement

@MainActor public enum ServiceRegistration {
    private static var service: SMAppService { .agent(plistName: "dev.contribution.service.plist") }
    public static var isEnabled: Bool { service.status == .enabled }
    public static var status: String {
        switch service.status {
        case .enabled: "Enabled"
        case .requiresApproval: "Approval required in System Settings"
        case .notRegistered: "Not registered"
        case .notFound: "This build does not contain the service payload"
        @unknown default: "Unknown registration state"
        }
    }
    private static let lifecycle = PersistentServiceLifecycle()
    public static func register() throws { try lifecycle.reconcile(isRegistered: { service.status == .enabled }, isUnloaded: { service.status == .notRegistered }); try lifecycle.register(isRegistered: { service.status == .enabled }, effect: { try service.register() }) }
    public static func unregister() async throws { try await lifecycle.unregister(isUnloaded: { service.status == .notRegistered }, effect: { try await service.unregister() }) }
    public static func openSettings() { SMAppService.openSystemSettingsLoginItems() }
}
