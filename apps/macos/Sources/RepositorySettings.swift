import SwiftUI
import ContributionPlatform

struct RepositorySettingsSheet: View {
    @Bindable var workspace: Workspace
    @Environment(\.dismiss) private var dismiss
    @State private var draft: RepositorySettingsDraft
    @State private var review: RepositorySettingsChange?
    init(workspace: Workspace, draft: RepositorySettingsDraft) { self.workspace = workspace; _draft = State(initialValue: draft) }
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Project settings").font(.title2.bold())
            Form {
                TextField("Project name", text: $draft.name)
                Section("Publication") {
                    TextField("Git remote", text: $draft.remote, prompt: Text("For example, origin"))
                    TextField("Publication branch", text: $draft.branch)
                    TextField("Pull request base", text: $draft.pullRequestBase)
                    Text("Select an existing Git remote and branch together, or clear both. Saving settings does not create a remote or publish commits.").font(.caption).foregroundStyle(.secondary)
                }
                Section("Validation") {
                    if draft.allowsProfileChange {
                        Picker("Profile", selection: $draft.profile) { Text("Local development").tag("local-development"); Text("Standard").tag("standard") }
                        Text("The profile selects the project's configured checks. Gate activation stays unchanged.").font(.caption).foregroundStyle(.secondary)
                    } else { Text("Validation follows this project's preserved workflow.").foregroundStyle(.secondary) }
                    LabeledContent("Gate", value: draft.original.object["validation"]?.object["gate"]?.text == "inactive" ? "Inactive" : "Enabled")
                }
            }.formStyle(.grouped)
            Text("Review the changes before saving. A tracked project configuration is updated in its checkout and remains available for your normal commit workflow.").font(.caption).foregroundStyle(.secondary)
            HStack {
                Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
                Spacer()
                Button("Review changes") { review = draft.review() }.keyboardShortcut(.defaultAction).disabled(draft.review() == nil || workspace.sending || workspace.pendingRequest != nil)
            }
        }.padding(24).frame(width: 550, height: 490)
            .sheet(item: $review) { change in RepositorySettingsReview(workspace: workspace, change: change) { dismiss() } }
    }
}
private struct RepositorySettingsReview: View {
    @Bindable var workspace: Workspace
    let change: RepositorySettingsChange
    var onAccepted: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var saving = false
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Save these project settings?").font(.title2.bold())
            ForEach(change.differences) { difference in
                VStack(alignment: .leading, spacing: 3) {
                    Text(difference.label).font(.headline)
                    Text("\(difference.before) → \(difference.after)").textSelection(.enabled)
                }
            }
            Text("The service will reject this review if the configuration has changed since you opened it.").font(.caption).foregroundStyle(.secondary)
            if let error = workspace.error { Text(error).foregroundStyle(.orange).textSelection(.enabled) }
            HStack {
                Button("Back") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Spacer()
                Button("Save settings") {
                    saving = true
                    Task {
                        let response = await workspace.submit("repos.configure", args: change.arguments); saving = false
                        if response?.fields["error"] == .null || workspace.pendingRequest != nil { dismiss(); onAccepted() }
                    }
                }.keyboardShortcut(.defaultAction).disabled(saving || workspace.sending || workspace.pendingRequest != nil)
            }
        }.padding(24).frame(width: 520).interactiveDismissDisabled(saving)
    }
}
