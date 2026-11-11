#if canImport(SwiftUI)
    import SwiftUI
    import CoreText

    /// Original Home reference resources. No network or Firebase dependency.
    public enum DIPReferenceAssets {
        public static func image(_ name: String) -> Image { Image(name, bundle: .module) }
        private static let registration: Void = {
            for file in [
                "Figtree[wght].ttf", "FjallaOne-Regular.ttf", "Inter-Regular.otf", "Inter-Medium.otf",
                "Inter-LightItalic.otf", "Inter-Light.otf", "Inter-Italic.otf",
            ] {
                let name = (file as NSString).deletingPathExtension
                let ext = (file as NSString).pathExtension
                if let url = Bundle.module.url(forResource: name, withExtension: ext) {
                    CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
                }
            }
        }()
        public static func font(_ name: String, size: CGFloat, relativeTo style: Font.TextStyle = .body) -> Font {
            _ = registration
            return .custom(name, size: size, relativeTo: style)
        }
    }

    private struct DIPHeaderHostedKey: EnvironmentKey { static let defaultValue = false }

    extension EnvironmentValues {
        /// True when the shell draws the shared tab header itself (fixed while pages slide). A page's own
        /// `DIPHomeHeader` then only reserves its space, so page layout does not change.
        public var dipHeaderHosted: Bool {
            get { self[DIPHeaderHostedKey.self] }
            set { self[DIPHeaderHostedKey.self] = newValue }
        }
    }

    /// Shared visual elements use the measured Figma geometry; product data remains an input.
    public struct DIPHomeHeader: View {
        @Environment(\.dipHeaderHosted) private var hosted
        @Environment(\.accessibilityReduceMotion) private var reduceMotion
        let title: String
        let unreadCount: Int
        private let profileAvatar: AnyView
        let onNotifications: () -> Void
        let onProfile: () -> Void
        public init(
            title: String, unreadCount: Int, onNotifications: @escaping () -> Void, onProfile: @escaping () -> Void
        ) {
            self.title = title
            self.unreadCount = unreadCount
            self.profileAvatar = AnyView(DIPReferenceAssets.image("Image").resizable())
            self.onNotifications = onNotifications
            self.onProfile = onProfile
        }
        public init<Avatar: View>(
            title: String, unreadCount: Int, profileAvatar: () -> Avatar,
            onNotifications: @escaping () -> Void, onProfile: @escaping () -> Void
        ) {
            self.title = title
            self.unreadCount = unreadCount
            self.profileAvatar = AnyView(profileAvatar())
            self.onNotifications = onNotifications
            self.onProfile = onProfile
        }
        public var body: some View {
            if hosted {
                // The shell draws the header; keep the same height so the page does not shift.
                Color.clear.frame(height: 50).accessibilityHidden(true)
            } else {
                content
            }
        }

        private var content: some View {
            HStack {
                // A changed title blur-replaces in place while the outlined pill animates to the new width.
                ZStack {
                    if reduceMotion {
                        Text(title).id(title).transition(.opacity)
                    } else {
                        Text(title).id(title).transition(.blurReplace)
                    }
                }
                .font(DIPReferenceAssets.font("Figtree-Regular", size: 20))
                .foregroundStyle(DIPTokens.Color.actionPrimary.swiftUIColor)
                .frame(height: 22)
                .padding(.horizontal, 20).padding(.vertical, 14)
                // Informational label, so outlined (pill rule: solid = pressable, outline = informational).
                .overlay(Capsule().strokeBorder(DIPTokens.Color.actionPrimary.swiftUIColor, lineWidth: 2))
                .animation(reduceMotion ? .linear(duration: DIPMotion.reducedMotionDuration) : DIPMotion.marker, value: title)
                Spacer(minLength: 10)
                HStack(spacing: 10) {
                    Button(action: onNotifications) {
                        HStack(spacing: 6) {
                            DIPReferenceAssets.image("HeroiconsOutlineBellAlert").resizable().frame(
                                width: 25, height: 24)
                            Text("\(unreadCount)")
                                .font(DIPReferenceAssets.font("Figtree-Regular", size: 19.636))
                                .foregroundStyle(DIPTokens.Color.notificationAccent.swiftUIColor)
                        }
                        .padding(.leading, 10).padding(.trailing, 12)
                        .frame(height: 40).background(.white, in: Capsule())
                    }
                    .accessibilityLabel("Notifications, \(unreadCount) unread").accessibilityIdentifier(
                        "home.notifications")
                    Rectangle().fill(Color.black.opacity(0.2)).frame(width: 1, height: 14).frame(width: 0)
                    Button(action: onProfile) {
                        profileAvatar.frame(width: 40, height: 40)
                    }
                    .accessibilityLabel("Open profile").accessibilityIdentifier("home.profile")
                }
                .padding(5).frame(height: 50)
                .background(DIPTokens.Color.surfaceMuted.swiftUIColor, in: Capsule())
            }
            .buttonStyle(.plain)
        }
    }

    /// Home "This Week's Challenge" card (Figma 46:1017). Theme artwork and accent are inputs
    /// (resolved from the weekly-theme catalog by the app); the geometry is the original mascot crop.
    public struct DIPChallengeCard: View {
        let category: String
        let participationText: String
        let accessibilityText: String
        let accent: Color
        let titleColor: Color
        private let avatarStack: AnyView?
        private let artwork: AnyView?
        let onSelect: () -> Void
        @Environment(\.dynamicTypeSize) private var dynamicTypeSize

        public init(category: String, participantCount: Int, avatars: [String], onSelect: @escaping () -> Void) {
            self.init(category: category, participationText: "+ \(participantCount) others participating",
                      accessibilityLabel: "This week’s challenge: \(category), \(participantCount) others participating",
                      accent: DIPTokens.Color.challengeAccent.swiftUIColor, titleColor: .white,
                      artwork: DIPReferenceAssets.image("Mascot").resizable(),
                      avatarStack: avatars.isEmpty ? nil : AnyView(DIPReferenceAvatarStack(names: avatars)), onSelect: onSelect)
        }
        public init<Artwork: View, Avatars: View>(
            category: String, participantCount: Int, artwork: () -> Artwork, avatarStack: () -> Avatars,
            onSelect: @escaping () -> Void
        ) {
            self.init(category: category, participationText: "+ \(participantCount) others participating",
                      accessibilityLabel: "This week’s challenge: \(category), \(participantCount) others participating",
                      accent: DIPTokens.Color.challengeAccent.swiftUIColor, titleColor: .white,
                      artwork: artwork(), avatarStack: AnyView(avatarStack()), onSelect: onSelect)
        }
        /// Theme-driven card. Pass nil `artwork` for a title-only (unknown theme) card and nil
        /// `avatarStack` when no participant faces exist: the pill then shows text only.
        public init<Artwork: View>(
            category: String, participationText: String, accessibilityLabel: String, accent: Color, titleColor: Color,
            artwork: Artwork?, avatarStack: AnyView?, onSelect: @escaping () -> Void
        ) {
            self.category = category
            self.participationText = participationText
            self.accessibilityText = accessibilityLabel
            self.accent = accent
            self.titleColor = titleColor
            self.artwork = artwork.map { AnyView($0) }
            self.avatarStack = avatarStack
            self.onSelect = onSelect
        }
        public var body: some View {
            let large = dynamicTypeSize.isAccessibilitySize
            Button(action: onSelect) {
                ZStack(alignment: .topLeading) {
                    RoundedRectangle(cornerRadius: 20).fill(accent)
                    if let artwork {
                        // Export is the original image fill; replicate its Figma crop within the mascot node.
                        artwork
                            .frame(width: 314.16, height: 231.968)
                            .offset(x: 28.315, y: -17.427)
                            .frame(width: 350, height: 222, alignment: .topLeading).clipped()
                            .offset(y: -19)
                            .accessibilityHidden(true)
                    }
                    VStack(alignment: .leading, spacing: 0) {
                        Spacer(minLength: 0)
                        Text(category.uppercased())
                            .font(DIPReferenceAssets.font("FjallaOne-Regular", size: 40, relativeTo: .largeTitle))
                            .foregroundStyle(titleColor).lineLimit(large ? 2 : 1).minimumScaleFactor(0.5)
                            .frame(minHeight: 50).frame(height: large ? nil : 50).padding(.leading, 10)
                        HStack(alignment: large ? .bottom : .top) {
                            HStack(spacing: 10) {
                                if let avatarStack { avatarStack }
                                Text(participationText)
                                    .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                                    .foregroundStyle(.black).frame(minHeight: 22)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            .padding(.leading, avatarStack == nil ? 12 : 4).padding(.trailing, 12).padding(.vertical, 4)
                            .background(.white, in: Capsule())
                            Spacer(minLength: 0)
                            Text("→").font(DIPReferenceAssets.font("Inter-Medium", size: 20))
                                .rotationEffect(.degrees(-45))
                                .foregroundStyle(.black).frame(width: 30, height: 30)
                                .background(.white, in: Circle())
                                .accessibilityHidden(true)
                        }
                    }
                    .padding(5)
                }
                .frame(minHeight: 225)
                .frame(height: large ? nil : 225)
                .contentShape(RoundedRectangle(cornerRadius: 20))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(accessibilityText)
            .accessibilityHint("Opens the challenge details")
            .accessibilityIdentifier("home.challenge")
        }
    }

    private struct DIPReferenceAvatarStack: View {
        let names: [String]
        var body: some View {
            HStack(spacing: -4) {
                ForEach(Array(names.enumerated()), id: \.offset) { _, name in
                    DIPReferenceAssets.image(name).resizable().frame(width: 22, height: 22)
                }
            }.accessibilityHidden(true)
        }
    }

    public struct DIPPhotoEventCard: View {
        let title: String
        let locality: String
        private let identifier: String
        private let artwork: AnyView
        private let avatarStack: AnyView
        let attendeeCount: Int
        let width: CGFloat
        let shade: Double
        let onSelect: () -> Void
        public init(
            title: String, locality: String, imageName: String, avatars: [String],
            attendeeCount: Int, width: CGFloat = 163, shade: Double = 0.1, onSelect: @escaping () -> Void
        ) {
            self.title = title
            self.locality = locality
            self.identifier = imageName
            self.artwork = AnyView(DIPReferenceAssets.image(imageName).resizable().scaledToFill())
            self.avatarStack = AnyView(DIPReferenceAvatarStack(names: avatars))
            self.attendeeCount = attendeeCount
            self.width = width
            self.shade = shade
            self.onSelect = onSelect
        }
        public init<Artwork: View, Avatars: View>(
            title: String, locality: String, identifier: String, attendeeCount: Int,
            width: CGFloat = 163, shade: Double = 0.1,
            artwork: () -> Artwork, avatarStack: () -> Avatars, onSelect: @escaping () -> Void
        ) {
            self.title = title
            self.locality = locality
            self.identifier = identifier
            self.attendeeCount = attendeeCount
            self.width = width
            self.shade = shade
            self.artwork = AnyView(artwork())
            self.avatarStack = AnyView(avatarStack())
            self.onSelect = onSelect
        }
        public var body: some View {
            Button(action: onSelect) {
                VStack(alignment: .leading, spacing: 0) {
                    // Nobody has joined yet: no "0 Attending" tag (and no empty avatar stack).
                    if attendeeCount > 0 {
                        HStack(spacing: -4) {
                            avatarStack
                            Text("\(attendeeCount) going")
                                .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                                .foregroundStyle(.black).frame(height: 22).padding(.horizontal, 7)
                                .background(.white, in: Capsule())
                        }
                        .fixedSize()
                    }
                    Spacer(minLength: 0)
                    VStack(alignment: .leading, spacing: 1) {
                        // Up to three lines inside the card padding; shrinks only as a last resort.
                        Text(title.uppercased())
                            .font(DIPReferenceAssets.font("FjallaOne-Regular", size: 20, relativeTo: .title3))
                            .lineLimit(3).minimumScaleFactor(0.75).multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Text(locality)
                            .font(DIPReferenceAssets.font("Inter-LightItalic", size: 11))
                            .lineLimit(2).multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .foregroundStyle(.white).padding(10)
                }
                .padding(5)
                .frame(width: width, height: 205, alignment: .leading)
                .background {
                    artwork
                        .overlay(.black.opacity(shade))
                        // Keeps the white title/locality readable on light category photos (V1-10).
                        .overlay(alignment: .bottom) {
                            LinearGradient(colors: [.clear, .black.opacity(0.6)], startPoint: .top, endPoint: .bottom)
                                .frame(height: 90)
                        }
                }
                .clipShape(RoundedRectangle(cornerRadius: 20))
                .contentShape(RoundedRectangle(cornerRadius: 20))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(attendeeCount > 0
                ? "\(title), \(locality), \(attendeeCount) attending"
                : "\(title), \(locality)")
            .accessibilityIdentifier("home.event.\(identifier)")
        }
    }

    public enum DIPHomeTab: String, CaseIterable, Identifiable {
        case home = "Home"
        case rewards = "Rewards"
        case events = "My Events"
        case profile = "Profile"
        public var id: String { rawValue }
        var asset: String {
            switch self {
            case .home: "HeroiconsSolidHome"
            case .rewards: "HeroiconsOutlineGift"
            case .events: "HeroiconsOutlineSquares2X2"
            case .profile: "HeroiconsOutlineUserCircle"
            }
        }
    }
    /// One persistent bar: the marker travels between tabs and action states fade above it.
    public struct DIPFloatingNavigation: View {
        let selected: DIPHomeTab
        let action: DIPBottomBarAction?
        let showsTabs: Bool
        /// The tabs shown, in order. Defaults to every tab; onboarding demos pass `[.home, .events, .profile]`.
        let tabs: [DIPHomeTab]
        let onSelect: (DIPHomeTab) -> Void
        let onAction: () -> Void
        @Environment(\.accessibilityReduceMotion) private var reduceMotion
        @Environment(\.dipProgressIndicatorStyle) private var progressStyle
        /// Marker position while a finger is dragging it; nil when it rests on the selected tab.
        @State private var dragMarkerX: CGFloat?

        /// Root placement shared by every host of the one bar: centred `barCenterInset` above the
        /// screen's bottom edge (safe area ignored), `horizontalInset` from each side. Height is 80,
        /// so the bar's bottom edge sits `standardInsets.bottom` (21) above the screen edge.
        public static let barCenterInset: CGFloat = 61
        public static let horizontalInset: CGFloat = 20
        public static let height: CGFloat = 80
        public static let standardInsets = EdgeInsets(
            top: 0, leading: horizontalInset, bottom: barCenterInset - height / 2, trailing: horizontalInset)

        public init(selected: DIPHomeTab = .home, onSelect: @escaping (DIPHomeTab) -> Void) {
            self.init(selected: selected, action: nil, onSelect: onSelect)
        }

        public init(
            selected: DIPHomeTab = .home, action: DIPBottomBarAction?, showsTabs: Bool = true,
            tabs: [DIPHomeTab] = DIPHomeTab.allCases,
            onSelect: @escaping (DIPHomeTab) -> Void, onAction: @escaping () -> Void = {}
        ) {
            self.selected = selected
            self.action = action
            self.showsTabs = showsTabs
            self.tabs = tabs.isEmpty ? DIPHomeTab.allCases : tabs
            self.onSelect = onSelect
            self.onAction = onAction
        }

        private var selectedIndex: Int {
            tabs.firstIndex(of: selected) ?? 0
        }

        private func asset(for tab: DIPHomeTab, selected: Bool) -> String {
            switch tab {
            case .home: return selected ? "HeroiconsSolidHome" : "profile_HeroiconsOutlineHome"
            case .events:
                return selected ? "events_HeroiconsSolidSquares2X2" : "HeroiconsOutlineSquares2X2"
            case .profile:
                return selected ? "profile_HeroiconsSolidUserCircle" : "HeroiconsOutlineUserCircle"
            case .rewards:
                return selected ? "navigation_HeroiconsSolidGift" : "HeroiconsOutlineGift"
            }
        }

        private func restingMarkerX(width: CGFloat) -> CGFloat {
            10 + slotStep(width: width) * CGFloat(selectedIndex)
        }

        /// Distance between adjacent tab slots (the first and last slots sit 40 pt from the ends).
        private func slotStep(width: CGFloat) -> CGFloat {
            Self.slotStep(width: width, count: tabs.count)
        }

        private static func slotStep(width: CGFloat, count: Int) -> CGFloat {
            (width - 80) / CGFloat(max(1, count - 1))
        }

        /// The centre x of `tab`'s icon in a bar of `width`, measured from the bar's leading edge, using the same
        /// slot geometry the bar lays out (for callouts and pointers that aim at a tab). Nil if the tab isn't shown.
        public static func tabCenterX(
            _ tab: DIPHomeTab, tabs: [DIPHomeTab] = DIPHomeTab.allCases, width: CGFloat
        ) -> CGFloat? {
            guard let index = tabs.firstIndex(of: tab) else { return nil }
            return 40 + slotStep(width: width, count: tabs.count) * CGFloat(index)
        }

        private func marker(width: CGFloat) -> some View {
            let x = dragMarkerX ?? restingMarkerX(width: width)
            return Circle().fill(.white)
                .frame(width: 60, height: 60)
                .offset(x: x, y: 10)
                // Follows the finger exactly while dragging, then settles with a spring.
                .animation(dragMarkerX == nil ? DIPMotion.marker : nil, value: x)
                .accessibilityHidden(true)
        }

        /// Dragging the marker selects each tab it crosses; releasing settles on the selected tab.
        private func dragGesture(width: CGFloat) -> some Gesture {
            let step = slotStep(width: width)
            let tabs = self.tabs
            return DragGesture(minimumDistance: 6)
                .onChanged { value in
                    let x = min(max(value.location.x - 40, 10), 10 + CGFloat(tabs.count - 1) * step)
                    dragMarkerX = x
                    let index = min(max(Int(((x - 10) / step).rounded()), 0), tabs.count - 1)
                    if tabs[index] != selected { onSelect(tabs[index]) }
                }
                .onEnded { _ in dragMarkerX = nil }
        }

        public var body: some View {
            GeometryReader { geometry in
                ZStack(alignment: .topLeading) {
                    Capsule().fill(DIPTokens.Color.navigationBackground.swiftUIColor)
                        .accessibilityHidden(true)
                    if showsTabs {
                        if reduceMotion {
                            marker(width: geometry.size.width)
                                .id(selected)
                                .transition(.opacity)
                        } else {
                            marker(width: geometry.size.width)
                        }
                        tabItems
                            .allowsHitTesting(action == nil)
                            .accessibilityHidden(action != nil)
                    }
                    if let action {
                        actionOverlay(action)
                            .transition(.opacity)
                            .zIndex(1)
                    }
                }
                .frame(width: geometry.size.width, height: 80)
                .clipShape(Capsule())
                .contentShape(Capsule())
                .simultaneousGesture(
                    dragGesture(width: geometry.size.width),
                    including: action == nil && !reduceMotion && showsTabs ? .all : .none)
                .animation(DIPMotion.navigation(reduceMotion: reduceMotion), value: action)
                .animation(
                    reduceMotion ? DIPMotion.navigation(reduceMotion: true) : nil,
                    value: selected)
            }
            .frame(height: 80)
        }

        private var tabItems: some View {
            HStack(spacing: 0) {
                ForEach(tabs) { tab in
                    if tab != tabs.first { Spacer(minLength: 0) }
                    Button {
                        onSelect(tab)
                    } label: {
                        ZStack {
                            DIPReferenceAssets.image(asset(for: tab, selected: false)).resizable()
                                .opacity(selected == tab ? 0 : 1)
                            DIPReferenceAssets.image(asset(for: tab, selected: true)).resizable()
                                .opacity(selected == tab ? 1 : 0)
                        }
                        .frame(width: tab == .events ? 24 : 30, height: tab == .events ? 24 : 30)
                        .animation(DIPMotion.navigation(reduceMotion: reduceMotion), value: selected)
                        .accessibilityHidden(true)
                        .frame(width: 80, height: 80)
                        .contentShape(Rectangle())
                    }
                    .accessibilityLabel(tab.rawValue)
                    .accessibilityIdentifier("home.tab.\(tab.id)")
                    .accessibilityAddTraits(tab == selected ? .isSelected : [])
                    .accessibilityHidden(action != nil)
                    .disabled(action != nil)
                }
            }
            .buttonStyle(.plain)
            .frame(height: 80)
        }

        private func actionColor(_ style: DIPBottomBarAction.Style) -> Color {
            switch style {
            case .standard: DIPTokens.Color.navigationBackground.swiftUIColor
            case .accent: DIPTokens.Color.actionPrimary.swiftUIColor
            case .complete: DIPTokens.Color.actionComplete.swiftUIColor
            }
        }

        /// Design-system asset by name, or an SF Symbol when the name starts with `system:` (utility flows such as
        /// the report sheet, which have no Heroicons asset yet).
        @ViewBuilder private func actionIcon(_ name: String) -> some View {
            if name.hasPrefix("system:") {
                Image(systemName: String(name.dropFirst("system:".count)))
                    .resizable().scaledToFit().padding(4).fontWeight(.regular)
                    .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor)
            } else {
                DIPReferenceAssets.image(name).resizable()
            }
        }

        private func actionOverlay(_ action: DIPBottomBarAction) -> some View {
            Button {
                // Haptics mark commits, not navigation (DIPHaptics): Join, Save, Send… are felt; opening chat is not.
                if action.kind == .commit { DIPHaptics.commit() }
                onAction()
            } label: {
                ZStack {
                    Capsule().fill(actionColor(action.style))
                    HStack(spacing: 0) {
                        Text(action.title)
                            .font(DIPReferenceAssets.font("Figtree-Regular", size: 24))
                            .foregroundStyle(.white)
                            .multilineTextAlignment(.center).lineLimit(2).minimumScaleFactor(0.4)
                            .padding(.horizontal, 16)
                            .frame(maxWidth: .infinity)
                            .id(action.title)
                            .transition(.opacity)
                        if let icon = action.icon {
                            // The affirmative state's affordance: a white circle that pops in at the trailing edge.
                            actionIcon(icon)
                                .frame(width: 30, height: 30)
                                .frame(width: 64, height: 64)
                                .background(.white, in: Circle())
                                .padding(.trailing, 8)
                                .transition(reduceMotion ? .opacity : .scale(scale: 0.3).combined(with: .opacity))
                                .accessibilityHidden(true)
                        } else if action.showsProgress {
                            // Work in flight: the progress indicator in the white icon circle (the affirmative
                            // state's slot, so nothing else moves). Reduce Motion: one still face, no loop.
                            DIPProgressIndicator(style: progressStyle, animated: !reduceMotion)
                                .frame(width: 64, height: 64)
                                .background(.white, in: Circle())
                                .padding(.trailing, 8)
                                .transition(reduceMotion ? .opacity : .scale(scale: 0.3).combined(with: .opacity))
                                .accessibilityHidden(true)
                        }
                    }
                    .animation(DIPMotion.affordance(reduceMotion: reduceMotion), value: action.icon)
                    .animation(DIPMotion.navigation(reduceMotion: reduceMotion), value: action.showsProgress)
                }
                .frame(maxWidth: .infinity)
                .frame(height: 80)
                .contentShape(Capsule())
            }
            .buttonStyle(DIPPressFeedbackStyle())
            .disabled(action.style == .complete)
            .accessibilityLabel(action.title)
            .accessibilityIdentifier(action.identifier)
            .accessibilityValue(action.value ?? "")
        }
    }

#endif
