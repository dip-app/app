import DIPDesignSystem
import SwiftUI

/// Onboarding's motion vocabulary (spec v3 §3.0). `DIPMotion` stays the source for the shared bar.
///
/// "Settle" means SwiftUI's own `Spring(response:dampingRatio:).settlingDuration` (a residual of
/// about 0.01%, ≈ 1.47 × response ÷ damping). Timing curves settle at their stated duration.
enum OnboardingMotion {
    struct SpringSpec: Equatable, Sendable {
        let response: Double
        let damping: Double
        var animation: Animation { .spring(response: response, dampingFraction: damping) }
        /// SwiftUI's settle time for this spring.
        var settlingDuration: Double { Spring(response: response, dampingRatio: damping).settlingDuration }
    }

    /// Stage frame and fill, formations. Settles ≈ 0.94 s.
    static let stageSpec = SpringSpec(response: 0.55, damping: 0.86)
    /// Card → page expansions. Settles ≈ 0.85 s.
    static let expandSpec = SpringSpec(response: 0.50, damping: 0.86)
    /// Faces, chips, pops. Settles ≈ 0.85 s.
    static let hopSpec = SpringSpec(response: 0.36, damping: 0.62)
    /// The handoff window. Settles ≈ 1.00 s.
    static let revealSpec = SpringSpec(response: 0.60, damping: 0.88)
    /// One-off: A3/A4 title drop. Settles ≈ 0.73 s.
    static let dropSpec = SpringSpec(response: 0.40, damping: 0.80)
    /// One-off: A1 activity pill push. Settles ≈ 0.78 s.
    static let pillSpec = SpringSpec(response: 0.45, damping: 0.85)
    /// One-off: A0 → A1 Crew entrance. Settles ≈ 0.92 s.
    static let crewEntranceSpec = SpringSpec(response: 0.50, damping: 0.80)

    static let stage = stageSpec.animation
    static let expand = expandSpec.animation
    static let hop = hopSpec.animation
    static let reveal = revealSpec.animation
    static let drop = dropSpec.animation
    static let pill = pillSpec.animation
    static let crewEntrance = crewEntranceSpec.animation

    /// Every outgoing title and body: quick and uniform so exits never compete with an entrance.
    static let copyOut: Animation = .easeIn(duration: 0.18)
    static let copyOutOffset: CGFloat = -6
    /// Reduce Motion replacement for fills and copy.
    static let reducedCrossfade: Animation = .easeInOut(duration: 0.25)
    /// Bar title and fill changes (existing shared timing).
    static func bar(reduceMotion: Bool) -> Animation { DIPMotion.navigation(reduceMotion: reduceMotion) }

    /// Continuous wink: close, hold, open (easeInOut both ways).
    static let winkClose = 0.12
    static let winkHold = 0.3
    static let winkOpen = 0.16
}
