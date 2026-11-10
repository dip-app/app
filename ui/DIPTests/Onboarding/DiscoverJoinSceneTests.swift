import DIPCore
import DIPDesignSystem
import SwiftUI
import XCTest
@testable import DIP

@MainActor
final class DiscoverJoinSceneTests: XCTestCase {
    private let scene = DiscoverJoinScene()
    private var script: DemoScript<DiscoverJoinState> { scene.script }
    private func ms(_ value: Int) -> Duration { .milliseconds(value) }
    private func state(_ milliseconds: Int) -> DiscoverJoinState { script.state(at: ms(milliseconds)) }

    func testScriptSatisfiesTheTimingRule() {
        XCTAssertEqual(script.validate(), [])
        XCTAssertEqual(script.duration, ms(6_400))
        XCTAssertEqual(scene.reducedStills, script.stills)
    }

    /// Spec v3 §5 "Beat timing": every targeting beat starts after its mover settles, measured against
    /// SwiftUI's own `Spring.settlingDuration`, with no tolerance.
    func testTargetingBeatsWaitForSwiftUISettlingDuration() {
        for (index, beat) in script.beats.enumerated() {
            for target in beat.targets {
                guard let mover = script.beats[..<index].last(where: { $0.moves.contains(target) }) else { continue }
                let settle: Double
                switch mover.animation {
                case .spring(let response, let damping):
                    settle = Spring(response: response, dampingRatio: damping).settlingDuration
                case .easeIn(let duration), .easeOut(let duration), .easeInOut(let duration), .linear(let duration):
                    settle = duration
                case .none:
                    settle = 0
                }
                XCTAssertGreaterThanOrEqual(beat.at.secondsValue + 1e-9, mover.at.secondsValue + settle,
                                            "\(beat.label) targets \(target) before \(mover.label) settles")
            }
        }
        // Spec v3: tap Join at 3.80 against the hero's 2.90 + 0.85.
        let tapJoin = script.beats.first { $0.label == "tap join" }
        XCTAssertEqual(tapJoin?.at, ms(3_800))
    }

    func testBeatsChangeTheStateAtTheirTimes() {
        XCTAssertEqual(state(2_899).page, .feed)
        XCTAssertEqual(state(2_899).bar, .tabs)
        XCTAssertEqual(state(2_900).page, .event)
        XCTAssertEqual(state(2_900).bar, .join)
        XCTAssertEqual(state(4_299).attendeeCount, 5)
        XCTAssertFalse(state(4_299).joined)
        XCTAssertEqual(state(4_300).attendeeCount, 6)
        XCTAssertEqual(state(4_300).bar, .joined)
        XCTAssertFalse(state(4_599).calloutShown)
        XCTAssertTrue(state(4_600).calloutShown)
    }

    func testContinuousParametersFollowTheStoryboard() {
        XCTAssertEqual(state(0).revealRadius, 0)
        XCTAssertEqual(state(0).cardScales, Array(repeating: 0.94, count: 5))
        XCTAssertEqual(state(1_100).revealRadius, 340, accuracy: 0.5)
        for scale in state(1_100).cardScales { XCTAssertEqual(scale, 1, accuracy: 0.002) }
        // Browse: out to −180 by 2.00, back to 0 by 2.60, monotone each way.
        XCTAssertEqual(state(1_100).feedOffset, 0, accuracy: 1e-9)
        XCTAssertEqual(state(2_000).feedOffset, -180, accuracy: 1e-6)
        XCTAssertEqual(state(2_600).feedOffset, 0, accuracy: 1e-6)
        let out = stride(from: 1_100, through: 2_000, by: 20).map { state($0).feedOffset }
        XCTAssertEqual(out, out.sorted(by: >))
        let back = stride(from: 2_000, through: 2_600, by: 20).map { state($0).feedOffset }
        XCTAssertEqual(back, back.sorted())
        // Ghost: absent, over Pasta Night pressing, lifted, travelling to the bar, gone.
        XCTAssertNil(state(2_599).ghost)
        XCTAssertEqual(state(2_700).ghost?.position, DiscoverJoinTimeline.pastaCentre)
        XCTAssertEqual(state(2_910).ghost?.scale ?? 1, 0.86, accuracy: 0.001)
        XCTAssertLessThan(state(2_910).pastaPress, 1)
        XCTAssertNil(state(3_500).ghost)
        XCTAssertEqual(state(4_250).ghost?.position, DiscoverJoinTimeline.barTarget)
        XCTAssertNil(state(4_700).ghost)
        // Ring pulse runs 0.5 s from the join.
        XCTAssertNil(state(4_299).ringProgress)
        XCTAssertEqual(state(4_550).ringProgress ?? 0, 0.5, accuracy: 1e-6)
        XCTAssertNil(state(4_800).ringProgress)
        // Rows grow out of the hero's bottom edge.
        XCTAssertEqual(state(2_900).rowReveal, [0, 0, 0])
        for reveal in state(3_900).rowReveal { XCTAssertEqual(reveal, 1, accuracy: 0.002) }
    }

