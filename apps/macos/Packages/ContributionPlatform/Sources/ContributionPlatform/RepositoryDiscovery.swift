import Foundation

public struct DiscoveredRepository: Identifiable, Equatable, Sendable {
    public let path: String
    public let commonDirectory: String
    public let branch: String?
    public let hasCommits: Bool
    public var id: String { commonDirectory }
    public var name: String { URL(fileURLWithPath: path).lastPathComponent }
    public var historyLabel: String { branch.map { hasCommits ? $0 : "\($0) · No commits yet" } ?? "Detached checkout · Choose its primary checkout to enroll" }
    public init?(_ value: JSONValue) {
        let fields = value.object
        guard let path = fields["path"]?.text, path.hasPrefix("/"), !path.contains("\0"),
              let common = fields["commonDir"]?.text, common.hasPrefix("/"), !common.contains("\0"),
              let branchValue = fields["branch"], branchValue == .null || !(branchValue.text ?? "").isEmpty,
              let tip = fields["tip"], tip == .null || !(tip.text ?? "").isEmpty else { return nil }
        self.path = path; commonDirectory = common; branch = branchValue == .null ? nil : branchValue.text; hasCommits = tip != .null
    }
}
public struct RepositoryDiscovery: Equatable, Sendable {
    public let repositories: [DiscoveredRepository]
    public let notices: [String]
    public init(_ result: JSONValue) {
        let fields = result.object, scan = fields["scan"]?.object ?? [:]
        repositories = (fields["repositories"]?.array ?? []).compactMap(DiscoveredRepository.init)
        let limits = (scan["limitsReached"]?.array ?? []).compactMap(\.text)
        var messages: [String] = []
        if !limits.isEmpty { messages.append("Scan reached its \(limits.joined(separator: ", ")) limit. Scan a narrower folder to see more projects.") }
        let unreadable = (scan["unreadableDirectories"]?.array ?? []).count
        if unreadable > 0 { messages.append("\(unreadable) folder(s) could not be read. Their projects may be missing here.") }
        let invalid = (scan["invalidRepositories"]?.array ?? []).count
        if invalid > 0 { messages.append("\(invalid) Git folder(s) could not be inspected.") }
        notices = messages
    }
}
