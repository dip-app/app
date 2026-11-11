import SwiftUI

/// Connects the Profile page's avatar badge to the shell's avatar flight. The Profile page and the
/// fixed header live in separate hosting controllers, so one avatar view in the shell overlay travels
/// between the header capsule and this badge. While it flies, the shell hides the real badge
/// (`isHidden`), and the page reports the badge's frame in global (screen) coordinates.
struct ProfileBadgeLink {
    var isHidden = false
    var report: (CGRect) -> Void = { _ in }

    /// Badge geometry, shared with the layout so a fallback endpoint matches the real badge at scroll
    /// offset zero: the card is inset 20 from the screen edge and 60 from the top, with 20pt of padding;
    /// the badge sits on the top-right of the 88pt photo, nudged out by (8, -6).
    /// Named coordinate space on the Profile page's root. It is stationary within the page (the scroll
    /// content moves inside it) and moves with the page while it slides, so frames measured in it are the
    /// settled screen frames at any moment of a page transition.
    static let pageSpace = "dipProfilePage"
    /// How far the badge is nudged from the photo's top-right corner (the badge's reported frame includes it).
    static let badgeNudge = CGSize(width: 8, height: -6)
    static let badgeSize: CGFloat = 38
    static let photoSize: CGFloat = 88
    static func fallbackFrame() -> CGRect {
        CGRect(x: 20 + 20 + photoSize - badgeSize + 8, y: 60 + 20 - 6, width: badgeSize, height: badgeSize)
    }
}

private struct ProfileBadgeLinkKey: EnvironmentKey { nonisolated(unsafe) static let defaultValue = ProfileBadgeLink() }

extension EnvironmentValues {
    var profileBadgeLink: ProfileBadgeLink {
        get { self[ProfileBadgeLinkKey.self] }
        set { self[ProfileBadgeLinkKey.self] = newValue }
    }
}
