import DIPCore
import Foundation
import Observation

/// Debug and host options for the tour (spec §5 UI tests). The defaults are what ships.
struct OnboardingTourConfiguration: Equatable, Sendable {
    /// Which beat-level and step-level features exist in this build (spec §2 flow map). The app ships
    /// none of F1–F5 yet, so B3 is dropped, B2 has no invite beats and B5 has no live reshape.
    var features: OnboardingFeatures = .shipping
    /// Speeds up step changes, demos and the handoff (`-onboarding.timeScale 8`).
    var timeScale: Double = 1
    /// Forces the Reduce Motion compositions (`-onboarding.reduceMotion`).
    var forceReduceMotion = false
    /// Renders the given step's demo frozen at a time (`-onboarding.freezeAt <scene>@<seconds>`).
    var freezeAt: (scene: String, time: Duration)?

    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.features == rhs.features && lhs.timeScale == rhs.timeScale
            && lhs.forceReduceMotion == rhs.forceReduceMotion
            && lhs.freezeAt?.scene == rhs.freezeAt?.scene && lhs.freezeAt?.time == rhs.freezeAt?.time
    }

    static let standard = OnboardingTourConfiguration()

    /// The demo configuration for one scene.
    func demo(sceneID: String) -> DemoStageConfiguration {
        var configuration = DemoStageConfiguration.standard
        configuration.timeScale = timeScale
        configuration.forceReduceMotion = forceReduceMotion
        if let freezeAt, freezeAt.scene == sceneID { configuration.freezeAt = freezeAt.time }
        return configuration
    }
}

extension OnboardingFeatures {
    /// Features the app has shipped. Add a flag here when its feature lands (F1–F5).
    static let shipping: OnboardingFeatures = []
}

/// The tour's state: the P0 `OnboardingFlow`, its persistence, and the handoff (spec §2, §3 H).
///
/// The view owns motion; this model owns what step is shown, what is written and when the tour ends.
@MainActor @Observable
final class OnboardingTourModel {
    enum Direction: Equatable { case forward, back }

    enum Handoff: Equatable {
        case none
        /// The Bar reads "Getting your events…" while a loading surface may still change.
        case waiting
        /// The window reveal is running over this surface.
        case revealing(OnboardingHomeSurface)
        /// The tour layer can be removed.
        case finished
    }

    private(set) var flow: OnboardingFlow
    let entrance: OnboardingEntrance
    let configuration: OnboardingTourConfiguration
    private(set) var direction = Direction.forward
    private(set) var handoff = Handoff.none
    /// What `DIPMemberHome` shows underneath; nil until the host reports it.
    private(set) var surface: OnboardingHomeSurface?
    /// Bumped on every CTA tap, for the light impact haptic (user taps only).
    private(set) var ctaTaps = 0
    /// You's 8 pt dot after a B5 save.
    private(set) var interestsSaved = false

    @ObservationIgnored private let uid: String
    @ObservationIgnored private let store: (any OnboardingRecordStore)?
    @ObservationIgnored private let announce: @MainActor (String) -> Void
    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private var handoffTask: Task<Void, Never>?
    @ObservationIgnored var onFinished: (() -> Void)?

    /// - Parameters:
    ///   - mode: `.firstRun` reads and writes the uid's record; `.replay` never touches it.
    ///   - store: nil only in previews that should never persist.
    init(
        mode: OnboardingFlow.Mode, uid: String, store: (any OnboardingRecordStore)?,
        configuration: OnboardingTourConfiguration = .standard, catalogEmpty: Bool = false,
        announce: @escaping @MainActor (String) -> Void = { _ in }, now: @escaping () -> Date = Date.init
    ) {
        self.uid = uid
        self.store = store
        self.configuration = configuration
        self.announce = announce
        self.now = now
        let record = mode == .firstRun ? store?.record(for: uid) : nil
        let start = OnboardingEntrance.start(
            mode: mode, record: record, features: configuration.features, catalogEmpty: catalogEmpty)
        flow = start.flow
        entrance = start.entrance
    }

