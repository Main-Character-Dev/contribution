// Generated from version.json and response.schema.json.
public enum BuildIdentity {
    public static let version = "0.1.0"
    public static let build = "1"
    public static let channel = "development"
    public static let schemaVersion = 1
}
public enum RequestStatus: String, Codable, Sendable {
    case completed
    case accepted
    case rejected
}
public enum OperationState: String, Codable, Sendable {
    case queued_local
    case queued
    case waiting
    case running
    case succeeded
    case failed
    case cancelled
    case interrupted
    case outcome_unknown
    case needs_attention
}
