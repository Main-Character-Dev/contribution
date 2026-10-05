import Foundation

/// A reviewed setup action holds the exact destination or enrollment revision.
/// Missing status must never be interpreted as an unborn repository.
public struct ProjectSetup: Identifiable, Equatable, Sendable {
    public var id: String { command + ":" + path }
    public let command: String
    public let name: String
    public let path: String
    public let branch: String
    public let arguments: [String: JSONValue]
    public static func newProject(name: String, parent: String) -> ProjectSetup? {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name != ".", name != "..", !name.contains("/"), !name.contains(":"),
              !name.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
              parent.hasPrefix("/"), !parent.contains("\0") else { return nil }
        let path = URL(fileURLWithPath: parent, isDirectory: true).appendingPathComponent(name, isDirectory: true).standardizedFileURL.path
        return ProjectSetup(command: "repos.create", name: name, path: path, branch: "dev", arguments: ["path": .string(path)])
    }
    public static func initialize(repository: JSONValue, status: JSONValue, localHostID: String) -> ProjectSetup? {
        let repo = repository.object, observed = status.object, config = repo["config"]?.object ?? [:]
        guard !localHostID.isEmpty, repo["canonicalHostId"]?.text == localHostID,
              let repositoryID = repo["id"]?.text, UUID(uuidString: repositoryID) != nil,
              observed["repositoryId"]?.text == repositoryID, config["repositoryId"]?.text == repositoryID,
              let checkout = observed["checkout"]?.object, checkout["tip"] == .null,
              let branch = config["integration"]?.object["branch"]?.text, !branch.isEmpty, checkout["branch"]?.text == branch,
              let path = repo["path"]?.text, path.hasPrefix("/"), let revision = repo["revision"]?.text, !revision.isEmpty else { return nil }
        return ProjectSetup(command: "repos.initialize", name: config["name"]?.text ?? "Project", path: path, branch: branch,
                            arguments: ["repo": .string(repositoryID), "expectedRevision": .string(revision)])
    }
}
