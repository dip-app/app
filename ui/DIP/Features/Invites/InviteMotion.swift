import DIPDesignSystem
import SwiftUI

/// Motion for the invite flow, built on the app's own spring (`DIPMotion.marker`, ~0.38 s) so it matches the Home
/// toggle and avatar flight. Reduce Motion replaces every spring and movement with a short plain cross-fade.
enum InviteMotion {
    static func spring(reduceMotion: Bool) -> Animation {
        reduceMotion ? .linear(duration: DIPMotion.reducedMotionDuration) : DIPMotion.marker
    }

    /// A row arriving in a list: fades and rises slightly; later rows start a beat after earlier ones.
    static func entrance(reduceMotion: Bool) -> AnyTransition {
        reduceMotion ? .opacity : .opacity.combined(with: .scale(scale: 0.97, anchor: .top))
    }

    /// A card leaving after an answer: slides out sideways while fading, the rows below close the gap.
    static func exit(reduceMotion: Bool) -> AnyTransition {
        reduceMotion ? .opacity : .asymmetric(
            insertion: .opacity.combined(with: .scale(scale: 0.97, anchor: .top)),
            removal: .opacity.combined(with: .move(edge: .leading)))
    }

    /// The control that swaps in place (Invite -> sending -> Invited): scales and fades, never moves the row.
    static func swap(reduceMotion: Bool) -> AnyTransition {
        reduceMotion ? .opacity : .scale(scale: 0.8).combined(with: .opacity)
    }
}

/// Staggered entrance for list rows: each row fades and settles in with a short delay by position (capped, so a
/// long list never waits). Layout is reserved from the first frame, so nothing jumps.
struct StaggeredEntrance: ViewModifier {
    let index: Int
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var appeared = false

    func body(content: Content) -> some View {
        content
            .opacity(appeared ? 1 : 0)
            .offset(y: appeared || reduceMotion ? 0 : 10)
            .onAppear {
                guard !appeared else { return }
                if reduceMotion { withAnimation(InviteMotion.spring(reduceMotion: true)) { appeared = true } }
                else { withAnimation(InviteMotion.spring(reduceMotion: false).delay(Double(min(index, 8)) * 0.04)) { appeared = true } }
            }
    }
}

extension View {
    func staggeredEntrance(index: Int) -> some View { modifier(StaggeredEntrance(index: index)) }
}
