import DIPCore
import SwiftUI
import XCTest
@testable import DIP

/// SwiftUI's settle time for a P0 `AnimationSpec` (spec §5 "Beat timing — the binding gate").
private func swiftUISettle(_ spec: AnimationSpec) -> Double {
    switch spec {
    case .spring(let response, let dampingFraction):
        return Spring(response: response, dampingRatio: dampingFraction).settlingDuration
    case .easeIn(let duration), .easeOut(let duration), .easeInOut(let duration), .linear(let duration):
        return duration
    case .none:
        return 0
    }
}

private func assertBeatsSettle<State>(_ script: DemoScript<State>, name: String,
                                      file: StaticString = #filePath, line: UInt = #line) {
    // The engine's own check (its estimate runs below SwiftUI's) must pass too.
    XCTAssertEqual(script.validate(), [], "\(name): DemoScript.validate()", file: file, line: line)
    for (index, beat) in script.beats.enumerated() {
        for earlier in script.beats[..<index] {
            for element in earlier.moves.intersection(beat.targets).sorted() {
                let earliest = earlier.at.secondsValue + swiftUISettle(earlier.animation)
                // 1e-9 absorbs Duration/Double rounding only; it isn't a timing tolerance.
                XCTAssertGreaterThanOrEqual(
                    beat.at.secondsValue + 1e-9, earliest,
                    "\(name): \(beat.label) targets \(element) before \(earlier.label) settles",
                    file: file, line: line)
            }
        }
    }
}

@MainActor
final class DemoTimingTests: XCTestCase {
    func testDiscoverJoin() { assertBeatsSettle(DiscoverJoinScene().script, name: "B1") }

    func testPeople() {
        assertBeatsSettle(PeopleInviteScene(features: .all).script, name: "B2")
        assertBeatsSettle(PeopleInviteScene(features: []).script, name: "B2 without invites")
    }

    func testChallenges() {
        assertBeatsSettle(ChallengeScene(features: .all).script, name: "B3")
        assertBeatsSettle(ChallengeScene(features: [.challenges]).script, name: "B3 without points")
    }

    func testMemories() { assertBeatsSettle(MemoriesScene().script, name: "B4") }

    /// The engine's estimate stays within [0.9, 1] × SwiftUI's settle for every onboarding token (spec §5).
    func testEngineSettleEstimateRunsBelowSwiftUI() {
        let tokens: [AnimationSpec] = [OnboardingAnimation.stage, OnboardingAnimation.expand, OnboardingAnimation.hop,
                                       OnboardingAnimation.affordance, OnboardingAnimation.marker, MemoriesTimeline.section]
        for token in tokens {
            let engine = token.settleTime.secondsValue, swiftUI = swiftUISettle(token)
            XCTAssertLessThanOrEqual(engine, swiftUI + 1e-9, "\(token)")
            XCTAssertGreaterThanOrEqual(engine, 0.9 * swiftUI, "\(token)")
        }
    }

    /// Final states and stills render (spec §5 Render checks).
    func testScenesRenderFinalStatesAndStills() {
        func render<Scene: DemoScene>(_ scene: Scene) {
            scene.prepare()
            for state in [scene.finalState] + scene.script.stillStates {
                let renderer = ImageRenderer(content: scene.canvas(state)
                    .frame(width: DemoCanvas.size.width, height: DemoCanvas.size.height))
                renderer.scale = 1
                XCTAssertNotNil(renderer.uiImage, "\(Scene.id) failed to render")
            }
        }
        render(PeopleInviteScene(features: .all))
        render(PeopleInviteScene(features: []))
        render(ChallengeScene(features: .all))
        render(MemoriesScene())
    }

