#if canImport(SwiftUI)
    import SwiftUI
    import CoreText

    /// Original Home reference resources. No network or Firebase dependency.
    public enum DIPReferenceAssets {
        public static func image(_ name: String) -> Image { Image(name, bundle: .module) }
        private static let registration: Void = {
            for file in [
                "Figtree[wght].ttf", "FjallaOne-Regular.ttf", "Inter-Regular.otf", "Inter-Medium.otf",
                "Inter-LightItalic.otf",
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

    /// Shared visual elements use the measured Figma geometry; product data remains an input.
    public struct DIPHomeHeader: View {
        let title: String
        let unreadCount: Int
        let onNotifications: () -> Void
        let onProfile: () -> Void
        public init(
            title: String, unreadCount: Int, onNotifications: @escaping () -> Void, onProfile: @escaping () -> Void
        ) {
            self.title = title
            self.unreadCount = unreadCount
            self.onNotifications = onNotifications
            self.onProfile = onProfile
        }
        public var body: some View {
            HStack {
                Text(title)
                    .font(DIPReferenceAssets.font("Figtree-Regular", size: 20))
                    .foregroundStyle(DIPTokens.Color.headerTitle.swiftUIColor)
                    .frame(height: 22)
                    .padding(.horizontal, 20).padding(.vertical, 14)
                    .background(DIPTokens.Color.actionPrimary.swiftUIColor, in: Capsule())
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
                        DIPReferenceAssets.image("Image").resizable().frame(width: 40, height: 40)
                    }
                    .accessibilityLabel("Open profile").accessibilityIdentifier("home.profile")
                }
                .padding(5).frame(height: 50)
                .background(DIPTokens.Color.surfaceMuted.swiftUIColor, in: Capsule())
            }
            .buttonStyle(.plain)
        }
    }

    public struct DIPChallengeCard: View {
        let category: String
        let participantCount: Int
        let avatars: [String]
        let onSelect: () -> Void
        public init(category: String, participantCount: Int, avatars: [String], onSelect: @escaping () -> Void) {
            self.category = category
            self.participantCount = participantCount
            self.avatars = avatars
            self.onSelect = onSelect
        }
        public var body: some View {
            Button(action: onSelect) {
                ZStack(alignment: .topLeading) {
                    RoundedRectangle(cornerRadius: 20).fill(DIPTokens.Color.challengeAccent.swiftUIColor)
                    // Export is the original image fill; replicate its Figma crop within the mascot node.
                    DIPReferenceAssets.image("Mascot").resizable()
                        .frame(width: 314.16, height: 231.968)
                        .offset(x: 28.315, y: -17.427)
                        .frame(width: 350, height: 222, alignment: .topLeading).clipped()
                        .offset(y: -19)
                    VStack(alignment: .leading, spacing: 0) {
                        Spacer(minLength: 0)
                        Text(category.uppercased())
                            .font(DIPReferenceAssets.font("FjallaOne-Regular", size: 40, relativeTo: .largeTitle))
                            .foregroundStyle(.white).frame(height: 50).padding(.leading, 10)
                        HStack(alignment: .top) {
                            HStack(spacing: 10) {
                                DIPReferenceAvatarStack(names: avatars)
                                Text("+ \(participantCount) others participating")
                                    .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                                    .foregroundStyle(.black).frame(height: 22)
                            }
                            .padding(.leading, 4).padding(.trailing, 12).padding(.vertical, 4)
                            .background(.white, in: Capsule())
                            Spacer(minLength: 0)
                            Text("→").font(DIPReferenceAssets.font("Inter-Medium", size: 20))
                                .rotationEffect(.degrees(-45))
                                .foregroundStyle(.black).frame(width: 30, height: 30)
                                .background(.white, in: Circle())
                        }
                    }
                    .padding(5)
                }
                .frame(height: 225)
                .contentShape(RoundedRectangle(cornerRadius: 20))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("This Week’s Challenge, \(category), \(participantCount) others participating")
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
        let imageName: String
        let avatars: [String]
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
            self.imageName = imageName
            self.avatars = avatars
            self.attendeeCount = attendeeCount
            self.width = width
            self.shade = shade
            self.onSelect = onSelect
        }
        public var body: some View {
            Button(action: onSelect) {
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: -4) {
                        DIPReferenceAvatarStack(names: avatars)
                        Text("\(attendeeCount) Attending")
                            .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                            .foregroundStyle(.black).frame(height: 22).padding(.horizontal, 7)
                            .background(.white, in: Capsule())
                    }
                    .fixedSize()
                    Spacer(minLength: 0)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(title.uppercased())
                            .font(DIPReferenceAssets.font("FjallaOne-Regular", size: 20, relativeTo: .title3))
                            .frame(height: 22, alignment: .leading)
                        Text(locality)
                            .font(DIPReferenceAssets.font("Inter-LightItalic", size: 11))
                            .frame(height: 18, alignment: .leading)
                    }
                    .foregroundStyle(.white).padding(10)
                }
                .padding(5)
                .frame(width: width, height: 205, alignment: .leading)
                .background {
                    DIPReferenceAssets.image(imageName).resizable().scaledToFill()
                        .overlay(.black.opacity(shade))
                }
                .clipShape(RoundedRectangle(cornerRadius: 20))
                .contentShape(RoundedRectangle(cornerRadius: 20))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(title), \(locality), \(attendeeCount) attending")
            .accessibilityIdentifier("home.event.\(imageName)")
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
            case .rewards: "HeroiconsOutlineTicket"
            case .events: "HeroiconsOutlineSquares2X2"
            case .profile: "HeroiconsOutlineUserCircle"
            }
        }
    }
    public struct DIPFloatingNavigation: View {
        let onSelect: (DIPHomeTab) -> Void
        /// Only the Home visual state is implemented; other destinations are activation callbacks.
        public init(onSelect: @escaping (DIPHomeTab) -> Void) { self.onSelect = onSelect }
        public var body: some View {
            HStack(spacing: 0) {
                ForEach(DIPHomeTab.allCases) { tab in
                    if tab != .home { Spacer(minLength: 0) }
                    Button {
                        onSelect(tab)
                    } label: {
                        DIPReferenceAssets.image(tab.asset).resizable()
                            .frame(width: tab == .events ? 24 : 30, height: tab == .events ? 24 : 30)
                            .frame(width: 80, height: 80)
                            .background {
                                if tab == .home { Circle().fill(.white).frame(width: 60, height: 60) }
                            }
                            .contentShape(Rectangle())
                    }
                    .accessibilityLabel(tab.rawValue)
                    .accessibilityIdentifier("home.tab.\(tab.id)")
                    .accessibilityAddTraits(tab == .home ? .isSelected : [])
                }
            }
            .buttonStyle(.plain)
            .frame(height: 80)
            .background(DIPTokens.Color.navigationBackground.swiftUIColor, in: Capsule())
        }
    }
#endif
