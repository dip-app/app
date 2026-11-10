import Foundation

// Pure demo timelines for the onboarding Stage (spec §3.0 demo rules, §5 Files and Tests).
// No SwiftUI here: the app maps `AnimationSpec` to `Animation` and renders `state(at:)`.

/// A SwiftUI-free description of how a beat animates.
public enum AnimationSpec: Hashable, Sendable {
    /// `.spring(response:dampingFraction:)`.
    case spring(response: Double, dampingFraction: Double)
    case easeIn(duration: Double)
    case easeOut(duration: Double)
    case easeInOut(duration: Double)
    case linear(duration: Double)
    /// Applied without animation.
    case none

    /// The residual fraction of the move a spring has left once it is considered settled.
    ///
    /// The spec's "settles in" column (§3.0) matches this threshold (0.01%) and SwiftUI's
    /// `Spring.settlingDuration`, not a literal 1% band: a 1% band would put `stage` at
    /// ≈ 0.47 s instead of the ≈ 0.9 s the beat tables are built around.
    public static let springSettleThreshold = 1e-4

    /// When the animated value has landed, measured from the beat's start.
    ///
    /// Curves settle at their duration. An underdamped spring settles when its decay envelope
    /// `exp(−ζ·ω₀·t)` falls to `springSettleThreshold`, with `ω₀ = 2π / response`; this is within
    /// about 4% of SwiftUI's `Spring.settlingDuration` for every onboarding token. Critically or
    /// overdamped springs use the slowest decay rate of their closed-form solution.
    public var settleTime: Duration {
        switch self {
        case .none: return .zero
        case .easeIn(let duration), .easeOut(let duration), .easeInOut(let duration), .linear(let duration):
            return .seconds(max(0, duration))
        case .spring(let response, let damping):
            guard response > 0, damping > 0 else { return .zero }
            let omega = 2 * Double.pi / response
            let rate = damping < 1 ? damping * omega : omega * (damping - (damping * damping - 1).squareRoot())
            return .seconds(-log(Self.springSettleThreshold) / rate)
        }
    }
}

/// The onboarding motion tokens that drive geometry (spec §3.0 Motion tokens), as plain specs.
/// The app's `OnboardingMotion` maps each to a SwiftUI `Animation`.
public enum OnboardingAnimation {
    /// Stage frame and fill, zooms, sheet moves.
    public static let stage = AnimationSpec.spring(response: 0.55, dampingFraction: 0.86)
    /// Card → page expansions inside the canvas.
    public static let expand = AnimationSpec.spring(response: 0.50, dampingFraction: 0.86)
    /// Faces joining, chips, pops.
    public static let hop = AnimationSpec.spring(response: 0.36, dampingFraction: 0.62)
    /// Every outgoing title and body.
    public static let copyOut = AnimationSpec.easeIn(duration: 0.18)
    /// Bar title and fill changes (`DIPMotion.navigation`).
    public static let bar = AnimationSpec.easeOut(duration: 0.3)
    /// Bar icon circle (`DIPMotion.affordance`).
    public static let affordance = AnimationSpec.spring(response: 0.45, dampingFraction: 0.68)
    /// Tab marker (`DIPMotion.marker`).
    public static let marker = AnimationSpec.spring(response: 0.38, dampingFraction: 0.82)
    /// The ghost finger's travel.
    public static let ghost = AnimationSpec.easeInOut(duration: 0.45)
}

/// One discrete change in a demo.
///
/// `moves` names the elements whose geometry the beat changes; `targets` names the elements the
/// beat aims at or anchors to (a ghost press, a zoom anchor). The timing rule uses both.
public struct DemoBeat<Action: Sendable>: Sendable {
    public var at: Duration
    public var action: Action
    public var animation: AnimationSpec
    public var moves: Set<String>
    public var targets: Set<String>
    public var label: String

    public init(
        at: Duration, action: Action, animation: AnimationSpec = .none,
        moves: Set<String> = [], targets: Set<String> = [], label: String = ""
    ) {
        self.at = at
        self.action = action
        self.animation = animation
        self.moves = moves
        self.targets = targets
        self.label = label
    }
}

/// A problem found by `DemoScript.validate()`.
public enum DemoScriptIssue: Equatable, Sendable {
    /// A beat aims at an element an earlier beat is still moving (spec §3.0 Timing rule).
    case startsBeforeSettle(beat: String, element: String, earlier: String, earliestStart: Duration)
    case beatOutsideTimeline(beat: String)
    case stillOutsideTimeline(Duration)
    case stillsNotOrdered
}

/// A deterministic demo: an initial state, discrete beats folded in time order, and optional
/// continuous parameters that are pure functions of `t`.
///
/// `state(at:)` is the single source of truth for playback, scrubbing, `freezeAt` captures,
/// Reduce Motion stills and the final rest frame.
public struct DemoScript<State: Sendable>: Sendable {
    public typealias Mutation = @Sendable (inout State) -> Void
    public typealias Continuous = @Sendable (inout State, Duration) -> Void