    func testScenesDescribeThemselvesAndMatchTheirHosts() {
        XCTAssertEqual(PeopleInviteScene().hostFace, CrewMember.host(of: .people))
        XCTAssertEqual(ChallengeScene().hostFace, CrewMember.host(of: .challenges))
        XCTAssertEqual(MemoriesScene().hostFace, CrewMember.host(of: .memories))
        XCTAssertEqual(DiscoverJoinScene().hostFace, CrewMember.host(of: .discover))
        XCTAssertEqual(PeopleInviteScene(features: .all).accessibilityRows.count, 3)
        XCTAssertEqual(PeopleInviteScene(features: []).accessibilityRows.count, 2)
        XCTAssertEqual(ChallengeScene().accessibilityRows.count, 4)
        XCTAssertEqual(MemoriesScene().accessibilityRows.count, 3)
        XCTAssertFalse(PeopleInviteScene(features: []).description.contains("Priya"))
    }
}

final class WindowSheetTests: XCTestCase {
    func testWindowSheetInterpolatesHalfway() {
        let start = WindowSheet(window: CGRect(x: 20, y: 134, width: 362, height: 429), radius: 20)
        let end = WindowSheet(window: CGRect(x: 0, y: 0, width: 402, height: 874), radius: 0)
        var delta = end.animatableData
        delta -= start.animatableData
        delta.scale(by: 0.5)
        var data = start.animatableData
        data += delta
        var mid = start
        mid.animatableData = data
        XCTAssertEqual(mid.window, CGRect(x: 10, y: 67, width: 382, height: 651.5))
        XCTAssertEqual(mid.radius, 10, accuracy: 0.0001)
        let bounds = CGRect(x: 0, y: 0, width: 402, height: 874)
        XCTAssertFalse(mid.path(in: bounds).contains(CGPoint(x: 201, y: 400), eoFill: true)) // inside the hole
        XCTAssertTrue(mid.path(in: bounds).contains(CGPoint(x: 5, y: 5), eoFill: true))      // sheet
    }
}

private final class Box<Value>: @unchecked Sendable {
    var value: Value
    init(_ value: Value) { self.value = value }
}

/// An in-memory record store that counts writes.
private final class MemoryStore: OnboardingRecordStore, @unchecked Sendable {
    var records: [String: OnboardingRecord] = [:]
    var saves = 0
    func record(for uid: String) -> OnboardingRecord? { records[uid] }
    func save(_ record: OnboardingRecord, for uid: String) { records[uid] = record; saves += 1 }
}

@MainActor
final class OnboardingTourModelTests: XCTestCase {
    private let date = Date(timeIntervalSinceReferenceDate: 800_000_000)
    private func configuration(_ features: OnboardingFeatures = .all) -> OnboardingTourConfiguration {
        var configuration = OnboardingTourConfiguration()
        configuration.features = features
        configuration.timeScale = 100
        return configuration
    }

    func testFirstRunStartsFreshAndPersistsSettledSteps() {
        let store = MemoryStore()
        let announcements = Box<[String]>([])
        let date = self.date
        let model = OnboardingTourModel(mode: .firstRun, uid: "u1", store: store, configuration: configuration(),
                                        announce: { announcements.value.append($0) }, now: { date })
        XCTAssertEqual(model.entrance, .fresh)
        XCTAssertEqual(model.step, .arrival)
        XCTAssertEqual(model.stackMembers, [])
        model.next()
        XCTAssertEqual(model.step, .discover)
        XCTAssertEqual(store.records["u1"]?.lastStep, .discover)
        XCTAssertEqual(model.stackMembers, [.you])
        XCTAssertEqual(model.ctaTaps, 1)
        XCTAssertEqual(announcements.value.last, "Step 1 of 5, Find events")
        model.next()
        XCTAssertEqual(model.stackMembers, [.you, .host(.purple)])
        XCTAssertEqual(model.progressLabel, "Step 2 of 5, Who's going")
    }

