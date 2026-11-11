import XCTest

@testable import DIPCore

final class BugReportDraftTests: XCTestCase {
    func testSendNeedsCategoryOrTenCharacters() {
        var draft = BugReportDraft()
        XCTAssertFalse(draft.canSend)
        draft.text = "too short"
        XCTAssertFalse(draft.canSend)
        draft.text = "   ten chars   "  // trimmed length is 9 ("ten chars")
        XCTAssertFalse(draft.canSend)
        draft.text = "this is long enough"
        XCTAssertTrue(draft.canSend)
        draft.text = ""
        draft.category = .bug
        XCTAssertTrue(draft.canSend)
    }

    func testLimitCountsGraphemesAndUTF16Units() {
        let plain = BugReportDraft.limited(String(repeating: "a", count: 1_001))
        XCTAssertTrue(plain.truncated)
        XCTAssertEqual(plain.text.count, 1_000)
        // A family emoji is one grapheme but eight UTF-16 units; the rules count units, so 125 fit.
        let family = BugReportDraft.limited(String(repeating: "👨‍👩‍👧", count: 600))
        XCTAssertTrue(family.truncated)
        XCTAssertLessThanOrEqual(family.text.utf16.count, 1_000)
        XCTAssertEqual(family.text.count, 125)
        XCTAssertEqual(BugReportDraft.limited(String(repeating: "😀", count: 600)).text.count, 500)
        XCTAssertEqual(BugReportDraft.limited("short").text, "short")
        XCTAssertFalse(BugReportDraft.limited("short").truncated)
    }

    func testCounterThresholds() {
        var draft = BugReportDraft()
        draft.text = String(repeating: "a", count: 799)
        XCTAssertFalse(draft.showsCounter)
        draft.text += "a"
        XCTAssertTrue(draft.showsCounter)
        XCTAssertFalse(draft.isNearLimit)
        draft.text = String(repeating: "a", count: 950)
        XCTAssertTrue(draft.isNearLimit)
    }
}

final class BugReportDiagnosticsTests: XCTestCase {
    func testBuilderIncludesOnlyTheAllowList() {
        let d = BugReportDiagnosticsBuilder.make(
            infoDictionary: ["CFBundleShortVersionString": "2.0", "CFBundleVersion": "412", "NSSomethingElse": "x"],
            osVersion: "18.1", machineIdentifier: "iPhone17,1", localeIdentifier: "en_US", screen: .event,
            installId: "6F9619FF-8B86-D011-B42D-00C04FC964FF")
        XCTAssertEqual(d.appVersion, "2.0")
        XCTAssertEqual(d.appBuild, "412")
        XCTAssertEqual(d.osVersion, "iOS 18.1")
        XCTAssertEqual(d.deviceModel, "iPhone17,1")
        XCTAssertEqual(d.screen, .event)
        let keys = Set(Mirror(reflecting: d).children.compactMap(\.label))
        XCTAssertEqual(keys, ["appVersion", "appBuild", "osVersion", "deviceModel", "locale", "screen", "installId"])
    }

    func testMissingInfoAndLongValuesAreClamped() {
        let d = BugReportDiagnosticsBuilder.make(
            infoDictionary: [:], osVersion: String(repeating: "9", count: 90), machineIdentifier: "",
            localeIdentifier: String(repeating: "l\n", count: 60), screen: .home, installId: "x")
        XCTAssertEqual(d.appVersion, "unknown")
        XCTAssertEqual(d.deviceModel, "unknown")
        XCTAssertLessThanOrEqual(d.osVersion.count, 32)
        XCTAssertLessThanOrEqual(d.locale.count, 35)
        XCTAssertFalse(d.locale.contains("\n"))
    }

    func testUnknownRoutesBecomeOtherNeverAnId() {
        XCTAssertEqual(BugReportDiagnosticsBuilder.screen(forRoute: "event"), .event)
        XCTAssertEqual(BugReportDiagnosticsBuilder.screen(forRoute: "event/puppy-yoga-123"), .other)
    }

