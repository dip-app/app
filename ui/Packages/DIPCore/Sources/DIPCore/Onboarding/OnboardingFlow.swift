import Foundation

/// The tour's navigation state machine (spec §2 Persistence, §5 Files).
///
/// A value type: every transition returns the next flow plus the side effects the host must
/// perform (`.persist` through an `OnboardingRecordStore`, `.announce` through VoiceOver).
/// It never reads clocks, defaults or flags itself, so every rule is unit-testable.
///
/// Persistence rules:
/// - `next()` writes `lastStep` = the step that just began (the previous one has settled).
/// - The outcome is written the moment handoff starts (`beginHandoff()`, `next()` on the
///   last step, `skip()`), so a kill during the reveal never shows the tour again.
/// - `back()` writes nothing; a relaunch resumes at the furthest settled step.
/// - `.replay` never emits `.persist`.
public struct OnboardingFlow: Equatable, Sendable {
    public enum Mode: Equatable, Sendable {
        /// The once-per-account tour after membership resolves. Starts at B0 and persists.
        case firstRun
        /// "How DIP works" from Profile. Starts at B1 and never persists.
        case replay
    }

    public enum Phase: Equatable, Sendable {
        case step(OnboardingStep)
        /// The H reveal has started. Terminal: every later transition is a no-op.
        case handoff(OnboardingOutcome)
    }

    public enum Effect: Equatable, Sendable {
        case persist(OnboardingRecord)
        case announce(String)
    }

    public typealias Transition = (flow: OnboardingFlow, effects: [Effect])

    public let mode: Mode
    public let features: OnboardingFeatures
    /// The steps shown in this run, in order. Never empty.
    public let steps: [OnboardingStep]
    public private(set) var phase: Phase

    /// A fresh flow at the first available step. Emits no effects: nothing is written until
    /// the first step settles.
    public init(mode: Mode, features: OnboardingFeatures, catalogEmpty: Bool = false) {
        self.mode = mode
        self.features = features
        steps = OnboardingStep.availableSteps(
            features: features, catalogEmpty: catalogEmpty, includeArrival: mode == .firstRun)
        phase = .step(steps[0])
    }

    /// Restores a first-run flow from a stored record.
    ///
    /// - No record, or a record from another version: starts fresh at B0.
    /// - `lastStep` still available: resumes there (demos restart at t = 0, a UI concern).
    /// - `lastStep` removed by the current flags: clamps forward to the next available step
    ///   in tour order, or to the last available step when none follows.
    /// - A completed record: returns a flow already in handoff. Hosts should check
    ///   `OnboardingRecordStore.isComplete(uid:)` first and not show the tour at all.
    public static func resume(
        record: OnboardingRecord?, features: OnboardingFeatures, catalogEmpty: Bool = false
    ) -> OnboardingFlow {
        var flow = OnboardingFlow(mode: .firstRun, features: features, catalogEmpty: catalogEmpty)
        guard let record, record.isSupported else { return flow }
        if let outcome = record.outcome {
            flow.phase = .handoff(outcome)
            return flow
        }
        guard let stored = record.lastStep else { return flow }
        flow.phase = .step(flow.clamped(stored))
        return flow
    }

    // MARK: Derived state

    /// The current step, or `nil` once handoff has started.
    public var currentStep: OnboardingStep? {
        if case .step(let step) = phase { return step }
        return nil
    }

    public var isHandingOff: Bool { currentStep == nil }

    /// Back is shown on B1–B5 but not on the first step of the run.
    public var canGoBack: Bool {
        guard let index = currentIndex else { return false }
        return index > 0
    }

    /// The header "Skip" is shown on B0–B4 (B5 offers "Skip for now", which maps to `next()`).
    public var showsSkip: Bool {
        guard let currentStep else { return false }
        return currentStep != .interests
    }

