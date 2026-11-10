import DIPCore
import XCTest

final class OnboardingFlowTests: XCTestCase {
    private let date = Date(timeIntervalSinceReferenceDate: 800_000_000)
    private let all: [OnboardingStep] = [.arrival, .discover, .people, .challenges, .memories, .interests]

    private func persisted(_ effects: [OnboardingFlow.Effect]) -> [OnboardingRecord] {
        effects.compactMap { if case .persist(let record) = $0 { record } else { nil } }
    }

    private func announced(_ effects: [OnboardingFlow.Effect]) -> [String] {
        effects.compactMap { if case .announce(let text) = $0 { text } else { nil } }
    }

    private func flow(at step: OnboardingStep, mode: OnboardingFlow.Mode = .firstRun,
                      features: OnboardingFeatures = .all) -> OnboardingFlow {
        var flow = OnboardingFlow(mode: mode, features: features)
        while flow.currentStep != step { flow = flow.next(at: date).flow }
        return flow
    }

    // MARK: Available steps

    func testAvailableStepsFollowFlagsAndCatalog() {
        XCTAssertEqual(OnboardingStep.availableSteps(features: .all, catalogEmpty: false), all)
        XCTAssertEqual(OnboardingStep.availableSteps(features: [], catalogEmpty: false),
                       [.arrival, .discover, .people, .memories, .interests])
        XCTAssertEqual(OnboardingStep.availableSteps(features: .all, catalogEmpty: true),
                       [.arrival, .discover, .people, .challenges, .memories])
        XCTAssertEqual(OnboardingStep.availableSteps(features: .all, catalogEmpty: false, includeArrival: false),
                       [.discover, .people, .challenges, .memories, .interests])
        // Beat-level flags never remove whole steps.
        XCTAssertEqual(OnboardingStep.availableSteps(features: [.challenges], catalogEmpty: false), all)
    }

    func testSpecIDsAndHosts() {
        XCTAssertEqual(all.map(\.specID), ["B0", "B1", "B2", "B3", "B4", "B5"])
        XCTAssertEqual(all.filter(\.hasHostFace), [.discover, .people, .challenges, .memories])
    }

    // MARK: Forward

    func testFirstRunStartsAtArrivalWithoutWriting() {
        let flow = OnboardingFlow(mode: .firstRun, features: .all)
        XCTAssertEqual(flow.phase, .step(.arrival))
        XCTAssertEqual(flow.steps, all)
        XCTAssertNil(flow.progress)
        XCTAssertEqual(flow.crewStackCount, 0)
        XCTAssertFalse(flow.canGoBack)
        XCTAssertTrue(flow.showsSkip)
    }

    func testEveryNextTransitionPersistsTheStepThatBeganAndAnnouncesIt() {
        var flow = OnboardingFlow(mode: .firstRun, features: .all)
        for (index, expected) in all.dropFirst().enumerated() {
            let (next, effects) = flow.next(at: date)
            XCTAssertEqual(next.phase, .step(expected))
            XCTAssertEqual(persisted(effects), [OnboardingRecord(lastStep: expected, outcome: nil, updatedAt: date)])
            XCTAssertEqual(announced(effects), ["Step \(index + 1) of 5, \(expected.pillTitle)"])
            XCTAssertEqual(next.progress?.number, index + 1)
            XCTAssertEqual(next.progress?.count, 5)
            flow = next
        }
        XCTAssertEqual(announced(flow.next(at: date).effects), [])
    }

    func testAnnouncementCopyMatchesSpec() {
        XCTAssertEqual(flow(at: .people).announcement(for: .people), "Step 2 of 5, Who's going")
        XCTAssertEqual(flow(at: .arrival).announcement(for: .arrival), "You're in")
    }

    func testNextOnLastStepStartsFinishedHandoff() {
        let (flow, effects) = flow(at: .interests).next(at: date)
        XCTAssertEqual(flow.phase, .handoff(.finished))
        XCTAssertTrue(flow.isHandingOff)
        XCTAssertNil(flow.currentStep)
        XCTAssertEqual(effects, [.persist(OnboardingRecord(lastStep: .interests, outcome: .finished, updatedAt: date))])
    }

    func testCrewStackGrowsWithYouThenOneHostPerSettledStep() {
        XCTAssertEqual(all.map { flow(at: $0).crewStackCount }, [0, 1, 2, 3, 4, 5])
        // A dropped feature leaves no gap: 1 + available B1–B4 steps.
        let noChallenges = OnboardingFlow(mode: .firstRun, features: [])
        var counts: [Int] = []
        var current = noChallenges
        while !current.isHandingOff { counts.append(current.crewStackCount); current = current.next(at: date).flow }
        XCTAssertEqual(counts, [0, 1, 2, 3, 4])
        XCTAssertEqual(current.crewStackCount, 4)
    }

    func testDroppedStepIsSkippedOnTheWayThrough() {
        let (flow, _) = flow(at: .people, features: []).next(at: date)
        XCTAssertEqual(flow.currentStep, .memories)
        XCTAssertEqual(flow.progress?.number, 3)
        XCTAssertEqual(flow.progress?.count, 4)
    }

    // MARK: Back

    func testBackAtFirstStepIsANoOp() {
        let first = OnboardingFlow(mode: .firstRun, features: .all)
        let (flow, effects) = first.back()
        XCTAssertEqual(flow, first)
        XCTAssertEqual(effects, [])
        let replay = OnboardingFlow(mode: .replay, features: .all)
        XCTAssertEqual(replay.back().flow, replay)
        XCTAssertFalse(replay.canGoBack)
    }

