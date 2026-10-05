import Foundation

public enum MigrationAction: String, CaseIterable, Identifiable, Sendable {
    case apply, activate, rollback
    public var id: String { rawValue }
    public var label: String {
        switch self { case .apply: "Apply reviewed files"; case .activate: "Activate committed migration"; case .rollback: "Restore reviewed files" }
    }
    public var explanation: String {
        switch self {
        case .apply: "Only the reviewed project files will change. Commit them through the project's normal workflow before activation."
        case .activate: "The service will verify the exact committed migration and current project policy before activating local registration."
        case .rollback: "Only unchanged migration-owned files can be restored. Concurrent edits, history and receipts are preserved. Commit the resulting changes through the project's normal workflow."
        }
    }
}

public struct MigrationReview: Identifiable, Equatable, Sendable {
    public let fields: JSONValue
    public let id: String
    public let repositoryID: String
    public let phase: String
    public let files: [String]
    public let registrationOnly: Bool
    public init?(_ value: JSONValue, repositoryID: String) {
        let fields = value.object
        guard case .string(let id) = fields["proposalId"], UUID(uuidString: id) != nil,
              fields["repositoryId"] == .string(repositoryID),
              case .string(let phase) = fields["phase"], ["prepared", "applying", "applied", "active", "rolling_back", "rolled_back"].contains(phase),
              case .string(let revision) = fields["expectedRevision"], !revision.isEmpty,
              case .bool(let registrationOnly) = fields["registrationOnly"],
              case .array(let entries) = fields["files"], !entries.isEmpty,
              entries.allSatisfy({ if case .string(let path) = $0.object["path"] { return !path.isEmpty }; return false }) else { return nil }
        self.fields = value; self.id = id; self.repositoryID = repositoryID; self.phase = phase
        self.registrationOnly = registrationOnly; self.files = entries.map { $0.object["path"]!.text }
    }
    public var actions: [MigrationAction] {
        if registrationOnly { return phase == "prepared" ? [.activate] : [] }
        switch phase { case "prepared": return [.apply]; case "applied": return [.activate, .rollback]; case "active": return [.rollback]; default: return [] }
    }
    public var status: String {
        switch phase {
        case "prepared": registrationOnly ? "Ready to review local registration" : "Ready to review project changes"
        case "applying", "rolling_back": "Interrupted step — resume its retained request"
        case "applied": "Files applied — commit before activation"
        case "active": "Local registration active"
        default: "Files restored — commit through the project workflow"
        }
    }
    public func arguments(for action: MigrationAction, repository: JSONValue) -> [String: JSONValue]? {
        guard actions.contains(action), repository.object["id"] == .string(repositoryID),
              case .string(let revision) = repository.object["revision"], !revision.isEmpty,
              action == .rollback || repository.object["revision"] == fields.object["expectedRevision"] else { return nil }
        return ["repo": .string(repositoryID), "expectedRevision": .string(revision), action.rawValue + "Adoption": .string(id)]
    }
    public static func existingHistoryArguments(repositoryID: String, original: String, migration: String) -> [String: JSONValue]? {
        let values = [original, migration].map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
        guard UUID(uuidString: repositoryID) != nil, values.allSatisfy({ value in
            [40, 64].contains(value.count) && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
        }), values[0] != values[1] else { return nil }
        return ["repo": .string(repositoryID), "prepareExistingAdoption": .bool(true), "originalTip": .string(values[0]), "migrationTip": .string(values[1])]
    }
}