    func testInstallIDIsRandomAndStable() {
        let defaults = UserDefaults(suiteName: "bugreport.\(UUID().uuidString)")!
        let first = BugReportInstallID.current(defaults)
        XCTAssertNotNil(UUID(uuidString: first))
        XCTAssertEqual(BugReportInstallID.current(defaults), first)
    }
}

final class ShakeGateTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_000)

    func testAcceptsAndDebounces() {
        var gate = ShakeGate()
        XCTAssertTrue(gate.accept(at: t0, .init()))
        XCTAssertFalse(gate.accept(at: t0.addingTimeInterval(1.0), .init()))
        XCTAssertTrue(gate.accept(at: t0.addingTimeInterval(1.6), .init()))
    }

    func testEveryBlockingCondition() {
        for conditions in [
            ShakeGate.Conditions(isEnabled: false), .init(isSheetPresented: true), .init(isAppActive: false),
            .init(isOtherModalUp: true), .init(isSuppressedByHost: true),
        ] {
            var gate = ShakeGate()
            XCTAssertFalse(gate.accept(at: t0, conditions))
        }
    }

    func testSuppressedForTenSecondsAfterClose() {
        var gate = ShakeGate()
        XCTAssertTrue(gate.accept(at: t0, .init()))
        gate.sheetClosed(at: t0.addingTimeInterval(5))
        XCTAssertFalse(gate.accept(at: t0.addingTimeInterval(14), .init()))
        XCTAssertTrue(gate.accept(at: t0.addingTimeInterval(15.1), .init()))
    }

    func testPreferenceDefaultsOn() {
        let defaults = UserDefaults(suiteName: "shake.\(UUID().uuidString)")!
        XCTAssertTrue(ShakeGate.isEnabled(defaults))
        defaults.set(false, forKey: ShakeGate.enabledKey)
        XCTAssertFalse(ShakeGate.isEnabled(defaults))
    }
}

final class ShakePromptPreferenceTests: XCTestCase {
    func testAskFirstDefaultsOnAndCanBeTurnedOff() {
        let defaults = UserDefaults(suiteName: "shake.prompt.\(UUID().uuidString)")!
        XCTAssertTrue(ShakeGate.asksFirst(defaults))
        defaults.set(false, forKey: ShakeGate.promptKey)
        XCTAssertFalse(ShakeGate.asksFirst(defaults))
        XCTAssertNotEqual(ShakeGate.promptKey, ShakeGate.enabledKey)
    }
}

final class ScreenshotMarkupTests: XCTestCase {
    private func p(_ x: Double, _ y: Double) -> MarkupPoint { MarkupPoint(x: x, y: y) }

    func testDrawUndoClear() {
        var markup = ScreenshotMarkup()
        XCTAssertTrue(markup.isEmpty); XCTAssertFalse(markup.canUndo)
        XCTAssertTrue(markup.begin(at: p(0.1, 0.1)))
        markup.extend(to: p(0.2, 0.2)); markup.extend(to: p(0.3, 0.3)); markup.end()
        XCTAssertTrue(markup.begin(at: p(0.5, 0.5))); markup.end()
        XCTAssertEqual(markup.strokes.count, 2)
        XCTAssertEqual(markup.strokes[0].points.count, 3)
        markup.undo()
        XCTAssertEqual(markup.strokes.count, 1)
        markup.clear()
        XCTAssertTrue(markup.isEmpty)
        markup.undo()
        XCTAssertTrue(markup.isEmpty, "undo on an empty markup is a no-op")
    }

    func testPointsAreClampedAndTinyStepsDropped() {
        var markup = ScreenshotMarkup()
        markup.begin(at: p(-3, 7))
        XCTAssertEqual(markup.strokes[0].points[0], p(0, 1))
        markup.extend(to: p(0.0005, 1)); markup.end()
        XCTAssertEqual(markup.strokes[0].points.count, 1, "movement under the minimum step is ignored")
        XCTAssertEqual(MarkupPoint(x: .nan, y: .infinity), p(0, 0))
    }