    func testBackWritesNothingAndSkipFinishesWithSkipped() {
        let store = MemoryStore()
        let model = OnboardingTourModel(mode: .firstRun, uid: "u1", store: store, configuration: configuration())
        model.next(); model.next()
        let saves = store.saves
        model.back()
        XCTAssertEqual(model.step, .discover)
        XCTAssertEqual(model.direction, .back)
        XCTAssertEqual(store.saves, saves)
        model.skip()
        XCTAssertTrue(model.isHandingOff)
        XCTAssertEqual(store.records["u1"]?.outcome, .skipped)
        XCTAssertTrue(store.isComplete(uid: "u1"))
        // Every later input is a no-op.
        model.next(); model.back(); model.skip()
        XCTAssertEqual(store.records["u1"]?.outcome, .skipped)
    }

    func testResumeEntranceFromRecord() {
        let store = MemoryStore()
        store.records["u1"] = OnboardingRecord(lastStep: .memories, outcome: nil, updatedAt: date)
        let model = OnboardingTourModel(mode: .firstRun, uid: "u1", store: store, configuration: configuration())
        XCTAssertEqual(model.entrance, .resume(.memories))
        XCTAssertEqual(model.stackMembers, [.you, .host(.purple), .host(.yellow), .host(.white)],
                       "the resume entrance pre-fills the stack with the completed steps' hosts")
        // Another uid on the same device gets its own tour.
        let other = OnboardingTourModel(mode: .firstRun, uid: "u2", store: store, configuration: configuration())
        XCTAssertEqual(other.entrance, .fresh)
    }

    func testInterestsFinishWritesFinishedAndMarksYou() {
        let store = MemoryStore()
        store.records["u1"] = OnboardingRecord(lastStep: .interests, outcome: nil, updatedAt: date)
        let model = OnboardingTourModel(mode: .firstRun, uid: "u1", store: store, configuration: configuration())
        XCTAssertFalse(model.flow.showsSkip, "B5 offers Skip for now instead of the header Skip")
        model.finishInterests(saved: true)
        XCTAssertTrue(model.interestsSaved)
        XCTAssertEqual(store.records["u1"]?.outcome, .finished)
    }

    func testReplayNeverWritesAndSaysDone() {
        let store = MemoryStore()
        let model = OnboardingTourModel(mode: .replay, uid: "u1", store: store, configuration: configuration())
        XCTAssertEqual(model.entrance, .replay)
        XCTAssertEqual(model.step, .discover)
        XCTAssertEqual(model.flow.skipTitle, "Done")
        model.next(); model.skip()
        XCTAssertEqual(store.saves, 0)
    }

    func testShippingFeaturesDropChallenges() {
        let model = OnboardingTourModel(mode: .firstRun, uid: "u1", store: nil)
        XCTAssertEqual(model.flow.steps, [.arrival, .discover, .people, .memories, .interests])
        model.next(); model.next()
        XCTAssertEqual(model.nextStep, .memories)
        XCTAssertEqual(OnboardingCopy.cta(for: .people, next: model.nextStep, features: []), "And after the event?")
        XCTAssertEqual(OnboardingCopy.cta(for: .people, next: .challenges, features: .all), "What are challenges?")
    }

    func testHandoffWaitsForALoadingSurfaceThenReveals() async throws {
        let model = OnboardingTourModel(mode: .firstRun, uid: "u1", store: MemoryStore(), configuration: configuration())
        model.reportSurface(.activitiesLoading)
        let finished = Box(false)
        model.onFinished = { finished.value = true }
        model.skip()
        XCTAssertEqual(model.handoff, .none, "the handoff task has not run yet")
        try await Task.sleep(for: .milliseconds(10))
        XCTAssertEqual(model.handoff, .waiting)
        model.reportSurface(.ready)
        try await Task.sleep(for: .milliseconds(80))
        XCTAssertEqual(model.handoff == .revealing(.ready) || model.handoff == .finished, true)
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertEqual(model.handoff, .finished)
        XCTAssertTrue(finished.value)
    }

