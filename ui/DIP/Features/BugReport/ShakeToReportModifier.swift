import DIPCore
import DIPDesignSystem
import SwiftUI

/// Wraps the member shell: a shake (or Profile's button) captures the screen first, then opens the report sheet.
/// The gate (setting, debounce, 10 s after close, other modals, app state, onboarding tour) is `ShakeGate`.
private struct ShakeToReportModifier: ViewModifier {
    let screen: BugReportScreen
    @Environment(\.bugReporting) private var context
    @Environment(\.bugReportSuppressed) private var suppressed
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @AppStorage(ShakeGate.enabledKey) private var shakeEnabled = true
    @State private var session: BugReportSession?
    @State private var gate = ShakeGate()

    func body(content: Content) -> some View {
        content
            .environment(\.presentBugReport, presenter)
            .onReceive(NotificationCenter.default.publisher(for: .dipDeviceDidShake)) { _ in shaken() }
            .sheet(item: $session, onDismiss: { gate.sheetClosed(at: Date()) }) { session in
                if let context {
                    BugReportSheet(model: BugReportFormModel(
                        session: session, context: context, diagnostics: ReportCapture.diagnostics(screen: session.screen)))
                    .environment(\.dynamicTypeSize, dynamicTypeSize)
                }
            }
            #if DEBUG
            // UI tests and design review open the sheet directly (the simulator shake is also supported).
            .task {
                guard ProcessInfo.processInfo.arguments.contains("--open-bug-report") else { return }
                try? await Task.sleep(for: .seconds(1))
                open(.shake)
            }
            #endif
            // Queued reports go out the next time the app is active (the outbox keeps the 2/8/30 s backoff).
            .task(id: scenePhase) {
                guard scenePhase == .active, let context, BugReportAvailability.isAvailable else { return }
                await context.sender.flushQueue(uid: context.uid)
            }
    }

    /// Nil hides Profile's entry when the flow is unavailable (App Store builds, or no submitter).
    private var presenter: (@MainActor (BugReportSource) -> Void)? {
        guard BugReportAvailability.isAvailable, context != nil else { return nil }
        return { source in open(source) }
    }

    private func shaken() {
        guard BugReportAvailability.isAvailable, context != nil else { return }
        let accepted = gate.accept(at: Date(), .init(
            isEnabled: shakeEnabled, isSheetPresented: session != nil, isAppActive: scenePhase == .active,
            isOtherModalUp: ReportCapture.isAnotherModalUp(), isSuppressedByHost: suppressed))
        guard accepted else { return }
        DIPHaptics.shake()
        open(.shake)
    }

    /// Capture first, before anything is drawn on top, then present.
    private func open(_ source: BugReportSource) {
        guard session == nil else { return }
        session = BugReportSession(source: source, screen: screen, screenshot: ReportCapture.capture())
    }
}

extension View {
    /// Shake to report / Report a problem for this shell. `screen` is the route kind the member is on.
    func shakeToReport(screen: BugReportScreen) -> some View {
        modifier(ShakeToReportModifier(screen: screen))
    }
}
