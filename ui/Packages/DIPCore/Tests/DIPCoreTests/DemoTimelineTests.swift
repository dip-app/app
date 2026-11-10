import DIPCore
import XCTest

/// A miniature of the B1 Discover & Join demo, used to exercise the timeline engine.
private struct JoinDemo: Equatable, Sendable {
    var revealRadius = 0.0
    var feedOffset = 0.0
    var ghost: String?
    var page = "feed"
    var barTitle = "tabs"
    var attending = 5
    var callout: String?
}

private enum JoinAction: Equatable, Sendable {
    case ghost(String?)
    case openEvent
    case join
    case callout(String?)
}

private func reduce(_ state: inout JoinDemo, _ action: JoinAction) {
    switch action {
    case .ghost(let target): state.ghost = target
    case .openEvent: state.page = "event"; state.barTitle = "Join the Activity"
    case .join: state.barTitle = "Activity Chat"; state.attending = 6; state.ghost = nil
    case .callout(let text): state.callout = text
    }
}

private func ms(_ value: Int) -> Duration { .milliseconds(value) }

private func joinScript(joinAt: Duration = ms(3_800)) -> DemoScript<JoinDemo> {
    DemoScript(
        initial: JoinDemo(),
        duration: ms(6_400),
        beats: [
            DemoBeat(at: ms(2_450), action: .ghost("card.pasta"), animation: OnboardingAnimation.ghost,
                     moves: ["ghost"], targets: ["card.pasta"], label: "choose"),
            DemoBeat(at: ms(2_900), action: .openEvent, animation: OnboardingAnimation.expand,
                     moves: ["cover.pasta"], label: "event page"),
            DemoBeat(at: joinAt, action: .ghost("miniBar"), animation: OnboardingAnimation.ghost,
                     moves: ["ghost"], targets: ["cover.pasta", "miniBar"], label: "tap join"),
            DemoBeat(at: ms(4_300), action: .join, animation: OnboardingAnimation.bar, label: "joined"),
            DemoBeat(at: ms(4_600), action: .callout("Joined. That's it."), animation: OnboardingAnimation.hop,
                     label: "callout"),
        ],
        stills: [ms(950), ms(3_740), ms(6_400)],
        reduce: reduce,
        continuous: { state, t in
            // Beat 1: the reveal radius follows t until 0.95 s. Beat 2: browse offset out and back.
            let s = t.secondsValue
            state.revealRadius = 340 * min(1, s / 0.95)
            if s > 0.95 && s <= 1.85 { state.feedOffset = -180 * (s - 0.95) / 0.9 }
            else if s > 1.85 && s <= 2.45 { state.feedOffset = -180 * (1 - (s - 1.85) / 0.6) }
            else { state.feedOffset = 0 }
        })
}

final class DemoTimelineTests: XCTestCase {
    private let samples: [Duration] = stride(from: 0, through: 6_400, by: 50).map { ms($0) }

    func testStateAtIsDeterministic() {
        let first = joinScript()
        let second = joinScript()
        for t in samples {
            XCTAssertEqual(first.state(at: t), first.state(at: t))
            XCTAssertEqual(first.state(at: t), second.state(at: t))
        }
    }

    func testBeatsApplyInclusivelyAtTheirTime() {
        let script = joinScript()
        XCTAssertEqual(script.state(at: ms(2_899)).page, "feed")
        XCTAssertEqual(script.state(at: ms(2_900)).page, "event")
        XCTAssertEqual(script.state(at: ms(2_900)).barTitle, "Join the Activity")
        XCTAssertEqual(script.state(at: ms(4_300)).barTitle, "Activity Chat")
        XCTAssertEqual(script.state(at: .zero), script.state(at: ms(-500)), "times clamp to the timeline")
        XCTAssertEqual(script.state(at: .zero).revealRadius, 0)
    }

