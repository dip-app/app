import DIPCore
import SwiftUI

/// The demo finger (spec §3.0 `ghost`): a 44 canvas-pt ink circle at 16% opacity. It never animates on its
/// own; scenes place it from `GhostState`, which is a pure function of t so it scrubs.
struct GhostTouch: View {
    let ghost: GhostState

    var body: some View {
        Circle()
            .fill(OnboardingTheme.ink.opacity(0.16))
            .frame(width: GhostMotion.diameter, height: GhostMotion.diameter)
            .scaleEffect(ghost.scale)
            .opacity(ghost.opacity)
            .position(ghost.position.cgPoint)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

struct GhostState: Equatable, Sendable {
    var position: DemoPoint
    var scale: Double = 1
    var opacity: Double = 1
}

/// The ghost's motion vocabulary as pure functions of elapsed time.
enum GhostMotion {
    static let diameter: CGFloat = 44
    /// Travel: a quad curve over 0.45 s easeInOut.
    static let travel = OnboardingAnimation.ghost
    /// Press: scale 1 → 0.86 → 1 over 0.22 s.
    static let pressDuration = 0.22
    static let pressDepth = 0.14
    /// Appearing and lifting off are short fades.
    static let fadeDuration = 0.15

    /// The press scale `elapsed` seconds after the press starts (1 outside the press).
    static func pressScale(_ elapsed: Double, depth: Double = pressDepth) -> Double {
        guard elapsed > 0, elapsed < pressDuration else { return 1 }
        return 1 - depth * sin(Double.pi * elapsed / pressDuration)
    }

    /// A point on the travel curve from `start` to `end` after `elapsed` seconds. The control point is
    /// lifted perpendicular to the chord (a quarter of its length), so the finger arcs like a hand.
    static func travelPoint(from start: DemoPoint, to end: DemoPoint, elapsed: Double) -> DemoPoint {
        let u = travel.progress(seconds: elapsed)
        let dx = end.x - start.x, dy = end.y - start.y
        let control = DemoPoint((start.x + end.x) / 2 + dy * 0.25, (start.y + end.y) / 2 - dx * 0.25)
        let a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, c = u * u
        return DemoPoint(a * start.x + b * control.x + c * end.x, a * start.y + b * control.y + c * end.y)
    }

    /// Fade-in progress `elapsed` seconds after appearing.
    static func fadeIn(_ elapsed: Double) -> Double { min(1, max(0, elapsed / fadeDuration)) }
    /// Remaining opacity `elapsed` seconds after lifting off.
    static func fadeOut(_ elapsed: Double) -> Double { 1 - fadeIn(elapsed) }
}