    func testExtendWithoutBeginAndAfterEndDoesNothing() {
        var markup = ScreenshotMarkup()
        markup.extend(to: p(0.5, 0.5))
        XCTAssertTrue(markup.isEmpty)
        markup.begin(at: p(0.1, 0.1)); markup.end()
        markup.extend(to: p(0.9, 0.9))
        XCTAssertEqual(markup.strokes[0].points.count, 1)
    }

    func testStrokeAndPointLimits() {
        var markup = ScreenshotMarkup()
        for index in 0..<(ScreenshotMarkup.maxStrokes + 5) {
            let accepted = markup.begin(at: p(Double(index % 10) / 10, 0.5)); markup.end()
            XCTAssertEqual(accepted, index < ScreenshotMarkup.maxStrokes)
        }
        XCTAssertEqual(markup.strokes.count, ScreenshotMarkup.maxStrokes)
        var long = ScreenshotMarkup()
        long.begin(at: p(0, 0))
        for index in 1...(ScreenshotMarkup.maxPointsPerStroke + 50) { long.extend(to: p(Double(index % 2), Double(index % 3) / 2 + 0.01 * Double(index % 7))) }
        XCTAssertLessThanOrEqual(long.strokes[0].points.count, ScreenshotMarkup.maxPointsPerStroke)
    }
}

final class BugReportValidationTests: XCTestCase {
    static func report(
        uid: String = "u1", category: BugReportCategory = .bug, description: String = "", id: String = UUID().uuidString.lowercased(),
        createdAt: Date = Date(), screenshot: Bool = false
    ) -> BugReport {
        BugReport(reportId: id, uid: uid, category: category, description: description, source: .shake, screen: .home,
                  diagnostics: nil, includesScreenshot: screenshot, createdAt: createdAt)
    }

    func testValidation() {
        XCTAssertTrue(BugReportValidation.isValid(Self.report()))
        XCTAssertFalse(BugReportValidation.isValid(Self.report(category: .unspecified, description: "short")))
        XCTAssertFalse(BugReportValidation.isValid(Self.report(description: String(repeating: "a", count: 1_001))))
        XCTAssertFalse(BugReportValidation.isValid(Self.report(id: "not-a-uuid")))
        XCTAssertFalse(BugReportValidation.isValid(Self.report(uid: "")))
    }

    func testScreenshotPathIsOwnerScoped() {
        let r = Self.report(uid: "abc", id: "6f9619ff-8b86-d011-b42d-00c04fc964ff", screenshot: true)
        XCTAssertEqual(r.screenshotPath, "bugReports/abc/6f9619ff-8b86-d011-b42d-00c04fc964ff.jpg")
        XCTAssertNil(Self.report(screenshot: false).screenshotPath)
    }
}

final class BugReportOutboxTests: XCTestCase {
    private func makeOutbox() -> (BugReportOutbox, InMemoryBugReportQueueStore) {
        let store = InMemoryBugReportQueueStore()
        return (BugReportOutbox(store: store), store)
    }
    private let t0 = Date(timeIntervalSince1970: 2_000_000)

    func testKeepsFiveNewestPerUserAndDropsScreenshots() async {
        let (outbox, store) = makeOutbox()
        var ids: [String] = []
        for i in 0..<7 {
            let r = BugReportValidationTests.report(createdAt: t0.addingTimeInterval(Double(i)), screenshot: true)
            ids.append(r.reportId)
            await outbox.enqueue(r, screenshot: Data([1]), now: t0.addingTimeInterval(Double(i)))
        }
        let pending = await outbox.pending(uid: "u1", now: t0.addingTimeInterval(10))
        XCTAssertEqual(pending.map(\.report.reportId), Array(ids.suffix(5)))
        XCTAssertNil(store.screenshot(for: ids[0]))
        XCTAssertNotNil(store.screenshot(for: ids[6]))
    }

