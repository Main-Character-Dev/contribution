import Foundation

public enum StorageCategory: String, CaseIterable, Identifiable, Sendable {
    case output, worktrees, bundles
    public var id: String { rawValue }
    public var title: String {
        switch self {
        case .output: "Build artifacts and gate output"
        case .worktrees: "Temporary source checkouts"
        case .bundles: "Completed Git transfer copies"
        }
    }
    public var previewArguments: [String: JSONValue] {
        var args: [String: JSONValue] = ["preview": .bool(true)]
        if self != .output { args[rawValue] = .bool(true) }
        return args
    }
}

/// The category and token belong to the completed preview, never the current
/// picker selection. A later selection cannot widen a reviewed deletion.
public struct StorageReview: Identifiable, Sendable {
    public let category: StorageCategory
    public let value: JSONValue
    public var id: String { value.object["scopeToken"]?.text ?? "" }
    public var candidates: [JSONValue] { value.object["candidates"]?.array ?? [] }
    public var protectedEntries: [JSONValue] { value.object["protected"]?.array ?? [] }
    public init?(category: StorageCategory, value: JSONValue) {
        guard UUID(uuidString: value.object["scopeToken"]?.text ?? "") != nil,
              case .array = value.object["candidates"], case .array = value.object["protected"],
              (value.object["worktrees"] == .bool(true)) == (category == .worktrees),
              (value.object["bundles"] == .bool(true)) == (category == .bundles),
              value.object["mutation"] == .string("none") else { return nil }
        self.category = category; self.value = value
    }
    public var cleanupArguments: [String: JSONValue]? {
        guard !candidates.isEmpty else { return nil }
        var args: [String: JSONValue] = ["scopeToken": .string(id)]
        if category != .output { args[category.rawValue] = .bool(true) }
        return args
    }
    public static func retention(rawDays: String, capMiB: String, existing: JSONValue) -> JSONValue? {
        guard let days = Int(rawDays), days > 0, days <= 9_007_199_254_740_991,
              capMiB.range(of: "^[0-9]+(?:\\.[0-9]+)?$", options: .regularExpression) != nil,
              let mib = Decimal(string: capMiB, locale: Locale(identifier: "en_US_POSIX")), !mib.isNaN else { return nil }
        var bytes = mib * 1_048_576, whole = Decimal(); NSDecimalRound(&whole, &bytes, 0, .plain)
        guard bytes == whole, bytes >= 1, bytes <= 9_007_199_254_740_991 else { return nil }
        var values = existing.object
        guard case .number = values["summaryDays"] else { return nil }
        values["rawLogDays"] = .number(Decimal(days)); values["maxLogBytes"] = .number(bytes)
        return .object(values)
    }
    public static func managedPolicy(capGiB: String) -> JSONValue? {
        guard capGiB.range(of: "^[0-9]+(?:\\.[0-9]+)?$", options: .regularExpression) != nil,
              let gib = Decimal(string: capGiB, locale: Locale(identifier: "en_US_POSIX")), !gib.isNaN else { return nil }
        var bytes = gib * 1_073_741_824, whole = Decimal(); NSDecimalRound(&whole, &bytes, 0, .plain)
        guard bytes == whole, bytes >= 1_048_576, bytes <= 9_007_199_254_740_991 else { return nil }
        return .object(["schemaVersion": .number(1), "maxStateBytes": .number(bytes)])
    }
}
