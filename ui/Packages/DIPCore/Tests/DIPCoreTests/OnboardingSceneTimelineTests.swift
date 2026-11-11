import DIPCore
import XCTest

/// B2–B4 demo timelines (spec §3 storyboards). The SwiftUI `settlingDuration` gate runs in the app's
/// `DemoTimingTests`; here the engine's own validator, the table transcription, the folds and the
/// continuous parameters are checked without SwiftUI.
final class OnboardingSceneTimelineTests: XCTestCase {
    private func ms(_ value: Int) -> Duration { .milliseconds(value) }

    private func labels<State>(_ script: DemoScript<State>) -> [String] { script.beats.map(\.label) }

    // MARK: Validator

    func testEveryScriptPassesTheValidator() {
        XCTAssertEqual(PeopleInviteTimeline.script(features: .all).validate(), [])
        XCTAssertEqual(PeopleInviteTimeline.script(features: []).validate(), [])
        XCTAssertEqual(ChallengeTimeline.script(features: .all).validate(), [])
        XCTAssertEqual(ChallengeTimeline.script(features: [.challenges]).validate(), [])
        XCTAssertEqual(MemoriesTimeline.script.validate(), [])
    }

    func testValidatorCatchesAMovedBeat() {
        // Moving B2's first ghost before the zoom settles must fail (0.50 < 0 + settle(stage)).
        let script = PeopleInviteTimeline.script(features: .all)
        let early = script.beats.map { beat -> DemoBeat<DemoScript<PeopleInviteState>.Mutation> in
            var copy = beat
            if beat.label == "b2.ghostMore" { copy.at = ms(500) }
            return copy
        }
        let broken = DemoScript(initial: script.initial, duration: script.duration, beats: early)
        XCTAssertTrue(broken.validate().contains { issue in
            if case .startsBeforeSettle(let beat, let element, let earlier, _) = issue {
                return beat == "b2.ghostMore" && element == "moreCapsule" && earlier == "b2.zoom"
            }
            return false
        })
    }

    // MARK: Table transcription

    func testPeopleBeatsMatchTheSpecTable() {
        let all = PeopleInviteTimeline.script(features: .all)
        XCTAssertEqual(all.beats.count, 24)
        XCTAssertEqual(all.duration, ms(10_200))
        XCTAssertEqual(all.beats.first { $0.label == "b2.ghostMore" }?.at, ms(960))
        XCTAssertEqual(all.beats.first { $0.label == "b2.counts" }?.at, ms(9_400))
        let without = PeopleInviteTimeline.script(features: [])
        XCTAssertEqual(labels(without), ["b2.zoom", "b2.ghostMore", "b2.pressMore", "b2.panel", "b2.unzoom", "b2.panelBack"])
        XCTAssertEqual(without.duration, ms(3_300))
    }

    func testChallengeBeatsDropPointsWithoutF2() {
        let all = ChallengeTimeline.script(features: .all)
        XCTAssertTrue(labels(all).contains("b3.arc"))
        XCTAssertEqual(all.duration, ms(9_800))
        let noPoints = ChallengeTimeline.script(features: [.challenges])
        XCTAssertFalse(labels(noPoints).contains("b3.arc"))
        XCTAssertFalse(labels(noPoints).contains("b3.balance"))
        XCTAssertEqual(noPoints.duration, ms(8_800))
        XCTAssertEqual(noPoints.finalState.statusTitle, "Approved · +50 points")
        XCTAssertEqual(all.finalState.statusTitle, "Approved")
    }

    func testMemoriesBeatsMatchTheSpecTable() {
        let script = MemoriesTimeline.script
        XCTAssertEqual(script.beats.count, 20)
        XCTAssertEqual(script.duration, ms(9_500))
        XCTAssertEqual(script.beats.first { $0.label == "b4.pastPage" }?.at, ms(4_750))
        XCTAssertEqual(script.beats.first { $0.label == "b4.section" }?.animation, .spring(response: 0.625, dampingFraction: 1.0))
    }

    // MARK: Folds

