import DIPCore
import DIPDesignSystem
import SwiftUI

/// Deterministic presentation fixture matching Figma Home 35:147.
/// Counts, avatars and events are prototype content, never authoritative server data.
struct DIPHomeFixturePreview: View {
    var onSignOut: (() async -> Void)? = nil
    var body: some View { DIPPrototypeApp(onSignOut: onSignOut) }
}

/// Interest filter state shown above Home's events. nil hides the control (no catalog or no active interests).
struct DIPHomeEventFilter: Equatable {
    var interests: [DIPInterest]
    var scope: DIPHomeEventScope
    /// Events shown now, and all upcoming events loaded (before filtering).
    var shownCount: Int
    var totalCount: Int
}

struct DIPHomeScreen: View {
    let home: DIPHomeSnapshot
    let eventFilter: DIPHomeEventFilter?
    let onFilterScope: (DIPHomeEventScope) -> Void
    let onEvent: (String) -> Void
    let onChallenge: (String) -> Void
    let showsBottomBar: Bool
    let onSelect: (String) -> Void
    let eventSectionTitle: String
    let onRefresh: (() async -> Void)?
    let onLoadMore: (() -> Void)?
    let loadingMore: Bool
    let paginationError: String?
    /// nil hides the section (fixtures without a challenge); live Home always passes a state.
    let challengeState: DIPChallengeCardState?
    let onRetryChallenge: (() -> Void)?
    /// Freshness of the events list (skeleton, failure, offline label). `.ready` for fixtures.
    let eventsPhase: DIPHomeEventsPhase
    let onRetryEvents: (() -> Void)?
    /// Upcoming events that overlap another joined DIP event (amber) or only the member's own calendar (grey); computed after first paint. Empty changes nothing.
    let calendarOverlaps: DIPCalendarOverlaps
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// Open iPhone Duo only: Home is the list pane, events are a two-column grid and the open one is outlined.
    @Environment(\.dipDuoOpen) private var duoOpen
    @Environment(\.dipDuoSelectedEvent) private var duoSelectedEvent
    init(
        home: DIPHomeSnapshot, showsBottomBar: Bool = true, onEvent: @escaping (String) -> Void,
        onChallenge: @escaping (String) -> Void, onSelect: @escaping (String) -> Void,
        onLoadMore: (() -> Void)? = nil, loadingMore: Bool = false, paginationError: String? = nil,
        eventSectionTitle: String = "This Week’s Events", onRefresh: (() async -> Void)? = nil,
        challengeState: DIPChallengeCardState? = nil, onRetryChallenge: (() -> Void)? = nil,
        eventFilter: DIPHomeEventFilter? = nil, onFilterScope: @escaping (DIPHomeEventScope) -> Void = { _ in },
        eventsPhase: DIPHomeEventsPhase = .ready, onRetryEvents: (() -> Void)? = nil,
        calendarOverlaps: DIPCalendarOverlaps = .none
    ) {
        self.calendarOverlaps = calendarOverlaps
        self.eventsPhase = eventsPhase
        self.onRetryEvents = onRetryEvents
        self.eventFilter = eventFilter
        self.onFilterScope = onFilterScope
        self.challengeState = challengeState ?? home.challenge.map { .current($0, stale: false) }
        self.onRetryChallenge = onRetryChallenge
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
                    DIPTabHeader(
                        title: "Home", unreadCount: home.unreadCount,
                        profileAvatar: { DIPMedia(home.profileAvatar) },
                        onNotifications: { onSelect("Notifications") }, onProfile: { onSelect("Profile") }
                    )
                    ScrollView(.vertical) {
                        VStack(alignment: .leading, spacing: 22) {
                            if let challengeState {
                                DIPHomeChallengeSection(state: challengeState, onOpen: onChallenge, onRetry: onRetryChallenge)
                                    .padding(.top, 15)
                                    .animation(.easeInOut(duration: DIPMotion.reducedMotionDuration), value: challengeState)
                            }
                            eventsSection(width: geometry.size.width - 40)
                            recentAttendees
                        }
                        .padding(.horizontal, 20).padding(.bottom, DIPDuoPaneLayout.bottomClearance(open: duoOpen))
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

    // MARK: Events section

    private var scope: DIPHomeEventScope { eventFilter?.scope ?? .all }
    private var content: DIPHomeEventsContent {
        .resolve(
            phase: eventsPhase, filterActive: eventFilter != nil, scope: scope, visibleCount: home.events.count,
            totalCount: eventFilter?.totalCount ?? home.events.count, canLoadMore: onLoadMore != nil)
    }
    /// Amber for another joined DIP event, a neutral gray badge for the member's own calendar, none when free.
    static func badge(for id: String, in overlaps: DIPCalendarOverlaps) -> DIPPhotoEventCard.CalendarBadge {
        if overlaps.dip.contains(id) { return .conflict }
        return overlaps.personal.contains(id) ? .busy : .none
    }
    /// Events that fit the calendar come first, then personal-calendar overlaps, then DIP overlaps (never hidden).
    private var orderedEvents: [DIPEventSummary] {
        DIPCalendarFit.prioritized(home.events, id: \.id, overlaps: calendarOverlaps)
    }
    private var swap: Animation { DIPMotion.filter(reduceMotion: reduceMotion) }

    /// Title, filter and events. The toggle never moves; only the area below it swaps. The area is a top-aligned
    /// ZStack so the outgoing and incoming content overlap while the container height animates, with no jump.
    private func eventsSection(width: CGFloat) -> some View {
        let content = content
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center, spacing: 8) {
                sectionTitle(eventSectionTitle)
                if eventsPhase == .offline {
                    Spacer(minLength: 4)
                    Label("Offline", systemImage: "wifi.slash")
                        .font(DIPReferenceAssets.font("Inter-Regular", size: 12))
                        .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor.opacity(0.7))
                        .accessibilityLabel("Offline. Showing the last update.")
                        .accessibilityIdentifier("home.events.stale")
                }
            }
            if let eventFilter { interestFilterBar(eventFilter).padding(.bottom, 4) }
            ZStack(alignment: .top) {
                eventsArea(content, width: width)
                    .id(content.key(scope: scope))
                    .transition(areaTransition)
            }
            .frame(maxWidth: .infinity, alignment: .top)
            if let paginationError { Text(paginationError).font(.footnote).foregroundStyle(.secondary) }
            if let onLoadMore {
                // HOME-Q13: the design system's secondary button (44 pt+, capsule). Loading more content is not a
                // commit, so no haptic (DIPHaptics).
                DIPButton(loadingMore ? "Loading more…" : "Load more events", emphasis: .secondary,
                          isLoading: loadingMore, action: onLoadMore)
                    .padding(.top, 8) // 16 pt below the cards (the column spaces by 8)
                    .accessibilityIdentifier("home.events.more")
            }
        }
        .animation(swap, value: scope)
        .animation(swap, value: content)
    }

    /// Cards for the old scope drift out a little and fade; the new ones drift in from the side the toggle moved
    /// toward. SwiftUI evaluates the removal with the old scope's sign and the insertion with the new one's, so
    /// the same offset gives opposite directions (to All: old exits left, new enters right; back: mirrored). Plain cross-fade with Reduce Motion.
    private var areaTransition: AnyTransition {
        guard !reduceMotion else { return .opacity }
        let sign: CGFloat = scope == .all ? 1 : -1
        return .asymmetric(
            insertion: .opacity.combined(with: .offset(x: 28 * sign)),
            removal: .opacity.combined(with: .offset(x: 28 * sign)))
    }

    @ViewBuilder private func eventsArea(_ content: DIPHomeEventsContent, width: CGFloat) -> some View {
        switch content {
        case .list:
            if duoOpen { eventGrid(width: width) } else { eventCarousel(width: width) }
        case .skeleton: eventSkeleton(width: width)
        case .failure(let message): eventFailure(message)
        case .emptyFiltered(let canLoadMore):
            // More pages may exist: an empty filtered page is not "nothing matches".
            DIPEmptyState(
                screen: "home-filter",
                title: canLoadMore ? "No matches in the events loaded so far" : "No events match your interests",
                message: canLoadMore
                    ? "Load more events, or switch to All events." : "Switch to All events to see everything coming up.",
                actionTitle: "Show all events", action: { DIPHaptics.select(); onFilterScope(.all) })
        case .emptyAll:
            DIPEmptyState(
                screen: "home-events", title: "Nothing planned yet",
                message: "New company events will show up here.")
        }
    }

    private func eventCarousel(width: CGFloat) -> some View {
        let equal = DIPHomeCardLayout.equalColumnWidth(count: home.events.count, available: Double(width)).map { CGFloat($0) }
        return ScrollView(.horizontal) {
            HStack(spacing: 10) {
                ForEach(orderedEvents) { event in
                    DIPPhotoEventCard(
                        title: event.title, locality: event.locality,
                        identifier: Self.eventIdentifier(event), attendeeCount: event.attendeeCount,
                        rewardText: DIPPointsFormat.rewardShort(event.pointsValue),
                        rewardAccessibility: DIPPointsFormat.rewardAccessibility(event.pointsValue),
                        width: equal ?? (event.id == "hike" ? 169 : 163), shade: event.imageShade,
                        artwork: { DIPMedia(event.image).scaledToFill() },
                        avatarStack: { DIPMediaStack(event.avatars) }
                    ) { onEvent(event.id) }
                    .calendarBadge(Self.badge(for: event.id, in: calendarOverlaps))
                }
            }
            .padding(.horizontal, 20)
        }
        .scrollIndicators(.hidden)
        .dipFixedFrame(height: 205).padding(.horizontal, -20)
        .accessibilityIdentifier("home.events")
    }

    /// Open Duo: the same cards as a two-column grid in the list pane. Selecting one fills the detail pane.
    private func eventGrid(width: CGFloat) -> some View {
        let column = max(0, (width - 10) / 2)
        return LazyVGrid(columns: [GridItem(.fixed(column), spacing: 10), GridItem(.fixed(column), spacing: 10)], spacing: 10) {
            ForEach(orderedEvents) { event in
                DIPPhotoEventCard(
                    title: event.title, locality: event.locality,
                    identifier: Self.eventIdentifier(event), attendeeCount: event.attendeeCount,
                    rewardText: DIPPointsFormat.rewardShort(event.pointsValue),
                    rewardAccessibility: DIPPointsFormat.rewardAccessibility(event.pointsValue),
                    width: column, shade: event.imageShade,
                    artwork: { DIPMedia(event.image).scaledToFill() },
                    avatarStack: { DIPMediaStack(event.avatars) }
                ) { onEvent(event.id) }
                .calendarBadge(Self.badge(for: event.id, in: calendarOverlaps))
                .dipDuoSelectionRing(duoSelectedEvent == event.id)
                .accessibilityAddTraits(duoSelectedEvent == event.id ? .isSelected : [])
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityIdentifier("home.events")
    }

    /// Card-shaped placeholders in the real cards' footprint (two equal columns), so nothing below moves.
    private func eventSkeleton(width: CGFloat) -> some View {
        let column = CGFloat(DIPHomeCardLayout.equalColumnWidth(count: 2, available: Double(width)) ?? 163)
        return HStack(spacing: 10) {
            DIPSkeleton(cornerRadius: 20).frame(width: column, height: 205)
            DIPSkeleton(cornerRadius: 20).frame(width: column, height: 205)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading events")
        .accessibilityIdentifier("home.events.loading")
    }

    /// Nothing cached and the read failed: the shared empty-state format with one retry in place; the rest of
    /// Home stays usable. The message is a single line.
    private func eventFailure(_ message: String) -> some View {
        DIPEmptyState(
            screen: "home-events-error", title: "Couldn’t load events", message: message,
            actionTitle: onRetryEvents == nil ? nil : "Try again", action: onRetryEvents.map { retry in { DIPHaptics.select(); retry() } })
    }

    /// "Matching your interests" / "All events": the solid thumb is the pressable control (the same toggle as
    /// My Events); the count and the interest chips are informational, so they are outlined or tinted.
    private func interestFilterBar(_ filter: DIPHomeEventFilter) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            DIPSegmentedToggle(
                segments: [
                    .init(id: DIPHomeEventScope.matching, title: "Your interests", identifier: "home.filter.matching"),
                    .init(id: DIPHomeEventScope.all, title: "All events", identifier: "home.filter.all"),
                ],
                selection: filter.scope, accent: DIPTokens.Color.actionPrimary.swiftUIColor, onSelect: onFilterScope)
            if filter.scope == .matching {
                ScrollView(.horizontal) {
                    HStack(spacing: 8) {
                        // Hidden when nothing matches: the empty state below already says so.
                        if filter.shownCount > 0 {
                            outlinedChip("Showing \(filter.shownCount) of \(filter.totalCount) events\(onLoadMore == nil ? "" : " loaded")")
                                .accessibilityIdentifier("home.filter.count")
                        }
                        ForEach(filter.interests) { interest in tintChip(interest.name) }
                    }
                    .padding(.horizontal, 2)
                }
                .scrollIndicators(.hidden)
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("home.filter.chips")
                .transition(.opacity)
            }
        }
    }

    /// A read-only interest label: tinted, no outline, so it does not look tappable.
    private func tintChip(_ text: String) -> some View {
        Text(text)
            .font(DIPReferenceAssets.font("Inter-Regular", size: 13))
            .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor.opacity(0.7))
            .padding(.horizontal, 12).dipFixedFrame(height: 28)
            .background(DIPTokens.Color.actionPrimary.swiftUIColor.opacity(0.10), in: Capsule())
    }

    private func outlinedChip(_ text: String) -> some View {
        Text(text)
            .font(DIPReferenceAssets.font("Inter-Regular", size: 13))
            .foregroundStyle(DIPTokens.Color.actionPrimary.swiftUIColor)
            .padding(.horizontal, 12).dipFixedFrame(height: 28)
            .overlay(Capsule().strokeBorder(DIPTokens.Color.actionPrimary.swiftUIColor, lineWidth: 1.5))
    }

    private var recentAttendees: some View {
        VStack(alignment: .leading, spacing: 14) {
            sectionTitle("Attended Your Recent Events:")
            if home.recentAttendeeAvatars.isEmpty {
                DIPEmptyState(
                    screen: "home-recents", title: "Events you’ve attended will show up here",
                    message: "Join one this week and your coworkers will appear here.")
            } else {
                HStack(spacing: 10) {
                    ForEach(Array(home.recentAttendeeAvatars.enumerated()), id: \.offset) { _, avatar in
                        DIPMedia(avatar)
                            .resizable().frame(width: 40, height: 40).accessibilityHidden(true)
                    }
                    Button {
                        onSelect("Recent attendees")
                    } label: {
                        Text("See All").font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                            .foregroundStyle(.white).frame(maxWidth: .infinity).dipFixedFrame(height: 40)
                            .background(
                                DIPTokens.Color.navigationBackground.swiftUIColor, in: Capsule())
                    }
                    .buttonStyle(.plain).accessibilityIdentifier("home.attendees")
                }
            }
        }
    }
    /// Fixture cards keep their design-reference asset names as identifiers. Category cover
    /// images (V1-08, `cover_*`) are shared by many events, so those cards use the stable event ID.
    nonisolated static func eventIdentifier(_ event: DIPEventSummary) -> String {
        if case .asset(let name) = event.image, !name.hasPrefix("cover_") { return name }
        return event.id
    }
    private func sectionTitle(_ text: String, size: CGFloat = 17) -> some View {
        Text(text).font(DIPReferenceAssets.font("Figtree-Regular", size: size))
            .foregroundStyle(.black).dipFixedFrame(height: 22, alignment: .leading)
            .accessibilityAddTraits(.isHeader)
    }
}

private struct MemberEventRefresh: ViewModifier {
    let action: (() async -> Void)?
    @ViewBuilder func body(content: Content) -> some View {
        if let action { content.refreshable { await action() } } else { content }
    }
}
