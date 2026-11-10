import Foundation

// Pure progress curves for demo continuous parameters (spec §5: "continuous parameters are pure
// functions of t"). A scene that maps a beat's motion into `state(at:)` uses these so scrubbing,
// `freezeAt` captures and playback all show the same values.

public extension AnimationSpec {
    /// The fraction (0 → 1) of a move this animation has covered `elapsed` after it starts.
    ///
    /// Springs follow the closed-form step response of a damped harmonic oscillator with
    /// `ω₀ = 2π / response`, the same model SwiftUI's `.spring(response:dampingFraction:)` uses, so
    /// underdamped springs overshoot past 1 before settling. Timing curves use SwiftUI's cubic
    /// Bézier control points (easeIn 0.42/0/1/1, easeOut 0/0/0.58/1, easeInOut 0.42/0/0.58/1).
    /// Returns 0 before the start and 1 for `.none` from the start.
    func progress(at elapsed: Duration) -> Double {
        let t = elapsed.secondsValue
        guard t > 0 else { return 0 }
        switch self {
        case .none:
            return 1
        case .linear(let duration):
            return duration > 0 ? min(1, t / duration) : 1
        case .easeIn(let duration):
            return Self.bezier(t, duration, 0.42, 0, 1, 1)
        case .easeOut(let duration):
            return Self.bezier(t, duration, 0, 0, 0.58, 1)
        case .easeInOut(let duration):
            return Self.bezier(t, duration, 0.42, 0, 0.58, 1)
        case .spring(let response, let damping):
            guard response > 0, damping > 0 else { return 1 }
            let omega = 2 * Double.pi / response
            if damping < 1 {
                let decay = damping * omega
                let omegaD = omega * (1 - damping * damping).squareRoot()
                return 1 - exp(-decay * t) * (cos(omegaD * t) + decay / omegaD * sin(omegaD * t))
            }
            if damping == 1 {
                return 1 - exp(-omega * t) * (1 + omega * t)
            }
            // Overdamped: two real roots r1, r2 < 0.
            let root = (damping * damping - 1).squareRoot()
            let r1 = -omega * (damping - root), r2 = -omega * (damping + root)
            return 1 - (r2 * exp(r1 * t) - r1 * exp(r2 * t)) / (r2 - r1)
        }
    }

    /// `progress(at:)` with the elapsed time given in seconds.
    func progress(seconds elapsed: Double) -> Double {
        progress(at: .seconds(elapsed))
    }

    /// Cubic Bézier timing curve from (0,0) to (1,1) with control points (x1, y1), (x2, y2).
    private static func bezier(_ t: Double, _ duration: Double, _ x1: Double, _ y1: Double, _ x2: Double, _ y2: Double) -> Double {
        guard duration > 0 else { return 1 }
        let x = min(1, t / duration)
        if x >= 1 { return 1 }
        func coordinate(_ s: Double, _ p1: Double, _ p2: Double) -> Double {
            let u = 1 - s
            return 3 * u * u * s * p1 + 3 * u * s * s * p2 + s * s * s
        }
        // x(s) is monotone for these control points: bisect for the curve parameter.
        var low = 0.0, high = 1.0
        for _ in 0..<40 {
            let mid = (low + high) / 2
            if coordinate(mid, x1, x2) < x { low = mid } else { high = mid }
        }
        return coordinate((low + high) / 2, y1, y2)
    }
}
