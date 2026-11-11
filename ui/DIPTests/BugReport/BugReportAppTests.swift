import DIPCore
import DIPDesignSystem
import Foundation
import UIKit
import XCTest

@testable import DIP

/// The Firestore document must stay inside the allow-list in gcp/firestore.rules (bugReports), and the sheet's
/// model must send exactly what the member left switched on.
@MainActor
final class BugReportAppTests: XCTestCase {
    private let ruleKeys: Set<String> = [
        "uid", "category", "description", "source", "screen", "diagnostics", "screenshotPath", "screenshotBytes", "createdAt",
    ]
    private let diagnosticKeys: Set<String> = [
        "appVersion", "appBuild", "osVersion", "deviceModel", "locale", "screen", "installId",
    ]
    private let diagnostics = BugReportDiagnostics(
        appVersion: "2.0", appBuild: "412", osVersion: "iOS 18.1", deviceModel: "iPhone17,1", locale: "en_US",
        screen: .event, installId: UUID().uuidString.lowercased())

    private func report(screenshot: Bool = false, details: Bool = true) -> BugReport {
        BugReport(uid: "u1", category: .bug, description: "Join spins forever", source: .shake, screen: .event,
                  diagnostics: details ? diagnostics : nil, includesScreenshot: screenshot)
    }

    func testDocumentUsesOnlyRuleAllowedFields() {
        let data = BugReportDocument.data(for: report(screenshot: true), screenshotBytes: 90_000)
        XCTAssertTrue(Set(data.keys).isSubset(of: ruleKeys))
        let nested = data["diagnostics"] as? [String: Any]
        XCTAssertEqual(Set(nested?.keys ?? [:].keys), diagnosticKeys)
        XCTAssertEqual(data["uid"] as? String, "u1")
        XCTAssertEqual(data["screenshotBytes"] as? Int, 90_000)
        XCTAssertTrue((data["screenshotPath"] as? String)?.hasPrefix("bugReports/u1/") == true)
        for forbidden in ["email", "name", "displayName", "token", "companyId"] { XCTAssertNil(data[forbidden]) }
    }

    func testOptionalBlocksAreOmittedWhenSwitchedOff() {
        let data = BugReportDocument.data(for: report(screenshot: false, details: false), screenshotBytes: nil)
        XCTAssertNil(data["diagnostics"])
        XCTAssertNil(data["screenshotPath"])
        XCTAssertNil(data["screenshotBytes"])
    }

    func testErrorsMapToTheOutcomesTheUIDistinguishes() {
        func code(_ domain: String, _ code: Int) -> BugReportSubmitError {
            BugReportDocument.submitError(NSError(domain: domain, code: code))
        }
        XCTAssertEqual(code(NSURLErrorDomain, NSURLErrorNotConnectedToInternet), .offline)
        XCTAssertEqual(code("FIRFirestoreErrorDomain", 14), .offline)
        XCTAssertEqual(code("FIRFirestoreErrorDomain", 8), .rateLimited)
        XCTAssertEqual(code("FIRFirestoreErrorDomain", 7), .rejected)
        XCTAssertEqual(code("FIRFirestoreErrorDomain", 13), .failed)
        XCTAssertEqual(code("SomethingElse", 1), .failed)
    }

    // MARK: Model

    private func model(
        _ behavior: MockBugReportSubmitter.Behavior, screenshot: Data? = Data([1, 2, 3])
    ) -> (BugReportFormModel, MockBugReportSubmitter, BugReportContext) {
        let submitter = MockBugReportSubmitter(behavior: behavior, delay: .zero)
        let context = BugReportContext(
            uid: "u1", sender: BugReportSender(submitter: submitter, outbox: BugReportOutbox(store: InMemoryBugReportQueueStore())))
        let session = BugReportSession(source: .shake, screen: .event, screenshot: screenshot)
        return (BugReportFormModel(session: session, context: context, diagnostics: diagnostics), submitter, context)
    }

    func testSendFlowAndBarStates() async {
        let (m, submitter, _) = model(.succeed)
        XCTAssertEqual(m.barAction.style, .complete, "disabled until a category or ten characters")
        m.select(.bug)
        XCTAssertEqual(m.barAction.title, "Send report")
        XCTAssertEqual(m.barAction.style, .standard)
        let outcome = await m.send()
        XCTAssertEqual(outcome, .sent)
        XCTAssertEqual(m.barAction.title, "Thanks! Report sent")
        let sent = await submitter.submitted
        XCTAssertEqual(sent.first?.uid, "u1")
        let shots = await submitter.screenshots
        XCTAssertEqual(shots[sent[0].reportId], Data([1, 2, 3]))
    }