    func testPeopleFold() {
        let script = PeopleInviteTimeline.script(features: .all)
        XCTAssertTrue(script.state(at: ms(100)).zoomed)
        XCTAssertFalse(script.state(at: ms(1_200)).zoomed)
        XCTAssertTrue(script.state(at: ms(1_200)).panelShown)
        XCTAssertFalse(script.state(at: ms(2_800)).panelShown)
        XCTAssertTrue(script.state(at: ms(5_000)).priyaChecked)
        let sent = script.state(at: ms(6_000))
        XCTAssertTrue(sent.inviteSent)
        XCTAssertTrue(sent.toastShown)
        XCTAssertFalse(sent.sheetShown)
        XCTAssertTrue(script.state(at: ms(7_500)).priyaView)
        let final = script.finalState
        XCTAssertFalse(final.priyaView)
        XCTAssertEqual(final.attendees, 7)
        XCTAssertEqual(final.moreCount, 3)
        XCTAssertEqual(script.initial.moreCount, 2, "opens on B1's '+ 2 More'")
        // Without F4 the count never changes.
        XCTAssertEqual(PeopleInviteTimeline.script(features: []).finalState.attendees, 6)
    }

    func testChallengeFold() {
        let script = ChallengeTimeline.script(features: .all)
        XCTAssertFalse(script.state(at: ms(1_000)).detailsOpen)
        XCTAssertTrue(script.state(at: ms(1_200)).detailsOpen)
        XCTAssertTrue(script.state(at: ms(2_500)).calloutShown)
        XCTAssertFalse(script.state(at: ms(3_700)).calloutShown)
        XCTAssertEqual(script.state(at: ms(4_800)).progress, 1)
        XCTAssertEqual(script.state(at: ms(5_100)).progress, 3)
        XCTAssertEqual(script.state(at: ms(7_000)).status, .waiting)
        XCTAssertTrue(script.state(at: ms(7_500)).dimmed)
        XCTAssertFalse(script.state(at: ms(8_050)).dimmed)
        XCTAssertEqual(script.finalState.status, .approved)
        XCTAssertEqual(script.finalState.balance, 170)
        XCTAssertEqual(ChallengeTimeline.script(features: [.challenges]).finalState.balance, 120)
    }

    func testMemoriesFold() {
        let script = MemoriesTimeline.script
        XCTAssertEqual(script.initial.bar, .entry, "carries B3's bar action in")
        let start = script.state(at: .zero)
        XCTAssertEqual(start.bar, .tabs)
        XCTAssertEqual(start.selectedTab, .events)
        XCTAssertEqual(script.state(at: ms(1_000)).callout, .myEvents)
        XCTAssertNil(script.state(at: ms(2_500)).callout)
        XCTAssertTrue(script.state(at: ms(2_600)).pastSection)
        XCTAssertEqual(script.state(at: ms(5_000)).page, .pastEvent)
        XCTAssertEqual(script.state(at: ms(5_000)).bar, .viewAlbum)
        XCTAssertEqual(script.finalState.page, .album)
        XCTAssertEqual(script.finalState.bar, .addPhotos)
        XCTAssertTrue(script.finalState.thumbSettled)
    }

    // MARK: Continuous parameters

    func testFlipAngleIsContinuousAndSwapsAtNinetyDegrees() {
        XCTAssertEqual(PeopleInviteTimeline.flipAngle(at: 6.80), 0)
        XCTAssertEqual(PeopleInviteTimeline.flipAngle(at: 7.159), 90, accuracy: 1)
        XCTAssertEqual(PeopleInviteTimeline.flipAngle(at: 7.16), -90, accuracy: 0.001)
        XCTAssertEqual(PeopleInviteTimeline.flipAngle(at: 7.47), 0)
        let samples = stride(from: 6.90, to: 7.159, by: 0.01).map { PeopleInviteTimeline.flipAngle(at: $0) }
        XCTAssertEqual(samples, samples.sorted(), "the first half turns monotonically")
    }

    func testCaptionTypesOneGraphemeEvery35ms() {
        let script = ChallengeTimeline.script(features: .all)
        XCTAssertEqual(script.state(at: ms(5_200)).captionTyped, "")
        XCTAssertEqual(script.state(at: ms(5_220)).captionTyped, "M")
        XCTAssertEqual(script.state(at: ms(5_300)).captionTyped, "Met")
        XCTAssertEqual(script.state(at: ms(6_000)).captionTyped, ChallengeTimeline.caption)
        let lengths = stride(from: 5_200, through: 6_000, by: 10).map { script.state(at: ms($0)).captionTyped.count }
        XCTAssertEqual(lengths, lengths.sorted())
    }

