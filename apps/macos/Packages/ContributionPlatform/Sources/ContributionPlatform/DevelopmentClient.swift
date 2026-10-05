import Foundation

public protocol ContributionClient: Sendable {
    func version() throws -> ResponseEnvelope
    func availability() throws -> ResponseEnvelope
}

/// S0 has no IPC connection, registration, persistence or operation dispatch.
public struct DevelopmentClient: ContributionClient {
    public init() {}
    public func version() throws -> ResponseEnvelope {
        try ResponseEnvelope(fields: [
            "schemaVersion": .number(1), "requestStatus": .string("completed"),
            "operationId": .null, "operationState": .null, "error": .null,
            "result": .object([
                "version": .string(BuildIdentity.version), "build": .string(BuildIdentity.build),
                "channel": .string(BuildIdentity.channel), "schemaVersion": .number(1),
                "interfaceVersion": .string(BuildIdentity.version), "engineVersion": .string(BuildIdentity.version),
                "supportedSchemaVersions": .array([.number(1)]),
                "compatibility": .string("development_only"), "service": .string("not_installed")
            ])
        ])
    }
    public func availability() throws -> ResponseEnvelope {
        try ResponseEnvelope(fields: [
            "schemaVersion": .number(1), "requestStatus": .string("rejected"),
            "operationId": .null, "operationState": .null,
            "result": .object(["availability": .object([
                "installedService": .bool(false), "reason": .string("SERVICE_NOT_INSTALLED")
            ])]),
            "error": .object([
                "code": .string("SERVICE_NOT_INSTALLED"),
                "message": .string("The S0 development shell has no installed service. Product operations are unavailable."),
                "retryable": .bool(false), "nextActions": .array([.object([
                    "id": .string("help"), "label": .string("Show available development commands"),
                    "argv": .array([.string("contribution"), .string("help")])
                ])])
            ])
        ])
    }
}