    /// "Step n of m" for the header pill and crew stack, counting B1 onwards. `nil` on B0
    /// (no pill) and during handoff.
    public var progress: (number: Int, count: Int)? {
        guard let currentStep, currentStep != .arrival else { return nil }
        let numbered = steps.filter { $0 != .arrival }
        guard let index = numbered.firstIndex(of: currentStep) else { return nil }
        return (index + 1, numbered.count)
    }

    /// Faces in the crew stack: You (from B1 on) plus one host per completed B1–B4 step.
    public var crewStackCount: Int {
        guard let index = currentIndex else { return 1 + steps.filter(\.hasHostFace).count }
        let current = steps[index]
        if current == .arrival { return 0 }
        return 1 + steps[..<index].filter(\.hasHostFace).count
    }

    private var currentIndex: Int? {
        currentStep.flatMap { steps.firstIndex(of: $0) }
    }

    // MARK: Transitions

    /// The step CTA. On the last step this starts handoff with `.finished`.
    public func next(at date: Date = Date()) -> Transition {
        guard let index = currentIndex else { return (self, []) }
        guard index + 1 < steps.count else { return beginHandoff(at: date) }
        var flow = self
        let step = steps[index + 1]
        flow.phase = .step(step)
        return (flow, persisting([.persist(.init(lastStep: step, outcome: nil, updatedAt: date))])
            + [.announce(flow.announcement(for: step))])
    }

    /// Returns to the previous step. A no-op on the first step and during handoff.
    public func back() -> Transition {
        guard let index = currentIndex, index > 0 else { return (self, []) }
        var flow = self
        let step = steps[index - 1]
        flow.phase = .step(step)
        return (flow, [.announce(flow.announcement(for: step))])
    }

    /// The header "Skip" (or "Done" in replay): starts handoff with `.skipped`.
    public func skip(at date: Date = Date()) -> Transition {
        handoff(.skipped, at: date)
    }

    /// Starts the H reveal with `.finished` (the B5 CTA). Idempotent once handoff started.
    public func beginHandoff(at date: Date = Date()) -> Transition {
        handoff(.finished, at: date)
    }

    private func handoff(_ outcome: OnboardingOutcome, at date: Date) -> Transition {
        guard let step = currentStep else { return (self, []) }
        var flow = self
        flow.phase = .handoff(outcome)
        return (flow, persisting([.persist(.init(lastStep: step, outcome: outcome, updatedAt: date))]))
    }

    private func persisting(_ effects: [Effect]) -> [Effect] {
        mode == .replay ? [] : effects
    }

    private func clamped(_ stored: OnboardingStep) -> OnboardingStep {
        if steps.contains(stored) { return stored }
        let order = OnboardingStep.allCases
        let storedIndex = order.firstIndex(of: stored)!
        return steps.first { order.firstIndex(of: $0)! > storedIndex } ?? steps[steps.count - 1]
    }

    // MARK: Announcements

    /// The VoiceOver announcement for arriving on a step, e.g. "Step 2 of 5, Who's going".
    /// Localized through the app's String Catalog when it carries these keys.
    public func announcement(for step: OnboardingStep) -> String {
        let title = step.pillTitle
        var copy = self
        copy.phase = .step(step)
        guard let progress = copy.progress else { return title }
        return String(localized: "Step \(progress.number) of \(progress.count), \(title)")
    }
}

public extension OnboardingStep {
    /// The header pill copy (spec §3). B0 has no pill; its title is used only for announcements.
    var pillTitle: String {
        switch self {
        case .arrival: String(localized: "onboarding.pill.arrival", defaultValue: "You're in")
        case .discover: String(localized: "onboarding.pill.discover", defaultValue: "Find events")
        case .people: String(localized: "onboarding.pill.people", defaultValue: "Who's going")
        case .challenges: String(localized: "onboarding.pill.challenges", defaultValue: "Challenges")
        case .memories: String(localized: "onboarding.pill.memories", defaultValue: "Memories")
        case .interests: String(localized: "onboarding.pill.interests", defaultValue: "Interests")
        }
    }
}