    // MARK: Derived

    var step: OnboardingStep? { flow.currentStep }
    var isHandingOff: Bool { handoff != .none }
    var nextStep: OnboardingStep? {
        guard let step, let index = flow.steps.firstIndex(of: step), index + 1 < flow.steps.count else { return nil }
        return flow.steps[index + 1]
    }

    /// The members in the header stack: You (from B1 on) then hosts of completed steps.
    var stackMembers: [OnboardingStackMember] {
        guard let step, step != .arrival else { return [] }
        return [.you] + flow.completedHosts(before: step).compactMap { OnboardingStackMember(host: $0) }
    }

    /// "Step 2 of 5, Who's going" for the pill and stack element.
    var progressLabel: String? {
        guard let step, flow.progress != nil else { return nil }
        return flow.announcement(for: step)
    }

    // MARK: Inputs

    func reportSurface(_ surface: OnboardingHomeSurface) {
        self.surface = surface
    }

    /// The Bar CTA on B0–B4 (B5's Bar goes through `finishInterests`).
    func next() {
        guard !isHandingOff, step != nil else { return }
        ctaTaps += 1
        apply(flow.next(at: now()), direction: .forward)
    }

    func back() {
        guard !isHandingOff, flow.canGoBack else { return }
        apply(flow.back(), direction: .back)
    }

    /// Header Skip ("Done" in replay): handoff with `.skipped`.
    func skip() {
        guard !isHandingOff else { return }
        apply(flow.skip(at: now()), direction: .forward)
    }

    /// B5 finished (saved, unchanged or "Skip for now"): `next()` on the last step writes `.finished`.
    func finishInterests(saved: Bool) {
        guard !isHandingOff else { return }
        if saved { interestsSaved = true }
        apply(flow.next(at: now()), direction: .forward)
    }

    private func apply(_ transition: OnboardingFlow.Transition, direction: Direction) {
        self.direction = direction
        flow = transition.flow
        if flow.mode == .firstRun { store?.apply(transition.effects, uid: uid) }
        for case .announce(let text) in transition.effects { announce(text) }
        if flow.isHandingOff { startHandoff() }
    }

    // MARK: Handoff

    private func startHandoff() {
        guard handoff == .none else { return }
        let scale = max(0.01, configuration.timeScale)
        handoffTask = Task { @MainActor [weak self] in
            guard let self else { return }
            if OnboardingHandoff.shouldWait(for: surface) {
                handoff = .waiting
                let deadline = ContinuousClock.now + .seconds(OnboardingHandoff.waitLimit / scale)
                while OnboardingHandoff.shouldWait(for: surface), ContinuousClock.now < deadline {
                    try? await Task.sleep(for: .milliseconds(50))
                    if Task.isCancelled { return }
                }
            }
            // An unreported surface after the wait is treated as the shell still loading.
            handoff = .revealing(surface ?? .shellLoading)
            try? await Task.sleep(for: .seconds(OnboardingHandoff.removeAt / scale))
            if Task.isCancelled { return }
            handoff = .finished
            onFinished?()
        }
    }

    func cancel() {
        handoffTask?.cancel()
        handoffTask = nil
    }
}

/// One face in the header's Crew stack.
enum OnboardingStackMember: Hashable {
    case you
    case host(CrewMember)

    init?(host step: OnboardingStep) {
        guard let member = CrewMember.host(of: step) else { return nil }
        self = .host(member)
    }
}

extension CrewMember {
    /// The face perched on the Stage's top edge for a step (spec §4.2): B1 P, B2 Y, B3 W, B4 G.
    static func host(of step: OnboardingStep) -> CrewMember? {
        switch step {
        case .discover: .purple
        case .people: .yellow
        case .challenges: .white
        case .memories: .gray
        case .arrival, .interests: nil
        }
    }
}
