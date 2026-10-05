import Foundation

public struct RepositorySettingsDraft: Equatable, Sendable {
    public let repositoryID: String
    public let revision: String
    public let original: JSONValue
    public let allowsProfileChange: Bool
    public var name: String
    public var remote: String
    public var branch: String
    public var pullRequestBase: String
    public var profile: String
    public init?(_ repository: JSONValue) {
        let fields = repository.object
        guard let id = fields["id"]?.text, UUID(uuidString: id) != nil,
              let revision = fields["revision"]?.text, !revision.isEmpty,
              let config = fields["config"], config.object["repositoryId"]?.text == id,
              let gate = config.object["validation"]?.object["gate"]?.text, ["enabled", "inactive"].contains(gate),
              let adapter = config.object["integration"]?.object["adapter"]?.text,
              ["generic-v1", "mathy-v1", "maincharacter-v1", "roboty-v1", "glassalpha-v1"].contains(adapter) else { return nil }
        repositoryID = id; self.revision = revision; original = config; allowsProfileChange = adapter == "generic-v1"
        name = config.object["name"]?.text ?? ""
        let publication = config.object["publication"]?.object ?? [:]
        remote = publication["remote"]?.text ?? ""; branch = publication["branch"]?.text ?? ""; pullRequestBase = publication["pullRequestBase"]?.text ?? ""
        profile = config.object["validation"]?.object["profile"]?.text ?? ""
    }
    public func review() -> RepositorySettingsChange? {
        let values = [name, remote, branch, pullRequestBase].map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        guard !values[0].isEmpty, values.allSatisfy({ !$0.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) }),
              values[1].isEmpty == values[2].isEmpty, !values[1].isEmpty || values[3].isEmpty,
              ["local-development", "standard"].contains(profile), allowsProfileChange || profile == original.object["validation"]?.object["profile"]?.text else { return nil }
        var config = original.object, publication = config["publication"]?.object ?? [:], validation = config["validation"]?.object ?? [:]
        config["name"] = .string(values[0])
        for (key, value) in zip(["remote", "branch", "pullRequestBase"], values.dropFirst()) { publication[key] = value.isEmpty ? .null : .string(value) }
        config["publication"] = .object(publication); validation["profile"] = .string(profile); config["validation"] = .object(validation)
        let updated = JSONValue.object(config)
        guard updated != original else { return nil }
        var changes: [RepositorySettingDifference] = []
        func include(_ label: String, _ before: JSONValue?, _ after: JSONValue?) {
            guard before != after else { return }
            changes.append(.init(label: label, before: before == .null ? "Not configured" : before?.text ?? "Unknown", after: after == .null ? "Not configured" : after?.text ?? "Unknown"))
        }
        include("Project name", original.object["name"], config["name"])
        for (key, label) in [("remote", "Git remote"), ("branch", "Publication branch"), ("pullRequestBase", "Pull request base")] { include(label, original.object["publication"]?.object[key], publication[key]) }
        include("Validation profile", original.object["validation"]?.object["profile"], validation["profile"])
        return RepositorySettingsChange(repositoryID: repositoryID, revision: revision, config: updated, differences: changes)
    }
}
public struct RepositorySettingDifference: Equatable, Sendable, Identifiable {
    public let label: String
    public let before: String
    public let after: String
    public var id: String { label }
}
public struct RepositorySettingsChange: Equatable, Sendable, Identifiable {
    public let id = UUID()
    public let repositoryID: String
    public let revision: String
    public let config: JSONValue
    public let differences: [RepositorySettingDifference]
    public var arguments: [String: JSONValue] { ["repo": .string(repositoryID), "expectedRevision": .string(revision), "config": config] }
}
