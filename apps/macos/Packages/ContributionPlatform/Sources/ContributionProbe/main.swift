import Foundation
import ContributionPlatform

@main struct ContributionProbe {
    static func main() async {
        do {
            guard CommandLine.arguments.count == 4 else { throw CocoaError(.fileReadInvalidFileName) }
            let directory = URL(fileURLWithPath: CommandLine.arguments[1])
            let args = try JSONDecoder().decode([String: JSONValue].self, from: Data(CommandLine.arguments[3].utf8))
            let response = try await ServiceClient(directory: directory).request(CommandLine.arguments[2], args: args)
            var bytes = try JSONEncoder().encode(response); bytes.append(10); FileHandle.standardOutput.write(bytes)
        } catch {
            FileHandle.standardError.write(Data("Native service probe failed: \(error.localizedDescription)\n".utf8)); exit(3)
        }
    }
}
