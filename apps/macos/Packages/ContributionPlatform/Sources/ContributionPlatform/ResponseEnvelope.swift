import Foundation

/// Additive payloads and explicit nulls survive decoding and re-encoding.
public enum JSONValue: Codable, Equatable, Sendable {
    case null, bool(Bool), number(Decimal), string(String)
    case array([JSONValue]), object([String: JSONValue])

    public init(from decoder: any Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode([JSONValue].self) { self = .array(v) }
        else if let v = try? c.decode([String: JSONValue].self) { self = .object(v) }
        else { self = .number(try c.decode(Decimal.self)) }
    }
    public func encode(to encoder: any Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let v): try c.encode(v)
        case .number(let v): try c.encode(v)
        case .string(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .object(let v): try c.encode(v)
        }
    }
}

/// Narrow checked envelope projection, not a generic schema validator.
/// The engine validates full canonical schemas and all nested product payloads.
public struct ResponseEnvelope: Codable, Equatable, Sendable {
    public let fields: [String: JSONValue]
    public let requestStatus: RequestStatus
    public let operationID: String?
    public let operationState: OperationState?

    public init(fields: [String: JSONValue]) throws {
        func invalid(_ field: String) -> NSError {
            NSError(domain: "Contribution.Contract", code: 1,
                    userInfo: [NSLocalizedDescriptionKey: "Invalid response field: \(field)"])
        }
        guard fields["schemaVersion"] == .number(1),
              case .string(let status) = fields["requestStatus"],
              let requestStatus = RequestStatus(rawValue: status) else { throw invalid("version/status") }
        let operationID: String?
        switch fields["operationId"] {
        case .null: operationID = nil
        case .string(let id) where !id.isEmpty: operationID = id
        default: throw invalid("operationId")
        }
        let operationState: OperationState?
        switch fields["operationState"] {
        case .null: operationState = nil
        case .string(let state):
            guard let parsed = OperationState(rawValue: state) else { throw invalid("operationState") }
            operationState = parsed
        default: throw invalid("operationState")
        }
        switch fields["result"] {
        case .null, .object: break
        default: throw invalid("result")
        }
        switch fields["error"] {
        case .null: break
        case .object(let error):
            for key in ["code", "message"] {
                guard case .string(let value) = error[key], !value.isEmpty else { throw invalid("error.\(key)") }
            }
            guard case .bool = error["retryable"], case .array(let actions) = error["nextActions"] else {
                throw invalid("error")
            }
            for action in actions {
                guard case .object(let a) = action else { throw invalid("nextActions") }
                for key in ["id", "label"] {
                    guard case .string(let value) = a[key], !value.isEmpty else { throw invalid("action.\(key)") }
                }
                guard case .array(let argv) = a["argv"], !argv.isEmpty else { throw invalid("argv") }
                for arg in argv {
                    guard case .string = arg else { throw invalid("argv item") }
                }
            }
        default: throw invalid("error")
        }
        if operationID == nil && operationState != nil { throw invalid("null operation relationship") }
        if requestStatus == .accepted && (operationID == nil || operationState == nil || fields["error"] != .null) {
            throw invalid("accepted conditional")
        }
        if requestStatus == .rejected {
            guard case .object = fields["error"] else { throw invalid("rejected conditional") }
        }
        self.fields = fields
        self.requestStatus = requestStatus
        self.operationID = operationID
        self.operationState = operationState
    }
    public init(from decoder: any Decoder) throws {
        let c = try decoder.singleValueContainer()
        try self.init(fields: c.decode([String: JSONValue].self))
    }
    public func encode(to encoder: any Encoder) throws {
        var c = encoder.singleValueContainer()
        try c.encode(fields)
    }
}
