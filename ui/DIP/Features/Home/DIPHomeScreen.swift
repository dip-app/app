import DIPCore
import DIPDesignSystem
import SwiftUI

/// Deterministic presentation fixture matching Figma Home 35:147.
/// Counts, avatars and events are prototype content, never authoritative server data.
struct DIPHomeFixturePreview: View {
    var onSignOut: (() async -> Void)? = nil
    var body: some View { DIPPrototypeApp(onSignOut: onSignOut) }
}

struct DIPHomeScreen: View {
    let home: DIPHomeSnapshot
    let onEvent: (String) -> Void
    let onChallenge: (String) -> Void
    let showsBottomBar: Bool
    let onSelect: (String) -> Void
    let eventSectionTitle: String
    let onRefresh: (() async -> Void)?
    let onLoadMore: (() -> Void)?
    let loadingMore: Bool
    let paginationError: String?
    init(
        home: DIPHomeSnapshot, showsBottomBar: Bool = true, onEvent: @escaping (String) -> Void,
        onChallenge: @escaping (String) -> Void, onSelect: @escaping (String) -> Void,
        onLoadMore: (() -> Void)? = nil, loadingMore: Bool = false, paginationError: String? = nil,
        eventSectionTitle: String = "This Week’s Events", onRefresh: (() async -> Void)? = nil
    ) {
        self.eventSectionTitle = eventSectionTitle; self.onRefresh = onRefresh
        self.onLoadMore = onLoadMore; self.loadingMore = loadingMore; self.paginationError = paginationError
        self.home = home
        self.onEvent = onEvent
        self.onChallenge = onChallenge
        self.showsBottomBar = showsBottomBar
        self.onSelect = onSelect
    }
    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .top) {
                Color.white
                VStack(spacing: 0) {
                    DIPHomeHeader(
                        title: "Home", unreadCount: home.unreadCount,
                        profileAvatar: { DIPMedia(home.profileAvatar) },
                        onNotifications: { onSelect("Notifications") }, onProfile: { onSelect("Profile") }
                    )
                    .padding(.horizontal, 20).padding(.top, 60).padding(.bottom, 10)
                    ScrollView(.vertical) {
                        VStack(alignment: .leading, spacing: 22) {
                            if let challenge = home.challenge {
                                VStack(alignment: .leading, spacing: 8) {
                                    sectionTitle("This Week’s Challenge", size: 18)
                                    DIPChallengeCard(
                                        category: challenge.category, participantCount: challenge.participantCount,
                                        artwork: { DIPMedia(challenge.artwork) },
                                        avatarStack: { DIPMediaStack(challenge.avatars) }
                                    ) { onChallenge(challenge.id) }
                                }
                                .padding(.top, 15)
                            }
                            VStack(alignment: .leading, spacing: 8) {
                                sectionTitle(eventSectionTitle)
                                if home.events.isEmpty { Text("No upcoming events yet.").accessibilityIdentifier("home.events.empty") }
                                if let paginationError { Text(paginationError).font(.footnote).foregroundStyle(.secondary) }
                                if let onLoadMore {
                                    Button(loadingMore ? "Loading more…" : "Load more events", action: onLoadMore)
                                        .disabled(loadingMore).accessibilityIdentifier("home.events.more")
                                }
                                ScrollView(.horizontal) {
                                    HStack(spacing: 10) {
                                        ForEach(home.events) { event in
                                            DIPPhotoEventCard(
                                                title: event.title, locality: event.locality,
                                                identifier: eventIdentifier(event), attendeeCount: event.attendeeCount,
                                                width: event.id == "hike" ? 169 : 163, shade: event.imageShade,
                                                artwork: { DIPMedia(event.image).scaledToFill() },
                                                avatarStack: { DIPMediaStack(event.avatars) }
                                            ) { onEvent(event.id) }
                                        }
                                    }
                                    .padding(.horizontal, 20)
                                }
                                .scrollIndicators(.hidden)
                                .frame(height: 205).padding(.horizontal, -20)
                                .accessibilityIdentifier("home.events")
                            }
                            VStack(alignment: .leading, spacing: 14) {
                                sectionTitle("Attended Your Recent Events:")
                                HStack(spacing: 10) {
                                    ForEach(Array(home.recentAttendeeAvatars.enumerated()), id: \.offset) { _, avatar in
                                        DIPMedia(avatar)
                                            .resizable().frame(width: 40, height: 40).accessibilityHidden(true)
                                    }
                                    Button {
                                        onSelect("Recent attendees")
                                    } label: {
                                        Text("See All").font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                                            .foregroundStyle(.white).frame(maxWidth: .infinity).frame(height: 40)
                                            .background(
                                                DIPTokens.Color.navigationBackground.swiftUIColor, in: Capsule())
                                    }
                                    .buttonStyle(.plain).accessibilityIdentifier("home.attendees")
                                }
                            }
                        }
                        .padding(.horizontal, 20).padding(.bottom, 120)
                    }
                    .scrollIndicators(.hidden)
                    .modifier(MemberEventRefresh(action: onRefresh))
                }
                .padding(.bottom, 22)
                if showsBottomBar {
                    DIPFloatingNavigation { if $0 != .home { onSelect($0.rawValue) } }
                        .padding(.horizontal, 20)
                        .position(x: geometry.size.width / 2, y: geometry.size.height - 61)
                }
            }
            .clipped()
        }
        .ignoresSafeArea()
        .preferredColorScheme(.light)
    }
    private func eventIdentifier(_ event: DIPEventSummary) -> String {
        if case .asset(let name) = event.image { return name }
        return event.id
    }
    private func sectionTitle(_ text: String, size: CGFloat = 17) -> some View {
        Text(text).font(DIPReferenceAssets.font("Figtree-Regular", size: size))
            .foregroundStyle(.black).frame(height: 22, alignment: .leading)
    }
}

private struct MemberEventRefresh: ViewModifier {
    let action: (() async -> Void)?
    @ViewBuilder func body(content: Content) -> some View {
        if let action { content.refreshable { await action() } } else { content }
    }
}
