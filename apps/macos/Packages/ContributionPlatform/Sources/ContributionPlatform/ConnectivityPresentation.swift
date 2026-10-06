import Foundation

public struct ConnectivityPresentation: Sendable {
    public let title: String
    public let message: String
    public let freshness: String
    public init(_ fields: [String: JSONValue]) {
        let state = ConnectivityState(rawValue: fields["state"]?.text ?? "") ?? .unknown
        let fresh = ConnectivityFreshness(rawValue: fields["freshness"]?.text ?? "") ?? .unknown
        freshness = fresh.rawValue
        switch state {
        case .ready: title = fresh == .fresh ? "Connected" : "Previously connected"
        case .checking: title = "Checking connection…"
        case .unavailable: title = "Connection unavailable"
        case .requires_action: title = "Connection needs attention"
        case .unknown: title = "Connection not checked"
        }
        switch fields["reasonCode"]?.text {
        case "SSH_HOST_KEY_CHANGED": message = "The SSH host key changed. Verify this Mac before continuing."
        case "SSH_HOST_UNAPPROVED": message = "Verify and approve the SSH host identity in your connection settings."
        case "SSH_AUTH_DENIED": message = "SSH authentication was denied in the background service. Review its credentials and authentication agent."
        case "PEER_HELPER_UNAVAILABLE": message = "SSH reached the Mac, but its Contribution helper is unavailable."
        case "PEER_IDENTITY_CHANGED": message = "This route identifies a different Contribution host. Verify the configured Mac."
        case "PEER_VERSION_MISMATCH", "PEER_PROTOCOL_ERROR": message = "Update the selected hosts to compatible Contribution versions."
        case "SSH_RESOLUTION_FAILED": message = "OpenSSH could not resolve the configured destination."
        case "SSH_TIMEOUT": message = "SSH timed out. Check the remote Mac and your configured network connection."
        case "SSH_REFUSED": message = "The configured SSH connection was refused."
        case "SSH_ROUTE_UNAVAILABLE": message = "OpenSSH reported an unavailable network route."
        case "SSH_CONFIG_INVALID", "INVALID_SSH_ALIAS": message = "Review the configured SSH destination and options."
        case "PROCESS_RELEASE_UNCONFIRMED": message = "A connection process still needs its retained ownership reconciled."
        case "PEER_ACTION_UNSUPPORTED": message = "This peer needs an update for read-only health checks. Ordinary authenticated work can still verify its connection."
        case "NONE": message = state == .ready ? "Authenticated Contribution health was observed on the configured route." : "Check the configured connection."
        default: message = "The connection cause is unknown. Accepted work remains retained."
        }
    }
}
