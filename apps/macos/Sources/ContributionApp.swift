import AppKit
import SwiftUI
import ContributionPlatform

@main
struct ContributionApp: App {
    var body: some Scene {
        Window("Contribution", id: "main") {
            FoundationView()
        }
        .defaultSize(width: 520, height: 320)
        MenuBarExtra("Contribution", systemImage: "arrow.triangle.branch") {
            ContributionMenu()
        }
    }
}

private struct FoundationView: View {
    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "arrow.triangle.branch")
                .font(.system(size: 36)).foregroundStyle(.secondary)
            Text("Contribution").font(.title)
            Text("Service not installed").font(.headline)
            Text("This development shell is ready for implementation. Repository and device operations are unavailable.")
                .foregroundStyle(.secondary).multilineTextAlignment(.center)
            Text("\(BuildIdentity.version) · Development").font(.caption).foregroundStyle(.secondary)
        }
        .padding(32)
        .frame(minWidth: 420, minHeight: 260)
        .accessibilityIdentifier("contribution.foundation")
    }
}

private struct ContributionMenu: View {
    @Environment(\.openWindow) private var openWindow
    var body: some View {
        Text("Service not installed")
        Text("\(BuildIdentity.version) · Development")
        Divider()
        Button("Open Contribution") { openWindow(id: "main"); NSApplication.shared.activate(ignoringOtherApps: true) }
        Button("Quit Contribution") { NSApplication.shared.terminate(nil) }.keyboardShortcut("q")
    }
}
