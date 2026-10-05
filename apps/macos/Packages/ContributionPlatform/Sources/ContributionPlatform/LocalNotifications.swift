import Foundation
import UserNotifications

@MainActor public final class LocalNotifications: NSObject, UNUserNotificationCenterDelegate {
    public var onOpen: (@MainActor @Sendable ([String: String]) async -> Void)?
    private let center = UNUserNotificationCenter.current()
    private var running = false
    public override init() { super.init(); center.delegate = self }
    public func permission() async -> String {
        switch await center.notificationSettings().authorizationStatus {
        case .authorized, .provisional, .ephemeral: return "Allowed"
        case .denied: return "Denied; activity remains available"
        case .notDetermined: return "Not requested"
        @unknown default: return "Unknown"
        }
    }
    public func requestPermission() async throws { _ = try await center.requestAuthorization(options: [.alert, .sound]) }
    public func poll(client: ServiceClient) async {
        guard !running else { return }; running = true; defer { running = false }
        let permission = await center.notificationSettings().authorizationStatus
        guard permission == .authorized || permission == .provisional else { return }
        do {
            let response = try await client.request("notifications.pending")
            let notices = response.fields["result"]?.object["notices"]?.array ?? []
            let delivered = await center.deliveredNotifications().map(\.request)
            let scheduled = await center.pendingNotificationRequests()
            for value in notices {
                var notice = value.object
                guard let identity = notice["id"]?.text, let revision = notice["revision"]?.text,
                      let repository = notice["repositoryId"]?.text, let origin = notice["originHostId"]?.text,
                      !identity.isEmpty, !revision.isEmpty, !repository.isEmpty, !origin.isEmpty else { continue }
                let route: [String: JSONValue] = ["repo": .string(repository), "originHostId": .string(origin), "noticeId": .string(identity), "revision": .string(revision)]
                if notice["state"]?.text == "superseded" {
                    center.removeDeliveredNotifications(withIdentifiers: [identity]); center.removePendingNotificationRequests(withIdentifiers: [identity])
                    await acknowledge(client, route, notice, delivered: false); continue
                }
                let known = UserDefaults.standard.string(forKey: "notice.\(identity)") == revision || (delivered + scheduled).contains { $0.identifier == identity && $0.content.userInfo["revision"] as? String == revision }
                if notice["state"]?.text == "uncertain" { continue }
                if notice["state"]?.text == "pending" {
                    var args = route; args["requestId"] = .string(UUID().uuidString)
                    let claim = try await client.request("notifications.claim", args: args)
                    guard case .null? = claim.fields["error"], let result = claim.fields["result"] else { continue }
                    notice = result.object["notice"]?.object ?? [:]
                    guard result.object["newlyClaimed"]?.boolean == true else { continue }
                    if !known {
                        let content = UNMutableNotificationContent()
                        content.title = notice["title"]?.text ?? "Contribution"
                        content.body = notice["body"]?.text ?? "Open the retained activity."
                        content.threadIdentifier = identity
                        content.userInfo = ["noticeId": identity, "revision": revision, "repo": repository, "originHostId": origin]
                        do {
                            try await center.add(UNNotificationRequest(identifier: identity, content: content, trigger: nil))
                            UserDefaults.standard.set(revision, forKey: "notice.\(identity)")
                        } catch {
                            await acknowledge(client, route, notice, delivered: false); continue
                        }
                    }
                    await acknowledge(client, route, notice, delivered: true)
                } else if notice["state"]?.text == "claimed" {
                    // A previous process may have reached the OS before losing its
                    // reply. Observe existing delivery; never schedule it again.
                    await acknowledge(client, route, notice, delivered: known)
                }
            }
        } catch { /* Channel failure never blocks the workflow or changes its result. */ }
    }
    private func acknowledge(_ client: ServiceClient, _ route: [String: JSONValue], _ notice: [String: JSONValue], delivered: Bool) async {
        guard let token = notice["claim"]?.object["token"] else { return }
        var args = route; args["token"] = token; args["delivered"] = .bool(delivered)
        _ = try? await client.request("notifications.acknowledge", args: args)
    }
    nonisolated public func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let values = response.notification.request.content.userInfo
        let route = ["repo", "originHostId", "noticeId"].reduce(into: [String: String]()) { result, key in if let value = values[key] as? String { result[key] = value } }
        await onOpen?(route)
    }
    nonisolated public func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions { [.banner, .list] }
}
