import AppKit
import SwiftUI
import ContributionPlatform

struct NewProjectSheet: View {
    @Bindable var workspace: Workspace
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var parent = ""
    @State private var review: ProjectSetup?
    private var selection: ProjectSetup? { ProjectSetup.newProject(name: name, parent: parent) }
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("New project").font(.title2.bold())
            TextField("Project name", text: $name).textFieldStyle(.roundedBorder).accessibilityIdentifier("contribution.newProjectName")
            HStack {
                Text(parent.isEmpty ? "Choose a parent folder" : parent).textSelection(.enabled).lineLimit(2)
                Spacer()
                Button("Choose folder…") {
                    let panel = NSOpenPanel(); panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.allowsMultipleSelection = false
                    panel.title = "Choose the parent folder"
                    if panel.runModal() == .OK { parent = panel.url?.path ?? "" }
                }
            }
            Text("Contribution will create a local Git repository with Local development policy. Review the destination and initial commit before creating it.").foregroundStyle(.secondary)
            HStack {
                Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
                Spacer()
                Button("Review creation") { review = selection }.keyboardShortcut(.defaultAction).disabled(selection == nil || workspace.sending || workspace.pendingRequest != nil)
            }
        }.padding(24).frame(width: 490)
        .sheet(item: $review) { selected in
            ProjectSetupReview(workspace: workspace, selection: selected) { dismiss() }
        }
    }
}

struct ProjectSetupReview: View {
    @Bindable var workspace: Workspace
    let selection: ProjectSetup
    var onAccepted: () -> Void = {}
    @Environment(\.dismiss) private var dismiss
    @State private var submitting = false
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(selection.command == "repos.create" ? "Create \(selection.name)?" : "Initialize \(selection.name)?").font(.title2.bold())
            Text(selection.path).font(.callout.monospaced()).textSelection(.enabled)
            Text("Create the first commit on \(selection.branch) using your configured Git identity. The commit contains contribution.json and CONTRIBUTION.md with workflow guidance.")
            Text("Existing application files and unrelated staged work remain untouched. GitHub setup and publication are separate actions.").foregroundStyle(.secondary)
            if let error = workspace.error { Text(error).foregroundStyle(.orange).textSelection(.enabled) }
            HStack {
                Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction).disabled(submitting)
                Spacer()
                Button(selection.command == "repos.create" ? "Create project" : "Initialize history") {
                    submitting = true
                    Task {
                        let response = await workspace.submit(selection.command, args: selection.arguments)
                        submitting = false
                        if let response, response.fields["error"] == .null {
                            if let repository = workspace.repositories.first(where: { $0.object["path"]?.text == selection.path }) { workspace.selectedRepository = repository.object["id"]?.text }
                            dismiss(); onAccepted()
                        } else if workspace.pendingRequest != nil { dismiss(); onAccepted() }
                    }
                }.keyboardShortcut(.defaultAction).disabled(submitting || workspace.sending || workspace.pendingRequest != nil)
            }
        }.padding(24).frame(width: 510).interactiveDismissDisabled(submitting)
    }
}
