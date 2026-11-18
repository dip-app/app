import DIPCore
import DIPDesignSystem
import SwiftUI

/// Pieces of the iPhone Duo's open (inner display) layout. Everything here is only ever instantiated when
/// `\.dipDuoOpen` is true, which needs a hinge-reporting window at least `DIPDuoLayout.openMinWidth` wide; every other
/// device keeps its existing layouts untouched.

/// Pane geometry of the open shell: a list pane and a detail pane that takes what is left. The navigation rail sits in
/// the sensor column (`DIPDuoSensor`), outside the content width.
enum DIPDuoPaneLayout {
    /// Rail column width when the window reports no sensor inset (never on a real Duo); normally the sensor's width.
    static let railWidth: CGFloat = 88
    /// A phone's width, so the list renders the phone cards at their designed 353 pt content width.
    static let listWidth: CGFloat = 393
    static let dividerWidth: CGFloat = 1
    /// Top inset of page content. The island only takes the side, so the phone's 60 pt status-bar allowance is not needed.
    static let topInset: CGFloat = 20
    static let phoneTopInset: CGFloat = 60

    /// `total` is the content width beside the sensor column.
    static func detailWidth(total: CGFloat) -> CGFloat { max(0, total - listWidth - dividerWidth) }
    static func topInset(open: Bool) -> CGFloat { open ? topInset : phoneTopInset }
    /// Space kept clear under scrolling content: the phone's floating bar needs 120 pt, the rail does not.
    static func bottomClearance(open: Bool, phone: CGFloat = 120) -> CGFloat { open ? 28 : phone }

    /// The event a freshly opened Home or My Events shows in the detail pane (the first one listed).
    static func defaultSelection(in ids: [String]) -> String? { ids.first }

    /// The default event in the order the Home grid shows: events that fit the member's calendar first, conflicting
    /// ones after (the same `DIPCalendarFit` rule `DIPHomeScreen` applies), so the detail pane opens the first card.
    static func defaultSelection(in ids: [String], conflicted: Set<String>, busy: Set<String> = []) -> String? {
        defaultSelection(in: DIPCalendarFit.prioritized(ids, id: { $0 }, conflicted: conflicted, busy: busy))
    }

    /// Pushes `route` unless it is already the top page, so a rapid double tap cannot stack the same page twice.
    static func appending<Route: Equatable>(_ route: Route, to routes: [Route]) -> [Route] {
        routes.last == route ? routes : routes + [route]
    }

    /// The event the detail pane should show: the selected one while it still exists, else the default.
    static func resolvedSelection(selected: String?, exists: (String) -> Bool, fallback: String?) -> String? {
        if let selected, exists(selected) { return selected }
        return fallback
    }
}

private struct DIPDuoSelectedEventKey: EnvironmentKey { static let defaultValue: String? = nil }
private struct DIPDuoHidesBackKey: EnvironmentKey { static let defaultValue = false }

extension EnvironmentValues {
    /// The event open in the detail pane; list cards outline it.
    var dipDuoSelectedEvent: String? {
        get { self[DIPDuoSelectedEventKey.self] }
        set { self[DIPDuoSelectedEventKey.self] = newValue }
    }
    /// The detail pane's root page has nothing to go back to, so its Back button is not drawn.
    var dipDuoHidesBack: Bool {
        get { self[DIPDuoHidesBackKey.self] }
        set { self[DIPDuoHidesBackKey.self] = newValue }
    }
}

extension View {
    /// Open posture: sheets become centred form sheets instead of spanning the 867 pt window. A no-op otherwise.
    @ViewBuilder func dipDuoSheetSizing(_ open: Bool) -> some View {
        if open, #available(iOS 18.0, *) { presentationSizing(.form) } else { self }
    }

    /// Full-screen viewers (photo viewer, challenge photo) normally cover the whole window, which on the open Duo
    /// includes the sensor island; there they are centred form sheets instead. Everywhere else: `fullScreenCover`.
    @ViewBuilder func dipCover<Content: View>(
        isPresented: Binding<Bool>, open: Bool, @ViewBuilder content: @escaping () -> Content
    ) -> some View {
        if open {
            sheet(isPresented: isPresented) { content().dipDuoSheetSizing(true) }
        } else {
            fullScreenCover(isPresented: isPresented, content: content)
        }
    }

    /// Outlines the card of the event shown in the detail pane (informational state, so outline not fill).
    func dipDuoSelectionRing(_ selected: Bool, cornerRadius: CGFloat = 20) -> some View {
        overlay {
            if selected {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(DIPTokens.Color.actionPrimary.swiftUIColor, lineWidth: 4)
                    .allowsHitTesting(false)
            }
        }
    }
}

/// Tab header. Phones: the shared `DIPHomeHeader` exactly as before. Open Duo: only the outlined title, because the
/// bell and the profile live in the rail.
struct DIPTabHeader<Avatar: View>: View {
    @Environment(\.dipDuoOpen) private var open
    let title: String
    let unreadCount: Int
    let avatar: Avatar
    let onNotifications: () -> Void
    let onProfile: () -> Void

