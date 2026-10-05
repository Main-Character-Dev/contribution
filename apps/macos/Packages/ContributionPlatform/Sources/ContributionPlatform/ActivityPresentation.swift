import Foundation

public enum ActivityGroup: String, CaseIterable, Identifiable, Sendable {
    case attention = "Needs attention", active = "Running or queued", recent = "Recent activity"
    public var id: String { rawValue }
}

public struct ActivityItem: Identifiable, Sendable {
    public let value: JSONValue
    public let localHostID: String
    public let repositoryName: String
    public init(_ value: JSONValue, localHostID: String, repositoryName: String) {
        self.value = value; self.localHostID = localHostID; self.repositoryName = repositoryName
    }
    public var id: String { value.object["operationId"]?.text ?? "" }
    public var repositoryID: String { value.object["repositoryId"]?.text ?? "" }
    public var state: String { value.object["state"]?.text ?? "unknown" }
    public var hostID: String {
        let result = value.object["result"]?.object ?? [:], input = value.object["input"]?.object ?? [:]
        return result["executionHostId"]?.text ?? result["canonicalHostId"]?.text ?? input["destinationHostId"]?.text ?? localHostID
    }
    public var group: ActivityGroup {
        switch state {
        case "queued", "queued_local", "running": .active
        case "succeeded", "cancelled": .recent
        default: .attention
        }
    }
    public var title: String {
        switch value.object["kind"]?.text {
        case "submit": "Land committed work"
        case "push", "remote.push": "Publish selected work"
        case "checks": "Run local checks"
        case "initialize": "Initialize project history"
        case "seed", "transfer.seed": "Seed canonical history"
        case "mirror", "transfer.mirror": "Update local mirror"
        case "device_transfer": "Transfer device ownership"
        case "artifact_transfer": "Transfer prepared app"
        case "external_gate": "Observe external publication gate"
        case "device", "remote.device": "Device operation"
        case "settings.apply": "Update preferences"
        default: (value.object["kind"]?.text ?? "Operation").replacingOccurrences(of: "_", with: " ").capitalized
        }
    }
    public var reason: String { value.object["error"]?.object["message"]?.text ?? "" }
    public var createdAt: Date? {
        guard let text = value.object["createdAt"]?.text else { return nil }
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: text) { return date }
        formatter.formatOptions = [.withInternetDateTime]; return formatter.date(from: text)
    }
    public func matches(query: String = "", repository: String? = nil, host: String? = nil, outcome: String? = nil, since: Date? = nil) -> Bool {
        if let repository, repository != repositoryID { return false }
        if let host, host != hostID { return false }
        if let outcome, outcome != state { return false }
        if let since, createdAt.map({ $0 >= since }) != true { return false }
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let input = value.object["input"]?.object ?? [:]
        return query.isEmpty || [title, repositoryName, state, reason, id, input["tip"]?.text ?? "", input["base"]?.text ?? ""]
            .contains { $0.localizedCaseInsensitiveContains(query) }
    }
    public static func gateLabel(_ state: String?) -> String {
        switch state {
        case "passed": "Passed"
        case "inactive": "Inactive"
        case "not_run": "Not run"
        case "failed": "Failed"
        case "cancelled": "Cancelled"
        case "reused": "Reused evidence"
        case "skipped": "Skipped"
        default: "Not observed"
        }
    }
}