    func testAnnotatedScreenshotIsSentInsteadOfTheOriginalAndClearingRestoresIt() async {
        let (m, submitter, _) = model(.succeed)
        m.select(.bug)
        var markup = ScreenshotMarkup()
        markup.begin(at: MarkupPoint(x: 0.2, y: 0.2)); markup.extend(to: MarkupPoint(x: 0.6, y: 0.6)); markup.end()
        m.applyMarkup(markup, rendered: Data([9, 9]))
        XCTAssertEqual(m.screenshotToSend, Data([9, 9]))
        XCTAssertTrue(m.needsDiscardConfirmation, "drawn markup is worth confirming before discarding")
        m.applyMarkup(ScreenshotMarkup(), rendered: nil)
        XCTAssertEqual(m.screenshotToSend, Data([1, 2, 3]), "clearing the markup falls back to the original")
        m.applyMarkup(markup, rendered: Data([9, 9]))
        _ = await m.send()
        let sent = await submitter.submitted
        let shots = await submitter.screenshots
        XCTAssertEqual(shots[sent[0].reportId], Data([9, 9]))
    }

    func testFailedRenderKeepsTheOriginalScreenshot() {
        let (m, _, _) = model(.succeed)
        var markup = ScreenshotMarkup(); markup.begin(at: MarkupPoint(x: 0.5, y: 0.5)); markup.end()
        m.applyMarkup(markup, rendered: nil)
        XCTAssertEqual(m.screenshotToSend, Data([1, 2, 3]))
        XCTAssertTrue(m.markup.isEmpty)
    }

    func testMarkupRendererBurnsStrokesIntoASmallJPEG() throws {
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 200, height: 400))
        let base = try XCTUnwrap(renderer.image { context in
            UIColor.white.setFill(); context.fill(CGRect(x: 0, y: 0, width: 200, height: 400))
        }.jpegData(compressionQuality: 0.8))
        XCTAssertNil(ScreenshotMarkupRenderer.render(base: base, markup: ScreenshotMarkup()), "nothing drawn, nothing rendered")
        var markup = ScreenshotMarkup()
        markup.begin(at: MarkupPoint(x: 0.1, y: 0.5)); markup.extend(to: MarkupPoint(x: 0.9, y: 0.5)); markup.end()
        let rendered = try XCTUnwrap(ScreenshotMarkupRenderer.render(base: base, markup: markup))
        XCTAssertLessThanOrEqual(rendered.count, ScreenshotMarkupRenderer.maximumBytes)
        XCTAssertNotEqual(rendered, base)
        XCTAssertNotNil(UIImage(data: rendered))
    }

    func testOfflineIsQueuedWithItsScreenshot() async {
        let (m, _, context) = model(.offline)
        m.setText("The list never loads on the train")
        let outcome = await m.send()
        XCTAssertEqual(outcome, .queued)
        XCTAssertEqual(m.phase, .queued)
        let queued = await context.sender.outbox.pending(uid: "u1")
        XCTAssertEqual(queued.count, 1)
        XCTAssertTrue(queued[0].hasScreenshot)
    }

    func testFailureKeepsTheDraftAndRetries() async {
        let (m, _, _) = model(.failOnce)
        m.select(.confusing)
        m.setText("I could not find the leave button")
        _ = await m.send()
        XCTAssertEqual(m.failure, .failed)
        XCTAssertEqual(m.barAction.title, "Try again")
        XCTAssertEqual(m.draft.category, .confusing)
        XCTAssertEqual(m.failureMessage, "Couldn’t send your report. Your text and screenshot are kept.")
        let outcome = await m.send()
        XCTAssertEqual(outcome, .sent)
    }

    func testRateLimitedOffersCloseAndDoesNotResend() async {
        let (m, submitter, _) = model(.rateLimited)
        m.select(.bug)
        _ = await m.send()
        XCTAssertEqual(m.barAction.title, "Close")
        let again = await m.send()
        XCTAssertNil(again)
        let attempts = await submitter.attempts
        XCTAssertEqual(attempts, 1)
    }

    func testSwitchesDecideWhatIsSent() {
        let (m, _, _) = model(.succeed)
        m.select(.idea)
        m.draft.includesDiagnostics = false
        m.draft.includesScreenshot = false
        let report = m.makeReport()
        XCTAssertNil(report.diagnostics)
        XCTAssertFalse(report.includesScreenshot)
        XCTAssertNil(report.screenshotPath)
        m.draft.includesScreenshot = true
        XCTAssertNotNil(m.makeReport().screenshotPath)
    }

    func testNoScreenshotDisablesTheToggleDefault() {
        let (m, _, _) = model(.succeed, screenshot: nil)
        XCTAssertFalse(m.hasScreenshot)
        XCTAssertFalse(m.draft.includesScreenshot)
        m.select(.bug)
        XCTAssertFalse(m.makeReport().includesScreenshot)
    }

    func testTextIsLimitedAndTrimmedForTheReport() {
        let (m, _, _) = model(.succeed)
        m.setText(String(repeating: "a", count: 1_200))
        XCTAssertEqual(m.draft.characterCount, 1_000)
        XCTAssertTrue(m.trimmedNotice)
        m.setText("  spaced out  ")
        XCTAssertEqual(m.makeReport().description, "spaced out")
        XCTAssertTrue(m.needsDiscardConfirmation)
    }

    func testSelectingTheSameChipTwiceClearsIt() {
        let (m, _, _) = model(.succeed)
        m.select(.bug); m.select(.bug)
        XCTAssertEqual(m.draft.category, .unspecified)
    }
}
