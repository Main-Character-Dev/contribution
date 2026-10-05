import AppKit
import SwiftUI

/// A selectable native log with explicit follow control. User-initiated live
/// scroll notifications include trackpads, scroller dragging and legacy mice.
@MainActor public struct RetainedLogView: NSViewRepresentable {
    public let text: String
    @Binding public var following: Bool
    public init(text: String, following: Binding<Bool>) { self.text = text; self._following = following }
    public func makeCoordinator() -> Controller { Controller() }
    public func makeNSView(context: Context) -> NSScrollView { context.coordinator.scrollView }
    public func updateNSView(_ view: NSScrollView, context: Context) {
        context.coordinator.pause = { following = false }
        context.coordinator.update(text: text, following: following)
    }
    @MainActor public final class Controller: NSObject {
        let scrollView = NSScrollView(), textView = NSTextView()
        var pause: () -> Void = {}
        private var wasFollowing = false
        private var rendered = false
        override init() {
            super.init()
            scrollView.hasVerticalScroller = true; scrollView.hasHorizontalScroller = true; scrollView.autohidesScrollers = true
            scrollView.borderType = .bezelBorder; scrollView.documentView = textView
            textView.isEditable = false; textView.isSelectable = true; textView.isRichText = false
            textView.font = .monospacedSystemFont(ofSize: NSFont.systemFontSize, weight: .regular)
            textView.textContainerInset = NSSize(width: 10, height: 10)
            textView.isVerticallyResizable = true; textView.isHorizontallyResizable = true
            textView.minSize = .zero; textView.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
            textView.textContainer?.widthTracksTextView = false
            textView.textContainer?.containerSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
            textView.setAccessibilityLabel("Retained operation log")
            textView.setAccessibilityIdentifier("contribution.log")
            for name in [NSScrollView.willStartLiveScrollNotification, NSScrollView.didLiveScrollNotification] {
                NotificationCenter.default.addObserver(self, selector: #selector(userScrolled), name: name, object: scrollView)
            }
        }
        @objc private func userScrolled(_ notification: Notification) { wasFollowing = false; pause() }
        func update(text: String, following: Bool) {
            // Freeze the visible snapshot while reading earlier output. A
            // rolling bounded tail must not replace lines beneath selection.
            if !following && rendered { wasFollowing = false; return }
            let changed = textView.string != text
            if changed {
                let origin = scrollView.contentView.bounds.origin, selection = textView.selectedRange()
                textView.string = text
                let length = textView.string.utf16.count
                textView.setSelectedRange(NSRange(location: min(selection.location, length), length: min(selection.length, max(0, length - min(selection.location, length)))))
                textView.layoutManager?.ensureLayout(for: textView.textContainer!)
                if !following { scrollView.contentView.scroll(to: origin); scrollView.reflectScrolledClipView(scrollView.contentView) }
            }
            if following && (changed || !wasFollowing) { textView.scrollRangeToVisible(NSRange(location: textView.string.utf16.count, length: 0)) }
            wasFollowing = following; rendered = true
        }
    }
}