    func testFinalStateIsTheJoinedPageAtRest() {
        let final = scene.finalState
        XCTAssertEqual(final, script.state(at: script.duration))
        XCTAssertEqual(final.page, .event)
        XCTAssertEqual(final.bar, .joined)
        XCTAssertTrue(final.joined)
        XCTAssertEqual(final.attendeeCount, 6)
        XCTAssertTrue(final.calloutShown)
        XCTAssertEqual(final.calloutAppearance, 1, accuracy: 0.002)
        XCTAssertNil(final.ghost)
        XCTAssertNil(final.ringProgress)
        XCTAssertEqual(final.feedOffset, 0)
    }

    func testReducedStillsAreOrderedInsideTheTimelineAndGhostFree() {
        let stills = scene.reducedStills
        XCTAssertEqual(stills.count, 3)
        XCTAssertEqual(stills, stills.sorted())
        XCTAssertTrue(stills.allSatisfy { $0 >= .zero && $0 <= script.duration })
        let states = script.stillStates
        XCTAssertEqual(states.map(\.page), [.feed, .event, .event])
        XCTAssertEqual(states.map(\.joined), [false, false, true])
        XCTAssertTrue(states.allSatisfy { $0.ghost == nil && $0.ringProgress == nil })
        XCTAssertEqual(states.last, scene.finalState)
    }

    func testPlaybackFoldMatchesStateAt() {
        // DemoStage applies `state(at: start)` and then fires beats; continuous values come from t.
        for start in [0, 1_000, 2_900, 4_300] {
            var played = script.state(at: ms(start))
            for beat in script.beats(between: ms(start), and: script.duration) { beat.action(&played) }
            scene.applyContinuous(&played, at: script.duration)
            XCTAssertEqual(played, scene.finalState, "from \(start) ms")
        }
    }

    func testTheJoinedBarComesFromTheAppResolver() {
        let join = EventBarAction.forEvent(OnboardingDemoFixtures.pastaDetail(joined: false, avatars: []), isLoading: false)
        XCTAssertEqual(join.title, "Join the Activity")
        XCTAssertEqual(join.style, .standard)
        let joined = EventBarAction.forEvent(OnboardingDemoFixtures.pastaDetail(joined: true, avatars: []), isLoading: false)
        XCTAssertEqual(joined.title, "Activity Chat")
        XCTAssertEqual(joined.style, .accent)
        XCTAssertEqual(joined.icon, "event_HeroiconsOutlineChatBubbleOvalLeft")
    }

    func testSceneMetadata() {
        XCTAssertEqual(DiscoverJoinScene.id, "discover")
        XCTAssertEqual(scene.hostFace, .purple)
        XCTAssertTrue(scene.description.hasPrefix("Example: a feed of company events"))
        XCTAssertEqual(scene.accessibilityRows.map(\.systemImage), ["calendar", "hand.tap", "checkmark.circle"])
        XCTAssertEqual(OnboardingDemoFixtures.feed.map(\.cover),
                       ["cover_games", "cover_cooking", "cover_hiking", "cover_outdoors", "cover_fitness"])
    }

    // MARK: Render checks (spec §5): final state and each reduced still render non-empty.

    func testFinalStateAndStillsRender() throws {
        scene.prepare()
        for (name, state) in [("final", scene.finalState)] + script.stillStates.enumerated().map({ ("still \($0)", $1) }) {
            let renderer = ImageRenderer(content: scene.canvas(state)
                .frame(width: DemoCanvas.size.width, height: DemoCanvas.size.height)
                .environment(\.dynamicTypeSize, .large))
            renderer.scale = 1
            let image = try XCTUnwrap(renderer.cgImage, name)
            XCTAssertEqual(image.width, 390, name)
            XCTAssertEqual(image.height, 540, name)
            XCTAssertGreaterThan(distinctColours(image), 20, "\(name) rendered almost blank")
        }
    }

    func testCrewAvatarsRenderOnceAsPNG() throws {
        let first = CrewAvatarImages.reference(.purple)
        XCTAssertEqual(first, CrewAvatarImages.reference(.purple), "cached")
        guard case .data(let data) = first else { return XCTFail("expected PNG data") }
        let image = try XCTUnwrap(UIImage(data: data))
        XCTAssertEqual(image.size.width * image.scale, 120, accuracy: 1, "40 pt at @3x")
        guard case .data(let you) = CrewAvatarImages.you(name: "S") else { return XCTFail("expected PNG data") }
        XCTAssertFalse(you.isEmpty)
    }

    private func distinctColours(_ image: CGImage) -> Int {
        let width = image.width, height = image.height
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        let context = CGContext(data: &pixels, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
                                space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        context?.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        var colours = Set<UInt32>()
        for index in stride(from: 0, to: pixels.count, by: 4 * 7) {
            colours.insert(UInt32(pixels[index]) << 16 | UInt32(pixels[index + 1]) << 8 | UInt32(pixels[index + 2]))
        }
        return colours.count
    }
}
