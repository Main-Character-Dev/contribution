import Foundation
import ServiceManagement

@MainActor public enum ServiceRegistration {
    private static var service: SMAppService { .agent(plistName: "dev.contribution.service.plist") }
    public static var status: String {
        switch service.status {
        case .enabled: "Enabled"
        case .requiresApproval: "Approval required in System Settings"
        case .notRegistered: "Not registered"
        case .notFound: "This build does not contain the service payload"
        @unknown default: "Unknown registration state"
        }
    }
    public static func register() throws { try service.register() }
    public static func unregister() async throws { try await service.unregister() }
    public static func openSettings() { SMAppService.openSystemSettingsLoginItems() }
}