    func testOtherUsersAreUntouchedByTheCap() async {
        let (outbox, _) = makeOutbox()
        await outbox.enqueue(BugReportValidationTests.report(uid: "other", createdAt: t0), screenshot: nil, now: t0)
        for _ in 0..<6 { await outbox.enqueue(BugReportValidationTests.report(createdAt: t0), screenshot: nil, now: t0) }
        let other = await outbox.pending(uid: "other", now: t0)
        XCTAssertEqual(other.count, 1)
    }

    func testExpiresAfterSevenDays() async {
        let (outbox, store) = makeOutbox()
        let r = BugReportValidationTests.report(createdAt: t0, screenshot: true)
        await outbox.enqueue(r, screenshot: Data([1]), now: t0)
        let later = t0.addingTimeInterval(7 * 24 * 3_600 + 1)
        let pending = await outbox.pending(uid: "u1", now: later)
        XCTAssertTrue(pending.isEmpty)
        XCTAssertNil(store.screenshot(for: r.reportId))
    }

    func testDiscardOnSignOutRemovesOnlyThatUser() async {
        let (outbox, store) = makeOutbox()
        let mine = BugReportValidationTests.report(createdAt: t0, screenshot: true)
        await outbox.enqueue(mine, screenshot: Data([1]), now: t0)
        await outbox.enqueue(BugReportValidationTests.report(uid: "other", createdAt: t0), screenshot: nil, now: t0)
        await outbox.discard(uid: "u1")
        let mineLeft = await outbox.pending(uid: "u1", now: t0)
        let otherLeft = await outbox.pending(uid: "other", now: t0)
        XCTAssertTrue(mineLeft.isEmpty)
        XCTAssertEqual(otherLeft.count, 1)
        XCTAssertNil(store.screenshot(for: mine.reportId))
    }

    func testBackoffScheduleIsTwoEightThirty() {
        XCTAssertEqual([1, 2, 3, 4, 9].map { BugReportOutbox.delay(afterAttempts: $0) }, [2, 8, 30, 30, 30])
    }

    func testFlushDeliversInOrderAndBacksOffOnFailure() async {
        let (outbox, _) = makeOutbox()
        let first = BugReportValidationTests.report(createdAt: t0)
        let second = BugReportValidationTests.report(createdAt: t0.addingTimeInterval(1))
        await outbox.enqueue(first, screenshot: nil, now: t0)
        await outbox.enqueue(second, screenshot: nil, now: t0)
        let submitter = MockBugReportSubmitter(behavior: .offline, delay: .zero)
        var sent = await outbox.flush(uid: "u1", using: submitter, now: t0)
        XCTAssertEqual(sent, 0)
        let attempts = await submitter.attempts
        XCTAssertEqual(attempts, 1, "stops at the first transient failure")
        // Not due again until the backoff passes.
        await submitter.setBehavior(.succeed)
        sent = await outbox.flush(uid: "u1", using: submitter, now: t0.addingTimeInterval(1))
        XCTAssertEqual(sent, 0)
        sent = await outbox.flush(uid: "u1", using: submitter, now: t0.addingTimeInterval(2.1))
        XCTAssertEqual(sent, 2)
        let delivered = await submitter.submitted.map(\.reportId)
        XCTAssertEqual(delivered, [first.reportId, second.reportId])
        let left = await outbox.pending(uid: "u1", now: t0.addingTimeInterval(3))
        XCTAssertTrue(left.isEmpty)
    }

