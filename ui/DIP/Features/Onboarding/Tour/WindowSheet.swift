import SwiftUI

/// The tour's white background with a rounded hole (spec §3 H "WindowSheet"): a filled shape, not a mask.
///
/// During the tour the hole is the Stage card, which covers it. At handoff the hole animates to the full
/// screen with radius 0, uncovering whatever `DIPMemberHome` shows underneath. Fill it with
/// `FillStyle(eoFill: true)` so the window stays empty.
struct WindowSheet: Shape {
    var window: CGRect
    var radius: CGFloat

    var animatableData: AnimatablePair<AnimatablePair<CGFloat, CGFloat>,
                                       AnimatablePair<AnimatablePair<CGFloat, CGFloat>, CGFloat>> {
        get {
            AnimatablePair(AnimatablePair(window.minX, window.minY),
                           AnimatablePair(AnimatablePair(window.width, window.height), radius))
        }
        set {
            window = CGRect(x: newValue.first.first, y: newValue.first.second,
                            width: newValue.second.first.first, height: newValue.second.first.second)
            radius = newValue.second.second
        }
    }

    func path(in rect: CGRect) -> Path {
        var path = Path(rect)
        path.addRoundedRect(in: window, cornerSize: CGSize(width: radius, height: radius), style: .continuous)
        return path
    }
}