    func testScrubbingForwardAndBackwardConvergesToTheSameState() {
        let script = joinScript()
        let order = samples + samples.reversed() + samples.shuffled()
        var scrubbed: [Duration: JoinDemo] = [:]
        for t in order {
            let state = script.state(at: t)
            if let earlier = scrubbed[t] { XCTAssertEqual(state, earlier, "t = \(t)") }
            scrubbed[t] = state
        }
        // Playback (apply state at start, then fire beats as time advances) lands on the fold.
        var played = script.state(at: .zero)
        var last = Duration.zero
        for t in samples.dropFirst() {
            for beat in script.beats(between: last, and: t) { beat.action(&played) }
            last = t
        }
        var folded = script.finalState
        folded.revealRadius = played.revealRadius
        folded.feedOffset = played.feedOffset
        XCTAssertEqual(played, folded)
    }

    func testFinalStateIsTheEndOfTheFold() {
        let script = joinScript()
        XCTAssertEqual(script.finalState, script.state(at: script.duration))
        XCTAssertEqual(script.finalState, script.state(at: ms(60_000)))
        var manual = JoinDemo(revealRadius: 340)
        for action: JoinAction in [.ghost("card.pasta"), .openEvent, .ghost("miniBar"), .join, .callout("Joined. That's it.")] {
            reduce(&manual, action)
        }
        XCTAssertEqual(script.finalState, manual)
        XCTAssertEqual(script.finalState.attending, 6)
    }

    func testStillsAreOrderedAndInsideTheTimeline() {
        let script = joinScript()
        XCTAssertEqual(script.validate(), [])
        XCTAssertEqual(script.stills, script.stills.sorted())
        XCTAssertTrue(script.stills.allSatisfy { $0 >= .zero && $0 <= script.duration })
        XCTAssertEqual(script.stillStates.map(\.page), ["feed", "event", "event"])
        XCTAssertEqual(script.stillStates.last, script.finalState)

        let bad = DemoScript(initial: JoinDemo(), duration: ms(1_000), beats: [DemoBeat<JoinAction>](),
                             stills: [ms(800), ms(400), ms(1_200)], reduce: reduce)
        XCTAssertEqual(bad.validate(), [.stillOutsideTimeline(ms(1_200)), .stillsNotOrdered])
    }

    func testContinuousParametersAreMonotoneWhereSpecified() {
        let script = joinScript()
        let radii = samples.map { script.state(at: $0).revealRadius }
        XCTAssertEqual(radii, radii.sorted(), "reveal radius never shrinks")
        XCTAssertEqual(radii.last, 340)
        let browseOut = samples.filter { $0 > ms(950) && $0 <= ms(1_850) }.map { script.state(at: $0).feedOffset }
        XCTAssertEqual(browseOut, browseOut.sorted(by: >))
    }

    func testBeatsBetweenIsHalfOpenAndOrdered() {
        let script = joinScript()
        XCTAssertEqual(script.beats(between: ms(2_450), and: ms(4_300)).map(\.label), ["event page", "tap join", "joined"])
        XCTAssertEqual(script.beats(between: .zero, and: ms(2_450)).map(\.label), ["choose"])
        XCTAssertTrue(script.beats(between: ms(4_300), and: ms(2_000)).isEmpty)
        XCTAssertTrue(script.beats(between: ms(3_000), and: ms(3_000)).isEmpty)
    }

    func testSameTimeBeatsKeepDeclaredOrder() {
        let script = DemoScript(
            initial: [String](), duration: ms(1_000),
            beats: [DemoBeat(at: ms(500), action: "b"), DemoBeat(at: ms(100), action: "a"), DemoBeat(at: ms(500), action: "c")],
            reduce: { $0.append($1) })
        XCTAssertEqual(script.finalState, ["a", "b", "c"])
        XCTAssertEqual(script.beats.map(\.at), [ms(100), ms(500), ms(500)])
    }

    func testScrubRateIsTwelveMillisecondsPerPoint() {
        let script = joinScript()
        XCTAssertEqual(script.scrubbedTime(from: ms(1_000), dragging: 100), ms(2_200))
        XCTAssertEqual(script.scrubbedTime(from: ms(1_000), dragging: -100), .zero)
        XCTAssertEqual(script.scrubbedTime(from: ms(6_000), dragging: 100), ms(6_400))
    }

    // MARK: Spring settle rule (spec §3.0 Timing rule, §6 Spring timing)

