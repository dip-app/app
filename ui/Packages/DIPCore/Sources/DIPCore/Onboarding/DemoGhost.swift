import Foundation

// The demo finger as a pure function of t (spec §3.0 `ghost`), shared by the B2–B4 timelines.
// Same vocabulary as the app's `GhostMotion` (B1): travel 0.45 s easeInOut on an arc, press
// 1 → 0.86 → 1 over 0.22 s, appear and lift off with 0.15 s fades.

/// A canvas-space point (390 × 540 logical canvas).
public struct DemoCoordinate: Equatable, Sendable {
    public var x: Double
    public var y: Double
    public init(_ x: Double, _ y: Double) { self.x = x; self.y = y }

    /// Linear interpolation towards `other`.
    public func lerp(_ other: DemoCoordinate, _ u: Double) -> DemoCoordinate {
        DemoCoordinate(x + (other.x - x) * u, y + (other.y - y) * u)
    }
}

/// Where the ghost is drawn at one instant.
public struct DemoGhostState: Equatable, Sendable {
    public var position: DemoCoordinate
    public var scale: Double
    public var opacity: Double
    public init(position: DemoCoordinate, scale: Double = 1, opacity: Double = 1) {
        self.position = position
        self.scale = scale
        self.opacity = opacity
    }
}

/// One visit of the ghost: it appears (or travels in from `from`), presses `target`, then lifts off.
public struct DemoGhostVisit: Equatable, Sendable {
    public var appearAt: Double
    public var from: DemoCoordinate?
    public var target: DemoCoordinate
    public var pressAt: Double

    public init(appearAt: Double, from: DemoCoordinate? = nil, target: DemoCoordinate, pressAt: Double) {
        self.appearAt = appearAt
        self.from = from
        self.target = target
        self.pressAt = pressAt
    }

    /// When the ghost has fully lifted off.
    public var endsAt: Double { pressAt + DemoGhost.pressDuration + DemoGhost.fadeDuration }
}

public enum DemoGhost {
    public static let travel = OnboardingAnimation.ghost
    public static let pressDuration = 0.22
    public static let pressDepth = 0.14
    public static let fadeDuration = 0.15

    /// The press scale `elapsed` seconds after the press starts (1 outside the press).
    public static func pressScale(_ elapsed: Double, depth: Double = pressDepth) -> Double {
        guard elapsed > 0, elapsed < pressDuration else { return 1 }
        return 1 - depth * sin(Double.pi * elapsed / pressDuration)
    }

    /// A point on an arc from `start` to `end`, `elapsed` seconds into the travel.
    public static func travelPoint(from start: DemoCoordinate, to end: DemoCoordinate, elapsed: Double) -> DemoCoordinate {
        let u = travel.progress(seconds: elapsed)
        let dx = end.x - start.x, dy = end.y - start.y
        let control = DemoCoordinate((start.x + end.x) / 2 + dy * 0.25, (start.y + end.y) / 2 - dx * 0.25)
        let a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, c = u * u
        return DemoCoordinate(a * start.x + b * control.x + c * end.x, a * start.y + b * control.y + c * end.y)
    }

    /// The ghost at `t` for a sequence of visits, or nil when no visit is on screen.
    public static func state(at t: Double, visits: [DemoGhostVisit]) -> DemoGhostState? {
        for visit in visits where t >= visit.appearAt && t < visit.endsAt {
            let lift = visit.pressAt + pressDuration
            let opacity: Double
            if t >= lift {
                opacity = 1 - min(1, (t - lift) / fadeDuration)
            } else if visit.from != nil {
                opacity = 1
            } else {
                opacity = min(1, (t - visit.appearAt) / fadeDuration)
            }
            let position = visit.from.map { travelPoint(from: $0, to: visit.target, elapsed: t - visit.appearAt) }
                ?? visit.target
            return DemoGhostState(position: position, scale: pressScale(t - visit.pressAt), opacity: max(0, opacity))
        }
        return nil
    }
}

/// Small helpers for continuous parameters.
public enum DemoProgress {
    /// `spec.progress` started at `start`, clamped to 0...1 (springs may overshoot; use `raw` for that).
    public static func clamped(_ spec: AnimationSpec, _ t: Double, from start: Double) -> Double {
        min(1, max(0, spec.progress(seconds: t - start)))
    }

    /// Like `clamped`, but an underdamped spring holds at 1 once it first reaches it instead of dipping
    /// back after the overshoot, so sizes that only grow (a whitening layer, a reveal) stay monotone.
    public static func monotone(_ spec: AnimationSpec, _ t: Double, from start: Double) -> Double {
        if case .spring(let response, let damping) = spec, damping < 1, response > 0 {
            let omega = 2 * Double.pi / response
            let decay = damping * omega
            let omegaD = omega * (1 - damping * damping).squareRoot()
            // x(t) = 1 − e^(−at)(cos ω_d t + a/ω_d sin ω_d t) first reaches 1 where tan ω_d t = −ω_d / a.
            let firstCrossing = (Double.pi - atan(omegaD / decay)) / omegaD
            if t - start >= firstCrossing { return 1 }
        }
        return clamped(spec, t, from: start)
    }

    /// A callout's appearance (`hop` entrance, scale 0.8 → 1 with overshoot) multiplied by its
    /// `.easeIn(0.15)` exit, so the whole life of a callout scrubs.
    public static func callout(_ t: Double, enter: Double, exit: Double?) -> Double {
        guard t > enter else { return 0 }
        let appear = OnboardingAnimation.hop.progress(seconds: t - enter)
        guard let exit, t > exit else { return appear }
        return appear * (1 - clamped(.easeIn(duration: 0.15), t, from: exit))
    }
}