    func testPointsArcFollowsItsKeyframes() {
        let start = ChallengeTimeline.Point.statusPill
        XCTAssertNil(ChallengeTimeline.arcPoint(at: 8.49))
        XCTAssertEqual(ChallengeTimeline.arcPoint(at: 8.50), start)
        XCTAssertEqual(ChallengeTimeline.arcPoint(at: 8.70)?.x ?? 0, start.x + 24, accuracy: 0.001)
        XCTAssertEqual(ChallengeTimeline.arcPoint(at: 8.85)?.y ?? 0, start.y - 60, accuracy: 0.001)
        XCTAssertEqual(ChallengeTimeline.arcPoint(at: 9.0499)?.x ?? 0, ChallengeTimeline.Point.pointsPill.x, accuracy: 0.5)
        XCTAssertNil(ChallengeTimeline.arcPoint(at: 9.06))
        XCTAssertNil(ChallengeTimeline.script(features: [.challenges]).state(at: ms(8_700)).token)
    }

    func testWhiteningAndDevelopAreMonotone() {
        let challenge = ChallengeTimeline.script(features: .all)
        // The white layer is a clamped spring: monotone non-decreasing and full by the rest frame.
        let heights = stride(from: 0, through: 1_200, by: 20).map { challenge.state(at: ms($0)).whiteHeight }
        XCTAssertEqual(heights, heights.sorted())
        XCTAssertEqual(challenge.finalState.whiteHeight, 540, accuracy: 0.01)
        let memories = MemoriesTimeline.script
        let develop = stride(from: 0, through: 500, by: 20).map { memories.state(at: ms($0)).listDevelop }
        XCTAssertEqual(develop, develop.sorted())
        for value in memories.finalState.albumDevelop { XCTAssertEqual(value, 1, accuracy: 1e-6) }
        XCTAssertEqual(memories.finalState.upload, 1)
    }

    func testGhostVisitsAppearPressAndLift() {
        let script = PeopleInviteTimeline.script(features: .all)
        XCTAssertNil(script.state(at: ms(900)).ghost)
        let pressing = script.state(at: ms(1_110)).ghost
        XCTAssertEqual(pressing?.position, PeopleInviteTimeline.Point.moreCapsule)
        XCTAssertLessThan(pressing?.scale ?? 1, 1)
        XCTAssertNil(script.state(at: ms(1_400)).ghost, "lifted off after the press")
        // The second visit travels from the capsule to the chip and lands there for the press.
        XCTAssertEqual(script.state(at: ms(3_700)).ghost?.position, PeopleInviteTimeline.Point.inviteChip)
        XCTAssertNil(PeopleInviteTimeline.script(features: []).state(at: ms(3_700)).ghost)
    }

    func testCalloutAppearanceEntersAndExits() {
        XCTAssertEqual(DemoProgress.callout(0.70, enter: 0.75, exit: 2.40), 0)
        XCTAssertGreaterThan(DemoProgress.callout(1.70, enter: 0.75, exit: 2.40), 0.99)
        XCTAssertEqual(DemoProgress.callout(2.56, enter: 0.75, exit: 2.40), 0, accuracy: 0.001)
    }

    func testDeterminismAndScrubConvergence() {
        let script = MemoriesTimeline.script
        for millis in stride(from: 0, through: 9_500, by: 250) {
            XCTAssertEqual(script.state(at: ms(millis)), script.state(at: ms(millis)))
        }
        // Scrubbing back and forth lands on the same state as going straight there.
        let back = script.scrubbedTime(from: ms(6_000), dragging: -250)
        XCTAssertEqual(script.state(at: back), script.state(at: ms(3_000)))
    }

    func testStillsAreOrderedAndInside() {
        for stills in [PeopleInviteTimeline.script(features: .all).stills, PeopleInviteTimeline.script(features: []).stills,
                       ChallengeTimeline.script(features: .all).stills, MemoriesTimeline.script.stills] {
            XCTAssertEqual(stills, stills.sorted())
        }
    }
}