    func testEveryBackTransitionReturnsOneStepAndNeverPersists() {
        for (index, step) in all.enumerated().dropFirst() {
            let current = flow(at: step)
            XCTAssertTrue(current.canGoBack)
            let (previous, effects) = current.back()
            XCTAssertEqual(previous.currentStep, all[index - 1])
            XCTAssertEqual(persisted(effects), [])
            XCTAssertEqual(announced(effects), [previous.announcement(for: all[index - 1])])
        }
    }

    // MARK: Skip

    func testSkipFromEachStepWritesSkippedAtThatStep() {
        for step in all {
            let (flow, effects) = flow(at: step).skip(at: date)
            XCTAssertEqual(flow.phase, .handoff(.skipped), "\(step)")
            XCTAssertEqual(effects, [.persist(OnboardingRecord(lastStep: step, outcome: .skipped, updatedAt: date))])
        }
    }

    func testHeaderSkipIsHiddenOnInterests() {
        XCTAssertEqual(all.map { flow(at: $0).showsSkip }, [true, true, true, true, true, false])
    }

    // MARK: Handoff

    func testBeginHandoffWritesOutcomeImmediately() {
        let (flow, effects) = flow(at: .memories).beginHandoff(at: date)
        XCTAssertEqual(flow.phase, .handoff(.finished))
        XCTAssertEqual(effects, [.persist(OnboardingRecord(lastStep: .memories, outcome: .finished, updatedAt: date))])
    }

    func testHandoffIsIdempotentAndTerminal() {
        let handingOff = flow(at: .interests).beginHandoff(at: date).flow
        for transition in [handingOff.beginHandoff(at: date), handingOff.skip(at: date),
                           handingOff.next(at: date), handingOff.back()] {
            XCTAssertEqual(transition.flow, handingOff)
            XCTAssertEqual(transition.effects, [])
        }
        // Skip then a late CTA tap keeps the first outcome.
        let skipped = flow(at: .people).skip(at: date).flow
        XCTAssertEqual(skipped.beginHandoff(at: date).flow.phase, .handoff(.skipped))
        XCTAssertFalse(skipped.canGoBack)
        XCTAssertFalse(skipped.showsSkip)
        XCTAssertNil(skipped.progress)
    }

    // MARK: Replay

    func testReplayStartsAtDiscoverAndNeverPersists() {
        var flow = OnboardingFlow(mode: .replay, features: .all)
        XCTAssertEqual(flow.phase, .step(.discover))
        XCTAssertEqual(flow.steps, Array(all.dropFirst()))
        XCTAssertEqual(flow.crewStackCount, 1)
        var effects: [OnboardingFlow.Effect] = []
        while !flow.isHandingOff {
            let transition = flow.next(at: date)
            effects += transition.effects
            effects += transition.flow.back().effects
            effects += flow.skip(at: date).effects
            flow = transition.flow
        }
        XCTAssertEqual(flow.phase, .handoff(.finished))
        XCTAssertEqual(persisted(effects), [])
        XCTAssertFalse(announced(effects).isEmpty, "replay still announces step changes")
    }

    // MARK: Resume

    func testResumeWithoutRecordStartsFresh() {
        XCTAssertEqual(OnboardingFlow.resume(record: nil, features: .all), OnboardingFlow(mode: .firstRun, features: .all))
    }

    func testResumeAtEveryStoredStep() {
        for step in all {
            let record = OnboardingRecord(lastStep: step, outcome: nil, updatedAt: date)
            XCTAssertEqual(OnboardingFlow.resume(record: record, features: .all).phase, .step(step))
        }
    }

    func testResumeClampsForwardWhenAFlagRemovesTheStoredStep() {
        let record = OnboardingRecord(lastStep: .challenges, outcome: nil, updatedAt: date)
        let flow = OnboardingFlow.resume(record: record, features: [])
        XCTAssertEqual(flow.phase, .step(.memories))
        XCTAssertEqual(flow.mode, .firstRun)
    }

    func testResumeClampsToLastAvailableStepWhenNothingFollows() {
        let record = OnboardingRecord(lastStep: .interests, outcome: nil, updatedAt: date)
        XCTAssertEqual(OnboardingFlow.resume(record: record, features: .all, catalogEmpty: true).phase, .step(.memories))
    }

    func testResumeIgnoresUnsupportedVersionAndUnknownStep() {
        let future = OnboardingRecord(version: 2, lastStep: .memories, outcome: .finished, updatedAt: date)
        XCTAssertFalse(future.isSupported)
        XCTAssertFalse(future.isComplete)
        XCTAssertEqual(OnboardingFlow.resume(record: future, features: .all).phase, .step(.arrival))
        let unknownStep = OnboardingRecord(lastStep: nil, outcome: nil, updatedAt: date)
        XCTAssertEqual(OnboardingFlow.resume(record: unknownStep, features: .all).phase, .step(.arrival))
    }

    func testResumeOfCompletedRecordIsAlreadyHandingOff() {
        let record = OnboardingRecord(lastStep: .people, outcome: .skipped, updatedAt: date)
        let flow = OnboardingFlow.resume(record: record, features: .all)
        XCTAssertEqual(flow.phase, .handoff(.skipped))
        XCTAssertEqual(flow.beginHandoff(at: date).effects, [])
    }

    func testKillAndRelaunchResumesTheStepThatWasShowing() {
        var record: OnboardingRecord?
        var flow = OnboardingFlow(mode: .firstRun, features: .all)
        for _ in 0..<3 {
            let transition = flow.next(at: date)
            for case .persist(let written) in transition.effects { record = written }
            flow = transition.flow
        }
        XCTAssertEqual(flow.currentStep, .challenges)
        // Back does not rewind the record, so the furthest settled step is resumed.
        flow = flow.back().flow
        XCTAssertEqual(OnboardingFlow.resume(record: record, features: .all).currentStep, .challenges)
    }
}
