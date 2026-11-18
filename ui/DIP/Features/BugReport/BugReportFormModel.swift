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

    /// The screenshot with the member's markup, when they drew on it; otherwise nil (the original is sent).
    private(set) var annotatedScreenshot: Data?
    private(set) var markup = ScreenshotMarkup()

    var hasScreenshot: Bool { session.screenshot != nil }
    /// What the sheet previews and what is sent: the annotated copy when there is one.
    var screenshotToSend: Data? { annotatedScreenshot ?? session.screenshot }

    /// Keeps the editor's strokes and the JPEG rendered from them. An empty markup (or a failed render) restores the original.
    func applyMarkup(_ markup: ScreenshotMarkup, rendered: Data?) {
        if markup.isEmpty || rendered == nil { self.markup = ScreenshotMarkup(); annotatedScreenshot = nil }
        else { self.markup = markup; annotatedScreenshot = rendered }
    }
    var isSending: Bool { phase == .sending }
    var isFinished: Bool { phase == .sent || phase == .queued }
    var failure: BugReportSubmitError? { if case .failed(let error) = phase { error } else { nil } }
    /// Closing asks first when there is something to lose.
    var needsDiscardConfirmation: Bool { (draft.hasContent || annotatedScreenshot != nil) && !isFinished }

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
                ? .init(title: String(localized: "bugreport.bar.send", defaultValue: "Send report", comment: "Report a problem sheet: bottom bar send button"), identifier: "report.send", icon: "system:paperplane", kind: .commit)
                : .init(title: String(localized: "bugreport.bar.send", defaultValue: "Send report", comment: "Report a problem sheet: bottom bar send button"), style: .complete, identifier: "report.send",
                        value: String(localized: "bugreport.bar.needsInput", defaultValue: "Add a category or a description", comment: "Report a problem sheet: hint on the disabled send button"))
        case .sending:
            .init(title: String(localized: "bugreport.bar.sending", defaultValue: "Sending…", comment: "Report a problem sheet: bottom bar while sending"), identifier: "report.sending", showsProgress: true)
        case .sent:
            .init(title: String(localized: "bugreport.bar.sent", defaultValue: "Thanks! Report sent", comment: "Report a problem sheet: bottom bar after the report was sent"), style: .accent, identifier: "report.sent", icon: "system:checkmark")
        case .queued:
            .init(title: String(localized: "bugreport.bar.queued", defaultValue: "Saved. We’ll send it when you’re online", comment: "Report a problem sheet: bottom bar when the report was queued offline"), style: .accent, identifier: "report.queued",
                  icon: "system:clock")
        case .failed(.rateLimited):
            .init(title: String(localized: "bugreport.bar.close", defaultValue: "Close", comment: "Report a problem sheet: bottom bar close button after rate limiting"), identifier: "report.close")
        case .failed:
            .init(title: String(localized: "bugreport.bar.retry", defaultValue: "Try again", comment: "Report a problem sheet: bottom bar retry after a failed send"), identifier: "report.retry", kind: .commit)
        }
    }

    var failureMessage: String? {
        switch failure {
        case nil: nil
        case .rateLimited?: String(localized: "bugreport.error.rateLimited", defaultValue: "You’ve sent a lot of reports today. Please try again later.", comment: "Report a problem sheet: error when the daily report limit is reached")
        case .rejected?: String(localized: "bugreport.error.rejected", defaultValue: "We couldn’t accept this report. Check the text and try again.", comment: "Report a problem sheet: error when the server rejected the report")
        default: String(localized: "bugreport.error.generic", defaultValue: "Couldn’t send your report. Your text and screenshot are kept.", comment: "Report a problem sheet: generic send error")
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
        let outcome = await context.sender.send(report, screenshot: report.includesScreenshot ? screenshotToSend : nil)
        switch outcome {
        case .sent: phase = .sent
        case .queued: phase = .queued
        case .failed(let error): phase = .failed(error)
        }
        return outcome
    }
}
