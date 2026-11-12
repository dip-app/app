#if canImport(SwiftUI)
    import SwiftUI

    public struct DIPHeader: View {
        @Environment(\.dynamicTypeSize) private var dynamicTypeSize
        private let title: String
        private let person: DIPAvatarIdentity?
        private let avatar: Image?
        private let unreadCount: Int?
        private let onNotifications: (() -> Void)?
        private let onProfile: (() -> Void)?
        public init(
            title: String, person: DIPAvatarIdentity? = nil, avatar: Image? = nil, unreadCount: Int? = nil,
            onNotifications: (() -> Void)? = nil, onProfile: (() -> Void)? = nil
        ) {
            self.title = title
            self.person = person
            self.avatar = avatar
            self.unreadCount = unreadCount
            self.onNotifications = onNotifications
            self.onProfile = onProfile
        }
        public var body: some View {
            Group {
                if dynamicTypeSize.isAccessibilitySize {
                    VStack(alignment: .leading, spacing: DIPTokens.Spacing.related) {
                        titlePill
                        controls
                    }
                } else {
                    ViewThatFits(in: .horizontal) {
                        HStack(alignment: .center, spacing: DIPTokens.Spacing.related) {
                            titlePill
                            Spacer(minLength: 0)
                            controls
                        }
                        VStack(alignment: .leading, spacing: DIPTokens.Spacing.related) {
                            titlePill
                            controls
                        }
                    }
                }
            }.frame(maxWidth: .infinity, alignment: .leading)
        }
        private var titlePill: some View {
            Text(title).font(DIPReferenceAssets.font("Figtree-Regular", size: 20, relativeTo: .title3)).fixedSize(horizontal: false, vertical: true)
                .foregroundStyle(DIPComponentTheme.accent)
                .padding(.horizontal, DIPTokens.Spacing.contentInset).padding(.vertical, 14)
                .overlay(Capsule().strokeBorder(DIPComponentTheme.accent, lineWidth: 2))
                .accessibilityAddTraits(.isHeader)
        }
        private var controls: some View {
            HStack(spacing: DIPTokens.Spacing.related) {
                if let onNotifications {
                    Button(action: onNotifications) {
                        Label {
                            if let unreadCount, unreadCount > 0 { Text(DIPBadgeCount.text(unreadCount)) }
                        } icon: {
                            Image(systemName: "bell.badge")
                        }
                        .frame(
                            minWidth: DIPTokens.Spacing.minimumTouchTarget,
                            minHeight: DIPTokens.Spacing.minimumTouchTarget)
                    }
                    .buttonStyle(.bordered).buttonBorderShape(.capsule)
                    .accessibilityLabel("Notifications")
                    .accessibilityValue(Text(unreadCount.map { "\(max(0, $0)) unread" } ?? ""))
                }
                if let person, let onProfile {
                    Button(action: onProfile) { DIPAvatar(person: person, image: avatar, isDecorative: true) }
                        .buttonStyle(.bordered).buttonBorderShape(.circle)
                        .accessibilityLabel(Text("Open profile for \(person.displayName)"))
                }
            }.tint(DIPComponentTheme.ink)
        }
    }
#endif
