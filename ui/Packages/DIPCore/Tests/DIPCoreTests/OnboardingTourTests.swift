import DIPCore
import XCTest

final class OnboardingTourTests: XCTestCase {
    private let date = Date(timeIntervalSinceReferenceDate: 800_000_000)

    // MARK: Entrance

    func testEntranceIsFreshWithoutARecord() {
        let start = OnboardingEntrance.start(mode: .firstRun, record: nil, features: .all, catalogEmpty: false)
        XCTAssertEqual(start.entrance, .fresh)
        XCTAssertEqual(start.flow.currentStep, .arrival)
    }

    func testEntranceResumesExactlyWhenTheRecordHasALastStep() {
        let record = OnboardingRecord(lastStep: .challenges, outcome: nil, updatedAt: date)
        let start = OnboardingEntrance.start(mode: .firstRun, record: record, features: .all, catalogEmpty: false)
        XCTAssertEqual(start.entrance, .resume(.challenges))
        XCTAssertEqual(start.flow.currentStep, .challenges)

        let noStep = OnboardingRecord(lastStep: nil, outcome: nil, updatedAt: date)
        XCTAssertEqual(OnboardingEntrance.start(mode: .firstRun, record: noStep, features: .all, catalogEmpty: false).entrance, .fresh)

        var oldVersion = record
        oldVersion.version = 0
        XCTAssertEqual(OnboardingEntrance.start(mode: .firstRun, record: oldVersion, features: .all, catalogEmpty: false).entrance, .fresh)
    }

    func testResumeClampsForwardAndReportsTheClampedStep() {
        // B3 needs `.challenges`; without it the record resumes at B4.
        let record = OnboardingRecord(lastStep: .challenges, outcome: nil, updatedAt: date)
        let start = OnboardingEntrance.start(mode: .firstRun, record: record, features: [], catalogEmpty: false)
        XCTAssertEqual(start.entrance, .resume(.memories))
    }

    func testResumeAtArrivalUsesTheFreshEntrance() {
        let record = OnboardingRecord(lastStep: .arrival, outcome: nil, updatedAt: date)
        XCTAssertEqual(OnboardingEntrance.start(mode: .firstRun, record: record, features: .all, catalogEmpty: false).entrance, .fresh)
    }

    func testCompletedRecordStartsInHandoff() {
        let record = OnboardingRecord(lastStep: .people, outcome: .skipped, updatedAt: date)
        let start = OnboardingEntrance.start(mode: .firstRun, record: record, features: .all, catalogEmpty: false)
        XCTAssertEqual(start.entrance, .fresh)
        XCTAssertTrue(start.flow.isHandingOff)
    }

    func testReplayStartsAtDiscoverIgnoringRecordsAndSaysDone() {
        let record = OnboardingRecord(lastStep: .memories, outcome: nil, updatedAt: date)
        let start = OnboardingEntrance.start(mode: .replay, record: record, features: .all, catalogEmpty: false)
        XCTAssertEqual(start.entrance, .replay)
        XCTAssertEqual(start.flow.currentStep, .discover)
        XCTAssertEqual(start.flow.skipTitle, "Done")
        XCTAssertEqual(OnboardingFlow(mode: .firstRun, features: .all).skipTitle, "Skip")
    }

    // MARK: Crew stack

    func testCrewStackShowsThreeFacesThenAnOverflowDisc() {
        XCTAssertEqual(OnboardingCrewStack(count: 0).discs, 0)
        XCTAssertEqual(OnboardingCrewStack(count: 0).width, 0)
        XCTAssertEqual(OnboardingCrewStack(count: 1).width, 28)
        XCTAssertEqual(OnboardingCrewStack(count: 3).faces, 3)
        XCTAssertEqual(OnboardingCrewStack(count: 3).overflow, 0)
        let b4 = OnboardingCrewStack(count: 4)
        XCTAssertEqual(b4.faces, 3)
        XCTAssertEqual(b4.overflow, 1)
        XCTAssertEqual(b4.width, 82, "never wider than 82 pt")
        XCTAssertEqual(OnboardingCrewStack(count: 5).overflow, 2)
        XCTAssertEqual(OnboardingCrewStack(count: 5).width, 82)
        XCTAssertEqual(OnboardingCrewStack.offset(of: 2), 36)
    }

    func testCrewStackCountsMatchTheSpecExamples() {
        var flow = OnboardingFlow(mode: .firstRun, features: .all)
        var counts: [OnboardingStep: Int] = [:]
        while let step = flow.currentStep {
            counts[step] = flow.crewStackCount
            flow = flow.next(at: date).flow
        }
        // B2 [You, P], B3 [You, P, Y], B4 [You, P, Y, +1], B5 [You, P, Y, +2].
        XCTAssertEqual(counts[.people], 2)
        XCTAssertEqual(counts[.challenges], 3)
        XCTAssertEqual(OnboardingCrewStack(count: counts[.memories]!).overflow, 1)
        XCTAssertEqual(OnboardingCrewStack(count: counts[.interests]!).overflow, 2)
    }

