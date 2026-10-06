// Generated from connectivity.schema.json.
public enum ConnectivityState: String, Codable, Sendable {
    case `unknown`
    case `checking`
    case `ready`
    case `unavailable`
    case `requires_action`
}
public enum ConnectivityStage: String, Codable, Sendable {
    case `configuration`
    case `resolution`
    case `connection`
    case `trust`
    case `authentication`
    case `helper`
    case `protocol`
    case `identity`
    case `operation`
    case `none`
}
public enum ConnectivityHelper: String, Codable, Sendable {
    case `unknown`
    case `available`
    case `unavailable`
    case `incompatible`
    case `not_applicable`
}
public enum ConnectivityFreshness: String, Codable, Sendable {
    case `fresh`
    case `stale`
    case `unknown`
}
