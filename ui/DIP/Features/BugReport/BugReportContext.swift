import DIPCore
import Foundation
import SwiftUI

/// What the report flow needs from the host: who is signed in and where reports go. Injected through the
/// environment by the member shell (Firebase adapter) or the preview app (mock). Absent = the flow is off.
struct BugReportContext: Sendable {
    let uid: String
    let sender: BugReportSender

    /// Queue files live in Caches, per app, and are discarded per uid on sign-out.
    static func make(uid: String, submitter: any BugReportSubmitting, queueDirectory: URL? = nil) -> BugReportContext {
        let directory = queueDirectory
            ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("BugReports", isDirectory: true)
        let outbox = BugReportOutbox(store: FileBugReportQueueStore(directory: directory))
        return BugReportContext(uid: uid, sender: BugReportSender(submitter: submitter, outbox: outbox))
    }
}

extension EnvironmentValues {
    @Entry var bugReporting: BugReportContext? = nil
    /// True while something covers the shell (the onboarding tour), so a shake does nothing.
    @Entry var bugReportSuppressed: Bool = false
    /// Opens the report sheet from a button (Profile's "Report a problem"). Nil when the flow is unavailable.
    @Entry var presentBugReport: (@MainActor (BugReportSource) -> Void)? = nil
}

/// What the sheet shows: the screen it was opened from and the screenshot taken before it appeared.
struct BugReportSession: Identifiable {
    let id = UUID()
    let source: BugReportSource
    let screen: BugReportScreen
    let screenshot: Data?
}

/// Debug and preview submitter behaviour, chosen by launch arguments so UI tests can drive every state.
enum BugReportPreviewBehavior {
    static func submitter(arguments: [String] = ProcessInfo.processInfo.arguments) -> MockBugReportSubmitter {
        let behavior: MockBugReportSubmitter.Behavior =
            arguments.contains("--bugreport-offline") ? .offline
            : arguments.contains("--bugreport-ratelimited") ? .rateLimited
            : arguments.contains("--bugreport-fail-once") ? .failOnce
            : arguments.contains("--bugreport-fail") ? .fail
            : .succeed
        return MockBugReportSubmitter(behavior: behavior)
    }
}