    func testSettleTimesMatchTheMotionTokens() {
        // Reference: SwiftUI `Spring(response:dampingRatio:).settlingDuration`, the binding values in
        // spec v4 §3.0 / §5. The engine's envelope estimate must never exceed them, so a script that
        // passes the app-level SwiftUI XCTest always passes `validate()`, and stays within 10%.
        let reference: [(String, AnimationSpec, Double)] = [
            ("stage", OnboardingAnimation.stage, 0.946), ("expand", OnboardingAnimation.expand, 0.868),
            ("hop", OnboardingAnimation.hop, 0.867),
            ("reveal", .spring(response: 0.60, dampingFraction: 0.88), 1.002),
            ("affordance", OnboardingAnimation.affordance, 0.975), ("marker", OnboardingAnimation.marker, 0.707),
            // DIPMotion.section is `.smooth(duration: 0.625)`, i.e. a critically damped spring.
            ("section", .spring(response: 0.625, dampingFraction: 1.0), 1.000),
        ]
        for (name, spec, swiftUI) in reference {
            let engine = spec.settleTime.secondsValue
            XCTAssertLessThanOrEqual(engine, swiftUI, name)
            XCTAssertGreaterThanOrEqual(engine, swiftUI * 0.9, name)
        }
        XCTAssertEqual(OnboardingAnimation.copyOut.settleTime, ms(180))
        XCTAssertEqual(OnboardingAnimation.bar.settleTime, ms(300))
        XCTAssertEqual(OnboardingAnimation.ghost.settleTime, ms(450))
        XCTAssertEqual(AnimationSpec.none.settleTime, .zero)
        // Stiffer or more damped springs settle sooner; critically damped springs are finite.
        XCTAssertLessThan(AnimationSpec.spring(response: 0.3, dampingFraction: 0.86).settleTime,
                          OnboardingAnimation.stage.settleTime)
        XCTAssertLessThan(AnimationSpec.spring(response: 0.55, dampingFraction: 1).settleTime, .seconds(2))
        XCTAssertGreaterThan(AnimationSpec.spring(response: 0.55, dampingFraction: 1.5).settleTime,
                             AnimationSpec.spring(response: 0.55, dampingFraction: 1).settleTime)
    }

    func testTimingRuleFlagsATargetingBeatThatStartsBeforeTheSpringSettles() {
        // Spec v2's B1 table started "tap Join" at 3.75 s, but `expand` from 2.90 s settles
        // ≈ 0.85–0.87 s later, so the ghost would aim at a still-moving hero (v4 moves it to 3.82 s).
        let issues = joinScript(joinAt: ms(3_750)).validate()
        XCTAssertEqual(issues.count, 1)
        guard case .startsBeforeSettle(let beat, let element, let earlier, let earliestStart)? = issues.first else {
            return XCTFail("expected a settle violation")
        }
        XCTAssertEqual(beat, "tap join")
        XCTAssertEqual(element, "cover.pasta")
        XCTAssertEqual(earlier, "event page")
        XCTAssertGreaterThan(earliestStart, ms(3_750))
        XCTAssertLessThan(earliestStart, ms(3_800))
        XCTAssertEqual(joinScript(joinAt: ms(3_800)).validate(), [])
    }

    func testTimingRuleAllowsOverlapOnOtherPropertiesAndChecksBounds() {
        let script = DemoScript(
            initial: 0, duration: ms(2_000),
            beats: [
                DemoBeat(at: .zero, action: 1, animation: OnboardingAnimation.stage, moves: ["stage"], label: "zoom"),
                DemoBeat(at: ms(100), action: 1, animation: OnboardingAnimation.bar, moves: ["bar"], label: "bar"),
                DemoBeat(at: ms(300), action: 1, targets: ["bar"], label: "early on bar"),
                DemoBeat(at: ms(2_500), action: 1, label: "late"),
            ],
            reduce: { $0 += $1 })
        XCTAssertEqual(script.validate().count, 2)
        XCTAssertTrue(script.validate().contains(.beatOutsideTimeline(beat: "late")))
        XCTAssertTrue(script.validate().contains {
            if case .startsBeforeSettle(let beat, "bar", "bar", _) = $0 { beat == "early on bar" } else { false }
        })
        XCTAssertEqual(script.finalState, 3, "beats past the duration never apply")
    }
}