    func testCompletedHostsDropMissingSteps() {
        let flow = OnboardingFlow(mode: .firstRun, features: [])
        XCTAssertEqual(flow.completedHosts(before: .interests), [.discover, .people, .memories])
        XCTAssertEqual(flow.completedHosts(before: .discover), [])
        XCTAssertEqual(flow.completedHosts(before: .challenges), [], "a dropped step has no hosts")
    }

    // MARK: Header overflow rule

    func testHeaderFitsOnOneRowAtDefaultSizes() {
        // Widest pill ≈ 144 pt plus a full stack still ends before Skip (x 333 − 8).
        XCTAssertEqual(OnboardingHeaderLayout.resolve(pillWidth: 144, stackWidth: 82, skipMinX: 333, isAccessibilitySize: false),
                       .oneRow(pillMaxWidth: nil))
        XCTAssertEqual(OnboardingHeaderLayout.skipWidth(labelWidth: 33), 49)
        XCTAssertEqual(OnboardingHeaderLayout.skipWidth(labelWidth: 10), 44)
    }

    func testHeaderTruncatesThePillThenWraps() {
        XCTAssertEqual(OnboardingHeaderLayout.resolve(pillWidth: 200, stackWidth: 82, skipMinX: 333, isAccessibilitySize: false),
                       .oneRow(pillMaxWidth: 161))
        XCTAssertEqual(OnboardingHeaderLayout.resolve(pillWidth: 200, stackWidth: 82, skipMinX: 250, isAccessibilitySize: false),
                       .twoRows)
        XCTAssertEqual(OnboardingHeaderLayout.resolve(pillWidth: 60, stackWidth: 0, skipMinX: 333, isAccessibilitySize: true),
                       .twoRows)
    }

    // MARK: Handoff surfaces

    func testSurfaceBarTreatmentAndFocus() {
        let expected: [OnboardingHomeSurface: (OnboardingHomeSurface.BarTreatment, OnboardingHomeSurface.FocusTarget, Bool)] = [
            .shellLoading: (.fadeOut, .loadingLabel, true),
            .shellUnavailable: (.fadeOut, .unavailableTitle, false),
            .activitiesLoading: (.dissolveToTabs, .loadingLabel, true),
            .activitiesError: (.dissolveToTabs, .retryButton, false),
            .ready: (.dissolveToTabs, .homeHeader, false),
        ]
        XCTAssertEqual(Set(expected.keys), Set(OnboardingHomeSurface.allCases))
        for (surface, (bar, focus, waits)) in expected {
            XCTAssertEqual(surface.barTreatment, bar, "\(surface)")
            XCTAssertEqual(surface.focusTarget, focus, "\(surface)")
            XCTAssertEqual(OnboardingHandoff.shouldWait(for: surface), waits, "\(surface)")
        }
        XCTAssertTrue(OnboardingHandoff.shouldWait(for: nil), "an unreported surface is still loading")
        XCTAssertTrue(OnboardingHomeSurface.ready.hasProfileButton)
        XCTAssertFalse(OnboardingHomeSurface.activitiesError.hasProfileButton)
    }

    func testHandoffTimingAndProfileButton() {
        XCTAssertLessThan(OnboardingHandoff.stageFadeAt, OnboardingHandoff.windowAt)
        XCTAssertLessThan(OnboardingHandoff.windowAt, OnboardingHandoff.barAt)
        // The window (`reveal`, ≈ 1.0 s) has settled before the layer is removed.
        XCTAssertGreaterThanOrEqual(OnboardingHandoff.removeAt, OnboardingHandoff.windowAt + 1.0)
        let frame = OnboardingHandoff.profileButtonFrame(width: 402)
        XCTAssertEqual(frame.x, 337)
        XCTAssertEqual(frame.y, 65)
        XCTAssertEqual(frame.size, 40)
    }

    // MARK: Colour choreography

    func testAdjacentStageFillsDiffer() {
        let fills = OnboardingStep.allCases.map(OnboardingStageFill.fill(for:))
        for (a, b) in zip(fills, fills.dropFirst()) { XCTAssertNotEqual(a, b) }
        // With B3 dropped (no `.challenges`), B2 gray → B4 yellow still differ.
        XCTAssertNotEqual(OnboardingStageFill.fill(for: .people), OnboardingStageFill.fill(for: .memories))
        XCTAssertEqual(OnboardingStageFill.fill(for: .discover), .actionPrimary)
    }
}