    func testRejectedReportsAreDroppedNotRetriedForever() async {
        let (outbox, _) = makeOutbox()
        await outbox.enqueue(BugReportValidationTests.report(createdAt: t0), screenshot: nil, now: t0)
        let sent = await outbox.flush(uid: "u1", using: MockBugReportSubmitter(behavior: .rejected, delay: .zero), now: t0)
        XCTAssertEqual(sent, 1)
        let left = await outbox.pending(uid: "u1", now: t0)
        XCTAssertTrue(left.isEmpty)
    }

    func testFileStoreRoundTrip() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("bugreports-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let outbox = BugReportOutbox(store: FileBugReportQueueStore(directory: directory))
        let r = BugReportValidationTests.report(createdAt: t0, screenshot: true)
        await outbox.enqueue(r, screenshot: Data([9, 9]), now: t0)
        let reopened = BugReportOutbox(store: FileBugReportQueueStore(directory: directory))
        let pending = await reopened.pending(uid: "u1", now: t0)
        XCTAssertEqual(pending.first?.report.reportId, r.reportId)
        XCTAssertEqual(FileBugReportQueueStore(directory: directory).screenshot(for: r.reportId), Data([9, 9]))
    }
}

final class BugReportSenderTests: XCTestCase {
    private func sender(_ behavior: MockBugReportSubmitter.Behavior, timeout: Duration = .seconds(5))
        -> (BugReportSender, MockBugReportSubmitter) {
        let submitter = MockBugReportSubmitter(behavior: behavior, delay: .zero)
        return (BugReportSender(submitter: submitter, outbox: BugReportOutbox(store: InMemoryBugReportQueueStore()), timeout: timeout), submitter)
    }

    func testSentQueuedAndFailedOutcomes() async {
        let report = BugReportValidationTests.report()
        var (s, m) = sender(.succeed)
        var outcome = await s.send(report, screenshot: nil)
        XCTAssertEqual(outcome, .sent)
        var count = await m.submitted.count
        XCTAssertEqual(count, 1)

        (s, m) = sender(.offline)
        outcome = await s.send(report, screenshot: Data([1]))
        XCTAssertEqual(outcome, .queued)
        let queued = await s.outbox.pending(uid: "u1")
        XCTAssertEqual(queued.count, 1)

        (s, m) = sender(.rateLimited)
        outcome = await s.send(report, screenshot: nil)
        XCTAssertEqual(outcome, .failed(.rateLimited))
        let none = await s.outbox.pending(uid: "u1")
        XCTAssertTrue(none.isEmpty, "failures are kept in the draft, not queued")

        (s, m) = sender(.fail)
        outcome = await s.send(report, screenshot: nil)
        XCTAssertEqual(outcome, .failed(.failed))
        count = await m.submitted.count
        XCTAssertEqual(count, 0)
    }

    func testInvalidReportIsNeverSent() async {
        let (s, m) = sender(.succeed)
        let outcome = await s.send(BugReportValidationTests.report(category: .unspecified, description: "x"), screenshot: nil)
        XCTAssertEqual(outcome, .failed(.rejected))
        let attempts = await m.attempts
        XCTAssertEqual(attempts, 0)
    }

    func testHungSubmissionTimesOutIntoTheQueue() async {
        let hung = MockBugReportSubmitter(behavior: .succeed, delay: .seconds(30))
        let s = BugReportSender(submitter: hung, outbox: BugReportOutbox(store: InMemoryBugReportQueueStore()), timeout: .milliseconds(100))
        let outcome = await s.send(BugReportValidationTests.report(), screenshot: nil)
        XCTAssertEqual(outcome, .queued)
    }

    func testRetryAfterFailureIsIdempotentByReportId() async {
        let (s, m) = sender(.failOnce)
        let report = BugReportValidationTests.report()
        var outcome = await s.send(report, screenshot: nil)
        XCTAssertEqual(outcome, .failed(.failed))
        outcome = await s.send(report, screenshot: nil)
        XCTAssertEqual(outcome, .sent)
        outcome = await s.send(report, screenshot: nil)
        let count = await m.submitted.count
        XCTAssertEqual(count, 1)
    }
}