    func testHandoffGivesUpWaitingAfterTheLimit() async throws {
        let model = OnboardingTourModel(mode: .firstRun, uid: "u1", store: MemoryStore(), configuration: configuration())
        model.reportSurface(.shellLoading)
        model.skip()
        // 2.0 s at 100× is 20 ms.
        try await Task.sleep(for: .milliseconds(150))
        XCTAssertTrue(model.handoff == .revealing(.shellLoading) || model.handoff == .finished)
    }

    func testReadySurfaceRevealsWithoutWaiting() async throws {
        let model = OnboardingTourModel(mode: .firstRun, uid: "u1", store: MemoryStore(), configuration: configuration())
        model.reportSurface(.ready)
        model.skip()
        try await Task.sleep(for: .milliseconds(5))
        XCTAssertTrue(model.handoff == .revealing(.ready) || model.handoff == .finished)
        XCTAssertNotEqual(model.handoff, .waiting)
    }
}

final class OnboardingTourSettingsTests: XCTestCase {
    func testLaunchArgumentsParse() {
        var settings = OnboardingTourSettings(store: UserDefaultsOnboardingRecordStore(
            defaults: UserDefaults(suiteName: "onboarding.settings.tests")!))
        settings.apply(arguments: ["-onboarding.reset", "-onboarding.timeScale", "8", "-onboarding.reduceMotion",
                                   "-onboarding.resumeAt", "B3", "-onboarding.features", "all",
                                   "-onboarding.freezeAt", "people@2.1"])
        XCTAssertTrue(settings.resetRecord)
        XCTAssertEqual(settings.configuration.timeScale, 8)
        XCTAssertTrue(settings.configuration.forceReduceMotion)
        XCTAssertEqual(settings.resumeAt, .challenges)
        XCTAssertEqual(settings.configuration.features, .all)
        XCTAssertEqual(settings.configuration.demo(sceneID: "people").freezeAt?.secondsValue ?? 0, 2.1, accuracy: 1e-9)
        XCTAssertNil(settings.configuration.demo(sceneID: "discover").freezeAt)
        XCTAssertEqual(OnboardingTourSettings.step(named: "memories"), .memories)
    }

    func testPrepareResetsAndResumes() {
        let defaults = UserDefaults(suiteName: "onboarding.prepare.tests")!
        let store = UserDefaultsOnboardingRecordStore(defaults: defaults)
        store.save(OnboardingRecord(lastStep: .people, outcome: .skipped, updatedAt: Date()), for: "u1")
        XCTAssertFalse(OnboardingTourSettings(store: store).prepare(uid: "u1"), "a finished tour is never shown again")
        var reset = OnboardingTourSettings(store: store)
        reset.resetRecord = true
        XCTAssertTrue(reset.prepare(uid: "u1"))
        var resume = OnboardingTourSettings(store: store)
        resume.resumeAt = .memories
        XCTAssertTrue(resume.prepare(uid: "u1"))
        XCTAssertEqual(store.record(for: "u1")?.lastStep, .memories)
        defaults.removePersistentDomain(forName: "onboarding.prepare.tests")
    }

    func testCopyMatchesTheSpec() {
        XCTAssertEqual(OnboardingCopy.make(.arrival, firstName: "Sam", features: []).title, "You're in, Sam")
        XCTAssertEqual(OnboardingCopy.make(.arrival, firstName: " ", features: []).title, "You're in")
        XCTAssertEqual(OnboardingCopy.make(.arrival, firstName: nil, features: []).cta, "Show me around")
        XCTAssertEqual(OnboardingCopy.make(.people, firstName: nil, features: []).body,
                       "See who's going before you decide, by name and team.")
        XCTAssertTrue(OnboardingCopy.make(.people, firstName: nil, features: .invites).body.contains("Invite a coworker"))
        XCTAssertEqual(OnboardingCopy.make(.memories, firstName: nil, features: []).cta, "Make it yours")
    }
}
