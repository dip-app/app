import DIPCore
import SwiftUI

/// One onboarding demo (spec §5): a deterministic `DemoScript` plus a pure render of its state on the
/// fixed 390 × 540 canvas. `DemoStage` owns playback, scrubbing, stills and accessibility; a scene only
/// describes what is shown at time t.
///
/// Rules for scene authors (spec §3.0, §6):
/// - Discrete changes are beats; each beat declares `moves` / `targets` so `script.validate()` can check
///   the timing rule. Scene tests assert `script.validate() == []`.
/// - Values that move during a beat and must scrub (reveal masks, offsets, ghost travel, presses) are
///   continuous: pure functions of t in `applyContinuous`, also passed to the script as `continuous:`.
/// - `canvas(_:)` is a pure function of state: no `KeyframeAnimator`, `ScrollView` scrolling, timers
///   or repositories. It receives fixture values and no-op closures only.
@MainActor
protocol DemoScene {
    associatedtype State: Sendable
    associatedtype Canvas: View

    /// Identifier for debug overrides such as `-onboarding.freezeAt discover@3.8`.
    static var id: String { get }

    var script: DemoScript<State> { get }

    /// Writes the continuous parameters for time `t` into `state`. Must be the same function the script
    /// folds after its beats, so `script.state(at:)` and live playback agree.
    func applyContinuous(_ state: inout State, at t: Duration)

    /// VoiceOver value of the Stage element ("Example: …").
    var description: String { get }

    /// The Crew member perched on the Stage's top edge for this step (tour shell, spec §4.2).
    var hostFace: CrewMember { get }

    /// The Stage fill colour the canvas develops from (spec §4.3).
    var stageFill: Color { get }

    /// Reduce Motion stills, as times into the timeline. Defaults to `script.stills`.
    var reducedStills: [Duration] { get }

    /// The rows that replace the Stage at accessibility text sizes (spec §5 Accessibility-size layouts).
    var accessibilityRows: [DemoAccessibilityRow] { get }

    /// Renders or decodes anything the canvas needs (Crew PNGs) before it is first drawn. `DemoStage` calls
    /// this outside a view update, then draws the canvas. Defaults to nothing.
    func prepare()

    /// The canvas for a state, laid out in 390 × 540 canvas points.
    @ViewBuilder func canvas(_ state: State) -> Canvas
}

extension DemoScene {
    var finalState: State { script.finalState }
    var reducedStills: [Duration] { script.stills }
    func prepare() {}
}

/// An SF Symbol row shown instead of the Stage at accessibility sizes.
struct DemoAccessibilityRow: Hashable, Sendable {
    let systemImage: String
    let text: String
}

/// The fixed logical canvas every demo is drawn on (spec §3.0).
enum DemoCanvas {
    static let size = CGSize(width: 390, height: 540)
    static let cornerRadius: CGFloat = 23
    /// The mini bar follows the app's rule: centre at height − 61 (canvas y 439–519).
    static let barCenterY: CGFloat = 540 - 61
}

/// A canvas-space point that is `Sendable` and `Equatable` for scene state.
struct DemoPoint: Equatable, Sendable {
    var x: Double
    var y: Double
    init(_ x: Double, _ y: Double) { self.x = x; self.y = y }
    var cgPoint: CGPoint { CGPoint(x: x, y: y) }
}

extension AnimationSpec {
    /// The SwiftUI animation for this spec, sped up by `speed` (the `-onboarding.timeScale` override).
    func swiftUI(speed: Double = 1) -> Animation? {
        let animation: Animation
        switch self {
        case .none: return nil
        case .spring(let response, let damping): animation = .spring(response: response, dampingFraction: damping)
        case .easeIn(let duration): animation = .easeIn(duration: duration)
        case .easeOut(let duration): animation = .easeOut(duration: duration)
        case .easeInOut(let duration): animation = .easeInOut(duration: duration)
        case .linear(let duration): animation = .linear(duration: duration)
        }
        return speed == 1 ? animation : animation.speed(speed)
    }
}