    init(title: String, unreadCount: Int, @ViewBuilder profileAvatar: () -> Avatar,
         onNotifications: @escaping () -> Void, onProfile: @escaping () -> Void) {
        self.title = title; self.unreadCount = unreadCount; self.avatar = profileAvatar()
        self.onNotifications = onNotifications; self.onProfile = onProfile
    }

    var body: some View {
        if open {
            HStack {
                Text(title)
                    .font(DIPReferenceAssets.font("Figtree-Regular", size: 20))
                    .foregroundStyle(DIPTokens.Color.actionPrimary.swiftUIColor)
                    .frame(height: 22).padding(.horizontal, 20).padding(.vertical, 14)
                    .overlay(Capsule().strokeBorder(DIPTokens.Color.actionPrimary.swiftUIColor, lineWidth: 2))
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 20).padding(.top, DIPDuoPaneLayout.topInset).padding(.bottom, 10)
        } else {
            DIPHomeHeader(title: title, unreadCount: unreadCount, profileAvatar: { avatar },
                          onNotifications: onNotifications, onProfile: onProfile)
                .padding(.horizontal, 20).padding(.top, 60).padding(.bottom, 10)
        }
    }
}

/// The navigation rail, in the sensor column beside the status pill: the four tabs in a floating ink capsule (white disc
/// marks the selected tab) and the bell beneath them. Solid = pressable. Every target is at least 44 pt.
struct DIPDuoRail: View {
    /// Column the rail is centred in; the capsule starts below the status pill.
    var columnWidth: CGFloat = DIPDuoPaneLayout.railWidth
    var topInset: CGFloat = DIPDuoPaneLayout.topInset
    let selected: DIPHomeTab
    let unreadCount: Int
    let onSelect: (DIPHomeTab) -> Void
    let onNotifications: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private func asset(_ tab: DIPHomeTab, selected: Bool) -> String {
        switch tab {
        case .home: selected ? "HeroiconsSolidHome" : "profile_HeroiconsOutlineHome"
        case .events: selected ? "events_HeroiconsSolidSquares2X2" : "HeroiconsOutlineSquares2X2"
        case .profile: selected ? "profile_HeroiconsSolidUserCircle" : "HeroiconsOutlineUserCircle"
        case .rewards: selected ? "navigation_HeroiconsSolidGift" : "HeroiconsOutlineGift"
        }
    }

    var body: some View {
        VStack(spacing: 10) {
            ForEach(DIPHomeTab.allCases) { tab in
                Button { onSelect(tab) } label: {
                    ZStack {
                        Circle().fill(selected == tab ? Color.white : Color.clear)
                        DIPReferenceAssets.image(asset(tab, selected: selected == tab)).resizable()
                            .frame(width: tab == .events ? 24 : 28, height: tab == .events ? 24 : 28)
                            .accessibilityHidden(true)
                    }
                    .frame(width: 56, height: 56)
                    .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(tab.rawValue)
                .accessibilityIdentifier("home.tab.\(tab.id)")
                .accessibilityAddTraits(tab == selected ? .isSelected : [])
            }
            Rectangle().fill(Color.white.opacity(0.2)).frame(width: 28, height: 1)
            Button(action: onNotifications) {
                // Ink item like the tabs (no white disc, which marks the selected tab); the count is a pink badge.
                ZStack(alignment: .topTrailing) {
                    Image(systemName: "bell").font(.system(size: 24, weight: .regular))
                        .foregroundStyle(DIPTokens.Color.notificationAccent.swiftUIColor)
                        .frame(width: 56, height: 56).accessibilityHidden(true)
                    if unreadCount > 0 {
                        Text(DIPBadgeCount.text(unreadCount))
                            .font(DIPReferenceAssets.font("Figtree-Regular", size: 13)).foregroundStyle(.white)
                            .padding(.horizontal, 6).frame(minWidth: 22, minHeight: 22)
                            .background(DIPTokens.Color.eventsAccent.swiftUIColor, in: Capsule())
                            .offset(x: -2, y: 2).accessibilityHidden(true)
                    }
                }
                .frame(width: 56, height: 56).contentShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Notifications, \(unreadCount) unread")
            .accessibilityIdentifier("home.notifications")
        }
        .padding(6).padding(.vertical, 4)
        .background(DIPTokens.Color.navigationBackground.swiftUIColor, in: Capsule())
        .animation(DIPMotion.navigation(reduceMotion: reduceMotion), value: selected)
        .padding(.top, topInset)
        .frame(width: columnWidth, alignment: .top)
        .frame(maxHeight: .infinity, alignment: .top)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Main navigation")
        .accessibilityIdentifier("duo.rail")
    }
}

/// Detail pane with nothing open (no events yet): a designed empty state, not a blank pane.
struct DIPDuoDetailPlaceholder: View {
    var body: some View {
        DIPEmptyState(screen: "duo-detail", title: "Pick an activity", message: "Its details open here.")
            .padding(.horizontal, 40)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.white)
    }
}
