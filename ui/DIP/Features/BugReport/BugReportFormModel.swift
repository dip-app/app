import DIPCore
import DIPDesignSystem
import Foundation
import Observation

/// State of one report sheet. The screenshot is held in memory only (and in the offline queue if the report is
/// queued). Everything the sheet shows about "what's included" comes from `diagnostics`, so the list and the
/// payload cannot drift apart.
@MainActor @Observable
final class BugReportFormModel {
    enum Phase: Equatable {
        case editing, sending, sent, queued
        case failed(BugReportSubmitError)
    }

    var draft = BugReportDraft()
    private(set) var phase: Phase = .editing
    /// Set when pasted or typed text was cut at 1,000 characters; cleared on the next edit.
    private(set) var trimmedNotice = false

    let session: BugReportSession
    let diagnostics: BugReportDiagnostics
    private let context: BugReportContext
    private let now: () -> Date

    init(
        session: BugReportSession, context: BugReportContext, diagnostics: BugReportDiagnostics,
        now: @escaping () -> Date = Date.init
    ) {
        self.session = session; self.context = context; self.diagnostics = diagnostics; self.now = now
        draft.includesScreenshot = session.screenshot != nil
    }

    var hasScreenshot: Bool { session.screenshot != nil }
    var isSending: Bool { phase == .sending }
    var isFinished: Bool { phase == .sent || phase == .queued }
    var failure: BugReportSubmitError? { if case .failed(let error) = phase { error } else { nil } }
    /// Closing asks first when there is something to lose.
    var needsDiscardConfirmation: Bool { draft.hasContent && !isFinished }

    func setText(_ new: String) {
        let limited = BugReportDraft.limited(new)
        draft.text = limited.text
        trimmedNotice = limited.truncated
    }

    func select(_ category: BugReportCategory) {
        draft.category = draft.category == category ? .unspecified : category
    }

    var barAction: DIPBottomBarAction {
        switch phase {
        case .editing:
            draft.canSend
                ? .init(title: "Send report", identifier: "report.send", icon: "system:paperplane", kind: .commit)
                : .init(title: "Send report", style: .complete, identifier: "report.send",
                        value: "Add a category or a description")
        case .sending:
            .init(title: "Sending…", identifier: "report.sending", showsProgress: true)
        case .sent:
            .init(title: "Thanks! Report sent", style: .accent, identifier: "report.sent", icon: "system:checkmark")
        case .queued:
            .init(title: "Saved. We’ll send it when you’re online", style: .accent, identifier: "report.queued",
                  icon: "system:clock")
        case .failed(.rateLimited):
            .init(title: "Close", identifier: "report.close")
        case .failed:
            .init(title: "Try again", identifier: "report.retry", kind: .commit)
        }
    }

    var failureMessage: String? {
        switch failure {
        case nil: nil
        case .rateLimited?: "You’ve sent a lot of reports today. Please try again later."
        case .rejected?: "We couldn’t accept this report. Check the text and try again."
        default: "Couldn’t send your report. Your text and screenshot are kept."
        }
    }

    /// Builds the payload from the draft. The screenshot is dropped when the toggle is off.
    func makeReport() -> BugReport {
        BugReport(
            uid: context.uid, category: draft.category, description: draft.trimmed, source: session.source,
            screen: session.screen, diagnostics: draft.includesDiagnostics ? diagnostics : nil,
            includesScreenshot: draft.includesScreenshot && hasScreenshot, createdAt: now())
    }

    /// Sends (or queues) the report. Returns the outcome so the sheet can play the haptic and schedule dismissal.
    @discardableResult
    func send() async -> BugReportOutcome? {
        guard draft.canSend, phase == .editing || failure != nil, failure != .rateLimited else { return nil }
        phase = .sending
        let report = makeReport()
        let outcome = await context.sender.send(report, screenshot: report.includesScreenshot ? session.screenshot : nil)
        switch outcome {
        case .sent: phase = .sent
        case .queued: phase = .queued
        case .failed(let error): phase = .failed(error)
        }
        return outcome
    }
}