    /// 1 pt of horizontal drag scrubs this much time (spec §3.0 demo rules).
    public static var scrubTimePerPoint: Duration { .milliseconds(12) }

    public let initial: State
    /// Sorted by `at`; beats at the same time keep their declared order.
    public let beats: [DemoBeat<Mutation>]
    /// The rest time; the demo shows `state(at: duration)` afterwards.
    public let duration: Duration
    /// Reduce Motion stills, as times into the timeline.
    public let stills: [Duration]
    private let continuous: Continuous?

    public init(
        initial: State, duration: Duration, beats: [DemoBeat<Mutation>],
        stills: [Duration] = [], continuous: Continuous? = nil
    ) {
        self.initial = initial
        self.duration = duration
        self.beats = beats.enumerated()
            .sorted { $0.element.at == $1.element.at ? $0.offset < $1.offset : $0.element.at < $1.element.at }
            .map(\.element)
        self.stills = stills
        self.continuous = continuous
    }

    /// Builds a script from value-typed actions and a reducer, which keeps beats inspectable in tests.
    public init<Action: Sendable>(
        initial: State, duration: Duration, beats: [DemoBeat<Action>], stills: [Duration] = [],
        reduce: @escaping @Sendable (inout State, Action) -> Void, continuous: Continuous? = nil
    ) {
        let mapped = beats.map { beat -> DemoBeat<Mutation> in
            let action = beat.action
            return DemoBeat(
                at: beat.at, action: { reduce(&$0, action) }, animation: beat.animation,
                moves: beat.moves, targets: beat.targets, label: beat.label)
        }
        self.init(initial: initial, duration: duration, beats: mapped, stills: stills, continuous: continuous)
    }

    /// The state at `t`: every beat with `at <= t` applied in order to `initial`, then the
    /// continuous parameters evaluated at `t`. `t` is clamped to `0...duration`.
    public func state(at t: Duration) -> State {
        let time = clamp(t)
        var state = initial
        for beat in beats where beat.at <= time {
            beat.action(&state)
        }
        continuous?(&state, time)
        return state
    }

    /// The resting frame.
    public var finalState: State { state(at: duration) }

    /// The Reduce Motion stills.
    public var stillStates: [State] { stills.map(state(at:)) }

    /// Beats that fire when playback advances from `start` to `end`: `start < at <= end`.
    /// Playback applies `state(at: start)` first, so a beat at exactly `start` is already in it.
    /// Empty when `end <= start` (scrubbing backwards re-renders `state(at:)` instead).
    public func beats(between start: Duration, and end: Duration) -> [DemoBeat<Mutation>] {
        guard end > start else { return [] }
        return beats.filter { $0.at > start && $0.at <= end }
    }

    /// The time after scrubbing `points` of horizontal drag from `start`, clamped to the timeline.
    public func scrubbedTime(from start: Duration, dragging points: Double) -> Duration {
        clamp(start + Self.scrubTimePerPoint * points)
    }

    /// Checks the script against the spec's rules. An empty result means the script is valid.
    ///
    /// Timing rule (§3.0): a beat that targets an element moved by an earlier beat starts no
    /// earlier than that beat's start plus its animation's `settleTime`. Beats that only
    /// animate other properties may overlap.
    public func validate() -> [DemoScriptIssue] {
        var issues: [DemoScriptIssue] = []
        for (index, beat) in beats.enumerated() {
            if beat.at < .zero || beat.at > duration {
                issues.append(.beatOutsideTimeline(beat: name(of: beat, index)))
            }
            for (earlierIndex, earlier) in beats[..<index].enumerated() {
                for element in earlier.moves.intersection(beat.targets).sorted() {
                    let earliestStart = earlier.at + earlier.animation.settleTime
                    if beat.at < earliestStart {
                        issues.append(.startsBeforeSettle(
                            beat: name(of: beat, index), element: element,
                            earlier: name(of: earlier, earlierIndex), earliestStart: earliestStart))
                    }
                }
            }
        }
        for still in stills where still < .zero || still > duration {
            issues.append(.stillOutsideTimeline(still))
        }
        if zip(stills, stills.dropFirst()).contains(where: { $0 >= $1 }) {
            issues.append(.stillsNotOrdered)
        }
        return issues
    }

    private func name(of beat: DemoBeat<Mutation>, _ index: Int) -> String {
        beat.label.isEmpty ? "beat \(index)" : beat.label
    }

    private func clamp(_ t: Duration) -> Duration {
        min(max(t, .zero), duration)
    }
}

public extension Duration {
    /// The duration in seconds, for mapping a timeline position to a continuous parameter.
    var secondsValue: Double {
        let parts = components
        return Double(parts.seconds) + Double(parts.attoseconds) / 1e18
    }
}
