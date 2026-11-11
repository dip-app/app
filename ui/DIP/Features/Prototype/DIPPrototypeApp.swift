import DIPCore
import DIPMockData
import DIPPresentation
import DIPDesignSystem
import SwiftUI

/// Composition root: only this host chooses the repository implementation.
/// Navigation/picker state stays here; product state comes exclusively from repository observation.
struct DIPPrototypeApp: View {
    private typealias Route = EventBarAction.Route
    @State private var selectedTab: DIPHomeTab
    @State private var routes: [Route]
    @State private var model: DIPAppViewModel
    @State private var observationID = UUID()
    @State private var notice: String?
    @State private var rsvpError: String?
    @State private var showChat = false
    @State private var chatNotificationLevel: DIPNotificationLevel?
    @State private var chatEventID = "puppy-yoga"
    private let initialMemories: Bool
    private let onSignOut: (() async -> Void)?
    private let accountProfile: DIPProfile?
    private let interestCatalogLoading: Bool
    private let interestCatalogError: String?
    private let onRetryInterestCatalog: (() -> Void)?
    private let eventReadsOnly: Bool
    /// Live events with working RSVP, attendees and My Events (setRsvpV1 + RSVP reads).
    private let liveParticipation: Bool
    private var participationUnavailable: Bool { eventReadsOnly && !liveParticipation }
    private let onEventOpened: ((String?) -> Void)?
    private let onRefreshEvents: (() async -> Void)?
    private let onLoadMoreEvents: (() -> Void)?
    private let loadingMoreEvents: Bool
    private let eventPaginationError: String?
    private let onProfileSave: ((ProfileEdit) async throws -> Void)?
    /// Reports what is on screen for the onboarding handoff (spec §3 H "Surface signal").
    private let onSurfaceChange: ((OnboardingHomeSurface) -> Void)?
    /// Profile's "How DIP works" row; nil hides it.
    private let onReplayTour: (() -> Void)?
    /// Event id from a share link or `dip://events/<id>`; opened once, then reported through `onDeepLinkHandled`.
    private let deepLinkEventID: String?
    private let onDeepLinkHandled: ((String) -> Void)?

    init(initialScreen: String? = nil, repository: (any DIPRepository)? = nil, onSignOut: (() async -> Void)? = nil,
         accountProfile: DIPProfile? = nil, interestCatalogLoading: Bool = false,
         interestCatalogError: String? = nil, onRetryInterestCatalog: (() -> Void)? = nil,
         onProfileSave: ((ProfileEdit) async throws -> Void)? = nil,
         eventReadsOnly: Bool = false, liveParticipation: Bool = false, onEventOpened: ((String?) -> Void)? = nil,
         onLoadMoreEvents: (() -> Void)? = nil, loadingMoreEvents: Bool = false,
         eventPaginationError: String? = nil, onRefreshEvents: (() async -> Void)? = nil,
         onSurfaceChange: ((OnboardingHomeSurface) -> Void)? = nil, onReplayTour: (() -> Void)? = nil,
         deepLinkEventID: String? = nil, onDeepLinkHandled: ((String) -> Void)? = nil) {
        self.deepLinkEventID = deepLinkEventID
        self.onDeepLinkHandled = onDeepLinkHandled
        self.onSurfaceChange = onSurfaceChange
        self.onReplayTour = onReplayTour
        self.onRefreshEvents = onRefreshEvents
        self.eventReadsOnly = eventReadsOnly; self.liveParticipation = liveParticipation; self.onEventOpened = onEventOpened
        self.onLoadMoreEvents = onLoadMoreEvents; self.loadingMoreEvents = loadingMoreEvents
        self.eventPaginationError = eventPaginationError
        self.accountProfile = accountProfile
        self.interestCatalogLoading = interestCatalogLoading
        self.interestCatalogError = interestCatalogError
        self.onRetryInterestCatalog = onRetryInterestCatalog
        self.onProfileSave = onProfileSave
        self.onSignOut = onSignOut
        let argument = ProcessInfo.processInfo.arguments.first { $0.hasPrefix("--screen=") }
        let screen = initialScreen ?? argument.map { String($0.dropFirst("--screen=".count)) } ?? "home"
        _selectedTab = State(
            initialValue: screen == "profile" ? .profile : screen == "rewards" ? .rewards : ["events", "memories"].contains(screen) ? .events : .home)
        initialMemories = screen == "memories"
        switch screen {
        case "event", "event-joined": _routes = State(initialValue: [.event("puppy-yoga")])
        case "attendees": _routes = State(initialValue: [.participants("puppy-yoga")])
        case "past-event": _routes = State(initialValue: [.event("kayaking-memory")])
        case "album": _routes = State(initialValue: [.album("kayaking-memory")])
        case "challenge": _routes = State(initialValue: [.challenge("fitness-challenge")])
        default: _routes = State(initialValue: [])
        }
        _model = State(initialValue: DIPAppViewModel(repository: repository ?? DIPMockRepository(
            initialSnapshot: Self.emptyStateFixture().map(DIPMockFixtures.emptyStateReview)
                ?? (ProcessInfo.processInfo.arguments.contains("--many-tags")
                ? DIPMockFixtures.manyTagsReview()
                : ProcessInfo.processInfo.arguments.contains("--v1-event-fixtures")
                ? DIPMockFixtures.v1Events()
                : ProcessInfo.processInfo.arguments.contains("--empty-social-fixtures")
                ? DIPMockFixtures.emptySocialReview
                : ProcessInfo.processInfo.arguments.contains("--chat-grouping-fixtures")
                ? DIPMockFixtures.chatGroupingReview
                : ProcessInfo.processInfo.arguments.contains("--chat-history-fixtures")
                ? DIPMockFixtures.chatHistoryReview
                : ProcessInfo.processInfo.arguments.contains("--comment-bubble-fixtures")
                ? DIPMockFixtures.photoCommentReview
                : ["event", "event-joined", "past-event"].contains(screen)
                ? DIPMockFixtures.v1Events() : DIPMockFixtures.reference),
            initiallyJoinedEventIDs: screen == "event-joined" ? ["puppy-yoga"] : [],
            initialFailures: Self.previewFailures())))
    }

    /// `--empty-state=<fixture>` (see `DIPEmptyStateFixture`) for designed empty-state review only.
    private static func emptyStateFixture() -> DIPEmptyStateFixture? {
        ProcessInfo.processInfo.arguments.first { $0.hasPrefix("--empty-state=") }
            .flatMap { DIPEmptyStateFixture(rawValue: String($0.dropFirst("--empty-state=".count))) }
    }

    /// Deterministic failure paths for local preview/UI testing only.
    private static func previewFailures() -> [DIPMockOperation: String] {
        var failures: [DIPMockOperation: String] = [:]
        if ProcessInfo.processInfo.arguments.contains("--fail-profile-once") { failures[.profile] = "Preview failure" }
        if ProcessInfo.processInfo.arguments.contains("--fail-chat-once") { failures[.message] = "Preview failure" }
        if ProcessInfo.processInfo.arguments.contains("--fail-comment-once") { failures[.comment] = "Preview failure" }
        return failures
    }

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// Live weekly theme (configured member Home). Nil: the snapshot's fixture challenge is shown.
    @Environment(\.weeklyChallengeFeed) private var challengeFeed
    @State private var albumPickerPresented = false
    /// The tab whose name the fixed header shows (the last non-Profile tab while Profile is selected).
    @State private var headerTab: DIPHomeTab = .home
    // Avatar flight between the header capsule and the Profile badge (see `avatarFlyer`).
    @State private var flightFrame = CGRect.zero
    @State private var flightRing: CGFloat = 0
    @State private var isAvatarFlying = false
    @State private var flightGeneration = 0
    /// The Profile badge's last settled frame in screen coordinates (nil until the page reports one).
    @State private var settledBadgeFrame: CGRect?
    /// The latest badge frame the page reported, settled or not (used to correct the endpoint after a flight).
    @State private var rawBadgeFrame: CGRect?
    /// Photo to open the viewer on for an album reached from a Profile memory; cleared on back.
    @State private var memoryPhotoIDs: [String: String?] = [:]

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .top) {
                NavigationStack(path: $routes) {
                    loadedPages
                        .ignoresSafeArea()
                        .toolbar(.hidden, for: .tabBar)
                        .toolbar(.hidden, for: .navigationBar)
                        .navigationDestination(for: Route.self) { route in
                            destination(route)
                                .navigationBarBackButtonHidden()
                                .toolbar(.hidden, for: .navigationBar)
                        }
                }
                DIPFloatingNavigation(
                    selected: selectedTab, action: bottomAction,
                    onSelect: selectTab, onAction: performBottomAction
                )
                .disabled(isRSVPPending)
                .padding(.horizontal, 20)
                .position(x: geometry.size.width / 2, y: geometry.size.height - 61)
                avatarFlyer
            }
            .background(.white)
            .onAppear { if flightFrame == .zero { flightFrame = idleAvatarFrame(for: selectedTab, in: geometry.size) } }
            .onChange(of: selectedTab) { old, new in flyAvatar(from: old, to: new, in: geometry.size) }
        }
        .ignoresSafeArea()
        .preferredColorScheme(.light)
        .alert(
            "Not available yet",
            isPresented: Binding(
                get: { notice != nil }, set: { if !$0 { notice = nil } })
        ) {
            Button("OK") { notice = nil }
        } message: {
            Text("\(notice ?? "") is not connected yet.")
        }
        .sheet(isPresented: $showChat) {
            DIPActivityChatScreen(
                eventTitle: model.snapshot?.eventDetails[chatEventID]?.title ?? "Activity Chat",
                messages: model.snapshot?.messages[chatEventID] ?? [],
                currentUserID: model.snapshot?.profile.id ?? "",
                onSend: { try await model.sendMessage(eventID: chatEventID, messageID: $0, text: $1) },
                notificationLevel: chatNotificationLevel,
                onSetNotificationLevel: { level in
                    let previous = chatNotificationLevel
                    chatNotificationLevel = level
                    do { try await model.setNotificationLevel(eventID: chatEventID, level: level) }
                    catch { chatNotificationLevel = previous }
                })
            .task(id: chatEventID) { chatNotificationLevel = await model.notificationLevel(eventID: chatEventID) }
        }
        .onChange(of: routes, initial: true) { _, path in
            if case .event(let id) = path.last { onEventOpened?(id) } else { onEventOpened?(nil) }
        }
        .onChange(of: deepLinkEventID, initial: true) { _, id in
            guard let id else { return }
            // Open the linked event on top of the current tab; an id outside this company shows "Activity unavailable".
            routes = [.event(id)]
            showChat = false
            onDeepLinkHandled?(id)
        }
        .task(id: observationID) { await model.observe() }
        .onChange(of: surface, initial: true) { _, surface in onSurfaceChange?(surface) }
        .alert("Couldn’t save", isPresented: Binding(
            get: { rsvpError != nil },
            set: { if !$0 { rsvpError = nil } }
        )) { Button("OK") { rsvpError = nil } }
        message: { Text(rsvpError ?? "") }
    }

    @ViewBuilder private var loadedPages: some View {
        if let snapshot = model.snapshot {
            VStack(spacing: 0) {
                if model.loadError != nil {
                    Button("Updates paused — Retry") { observationID = UUID() }
                        .font(.footnote).padding(.top, 50)
                        .accessibilityIdentifier("data.retry")
                }
                tabPages(snapshot)
            }
            .overlay(alignment: .top) { fixedHeader(snapshot) }
        } else if model.isLoading {
            ProgressView("Loading…").frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ContentUnavailableView {
                Label("Couldn’t load your activities", systemImage: "wifi.exclamationmark")
            } description: {
                Text(model.loadError ?? "Please try again.")
            } actions: {
                Button("Retry") { observationID = UUID() }.accessibilityIdentifier("data.retry")
            }
        }
    }

    private func tabPages(_ snapshot: DIPAppSnapshot) -> some View {
        let lists = DIPEventLists(snapshot: snapshot, now: Date())
        var home = snapshot.home
        home.events = lists.discovery
        let pages: (DIPHomeTab) -> AnyView = { tab in
            switch tab {
            case .home:
                AnyView(DIPHomeScreen(
                    home: home, showsBottomBar: false,
                    onEvent: { routes.append(.event($0)) },
                    onChallenge: { routes.append(.challenge($0)) }, onSelect: homeSelection,
                    onLoadMore: onLoadMoreEvents, loadingMore: loadingMoreEvents,
                    paginationError: eventPaginationError,
                    eventSectionTitle: eventReadsOnly ? "Upcoming events" : "This Week’s Events",
                    onRefresh: homeRefresh, challengeState: challengeFeed?.state,
                    onRetryChallenge: challengeFeed.map { feed in { Task { await feed.load() } } }))
            case .events:
                if participationUnavailable {
                    AnyView(ContentUnavailableView("My Events isn’t available yet", systemImage: "calendar",
                        description: Text("You can browse company events from Home.")))
                } else { AnyView(DIPMyEventsScreen(
                    activeEvents: lists.upcoming, memories: lists.past,
                    unreadCount: snapshot.home.unreadCount, profileAvatar: snapshot.home.profileAvatar,
                    initialMemories: initialMemories, showsBottomBar: false,
                    onSelectTab: selectTab,
                    onEvent: { routes.append(.event($0)) }, onAlbum: { routes.append(.event($0)) },
                    onNotifications: { notice = "Notifications" }, onProfile: { selectTab(.profile) })) }
            case .profile:
                AnyView(DIPProfileScreen(
                    profile: accountProfile ?? snapshot.profile, showsBottomBar: false, onSelectTab: selectTab,
                    onMemory: { event, photo in memoryPhotoIDs[event] = photo; routes.append(.album(event)) },
                    onSave: { edit in
                        if let onProfileSave { try await onProfileSave(edit) }
                        else { try await model.updateProfile(edit) }
                    }, onSignOut: onSignOut, interestCatalogLoading: interestCatalogLoading,
                    interestCatalogError: interestCatalogError, onRetryInterestCatalog: onRetryInterestCatalog,
                    onReplayTour: onReplayTour))
            case .rewards:
                AnyView(DIPRewardsScreen(
                    unreadCount: snapshot.home.unreadCount, profileAvatar: snapshot.home.profileAvatar,
                    showsBottomBar: false, onSelectTab: selectTab,
                    onNotifications: { notice = "Notifications" }, onProfile: { selectTab(.profile) }))
            }
        }
        // Home, Rewards and My Events share one header drawn by the shell (fixed while pages slide);
        // Profile has its own header card that scrolls with its page.
        return DIPSlidingPages(selection: selectedTab, reduceMotion: reduceMotion) { tab in
            AnyView(pages(tab).environment(\.dipHeaderHosted, tab != .profile)
                .environment(\.profileBadgeLink, ProfileBadgeLink(isHidden: isAvatarFlying, report: reportBadgeFrame)))
        }
    }

    // MARK: Avatar flight

    private func headerAvatarFrame(in size: CGSize) -> CGRect {
        // Corner capsule: 20pt screen inset, 5pt capsule padding, 40pt avatar, header 60pt from the top.
        CGRect(x: size.width - 20 - 5 - 40, y: 60 + 5, width: 40, height: 40)
    }

    private func idleAvatarFrame(for tab: DIPHomeTab, in size: CGSize) -> CGRect {
        tab == .profile ? (settledBadgeFrame ?? ProfileBadgeLink.fallbackFrame()) : headerAvatarFrame(in: size)
    }

    /// Frames reported while the avatar flies or while another tab is selected are mid-slide values,
    /// so only a settled Profile page updates the badge endpoint.
    private func reportBadgeFrame(_ frame: CGRect) {
        rawBadgeFrame = frame
        guard selectedTab == .profile, !isAvatarFlying, frame.width > 0 else { return }
        settledBadgeFrame = frame
        flightFrame = frame
    }

    /// One avatar view in the shell overlay travels between the capsule and the Profile badge with a
    /// spring; a tab change mid-flight retargets from the current position. Reduce Motion and the first
    /// layout skip the flight (the header and badge simply crossfade).
    private func flyAvatar(from old: DIPHomeTab, to new: DIPHomeTab, in size: CGSize) {
        guard (old == .profile) != (new == .profile), !reduceMotion else {
            if !isAvatarFlying { flightFrame = idleAvatarFrame(for: new, in: size) }
            return
        }
        if !isAvatarFlying {
            flightFrame = idleAvatarFrame(for: old, in: size)
            flightRing = old == .profile ? 3 : 0
            isAvatarFlying = true
        }
        flightGeneration += 1
        let generation = flightGeneration
        let target = idleAvatarFrame(for: new, in: size)
        withAnimation(DIPMotion.marker, completionCriteria: .logicallyComplete) {
            flightFrame = target
            flightRing = new == .profile ? 3 : 0
        } completion: {
            guard generation == flightGeneration else { return }
            var landed = target
            // The page has finished sliding by now: trust its own badge frame if it differs from the estimate.
            if new == .profile, let raw = rawBadgeFrame, raw.minX >= 0, raw.maxX <= size.width + 1, raw.width > 0 {
                settledBadgeFrame = raw
                landed = raw
            }
            isAvatarFlying = false
            flightFrame = landed
        }
    }

    @ViewBuilder private var avatarFlyer: some View {
        if isAvatarFlying, let snapshot = model.snapshot {
            DIPMedia(snapshot.home.profileAvatar)
                .frame(width: flightFrame.width, height: flightFrame.height)
                .clipShape(Circle())
                .overlay(Circle().strokeBorder(.white, lineWidth: flightRing))
                .position(x: flightFrame.midX, y: flightFrame.midY)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
    }

    /// The fixed tab header. On Profile it fades and lifts out of the way, keeping the last label.
    private func fixedHeader(_ snapshot: DIPAppSnapshot) -> some View {
        let away = selectedTab == .profile
        return DIPHomeHeader(
            title: headerTab.rawValue, unreadCount: snapshot.home.unreadCount,
            profileAvatar: {
                // Hidden instantly while the flyer carries the avatar (no cross-fade ghost).
                DIPMedia(snapshot.home.profileAvatar).opacity(isAvatarFlying ? 0 : 1)
                    .transaction(value: isAvatarFlying) { $0.animation = nil }
            },
            onNotifications: { notice = "Notifications" }, onProfile: { selectTab(.profile) }
        )
        .environment(\.dipHeaderHosted, false)
        .padding(.horizontal, 20).padding(.top, 60)
        .opacity(away ? 0 : 1)
        .offset(y: away ? -16 : 0)
        .allowsHitTesting(!away)
        .accessibilityHidden(away)
        .animation(reduceMotion ? .linear(duration: DIPMotion.reducedMotionDuration) : DIPMotion.marker, value: away)
        .onChange(of: selectedTab, initial: true) { _, tab in if tab != .profile { headerTab = tab } }
    }

    /// The onboarding handoff's view of this shell: loading, failed, or showing a snapshot.
    private var surface: OnboardingHomeSurface {
        if model.snapshot != nil { return .ready }
        return model.isLoading ? .activitiesLoading : .activitiesError
    }

    private var isRSVPPending: Bool {
        switch routes.last {
        case .event(let id), .participants(let id): return model.pendingCommands.contains("rsvp:\(id)")
        case .challenge(let id): return model.pendingCommands.contains("challenge:\(id)")
        default: return false
        }
    }

    private var bottomAction: DIPBottomBarAction? {
        EventBarAction.resolve(route: routes.last, snapshot: model.snapshot, isLoading: model.isLoading)
    }

    private func performBottomAction() {
        switch routes.last {
        case .event(let id):
            if model.snapshot?.eventDetails[id]?.isPast == true { routes.append(.album(id)) }
            else if model.snapshot?.eventDetails[id]?.isJoined == true { openChat(id) }
            else { join(id) }
        case .participants(let id):
            if model.snapshot?.eventDetails[id]?.isPast == true { routes.append(.album(id)) }
            else if model.snapshot?.eventDetails[id]?.isJoined == true { openChat(id) }
            else { join(id) }
        case .album: albumPickerPresented = true
        case .challenge, nil: break
        }
    }

    private func openChat(_ eventID: String) {
        guard let event = model.snapshot?.eventDetails[eventID], event.isJoined, !event.isPast else { return }
        chatEventID = eventID
        showChat = true
    }

    /// Pull-to-refresh reloads the weekly theme alongside events.
    private var homeRefresh: (() async -> Void)? {
        guard challengeFeed != nil || onRefreshEvents != nil else { return nil }
        return { [challengeFeed, onRefreshEvents] in
            await challengeFeed?.load()
            await onRefreshEvents?()
        }
    }

    private func join(_ eventID: String) {
        guard !participationUnavailable else { notice = "RSVP"; return }
        changeRSVP(eventID, going: true)
    }

    /// Readable RSVP failure text (the live adapter sends user-facing invalidInput messages).
    nonisolated static func rsvpMessage(_ error: Error) -> String {
        switch error as? DIPRepositoryError {
        case .invalidInput(let message)?, .injectedFailure(let message)?: message
        case .notFound?: "This event no longer exists."
        case nil: "Couldn’t change your RSVP. Please try again."
        }
    }

    private func changeRSVP(_ eventID: String, going: Bool) {
        guard !participationUnavailable else { notice = "RSVP"; return }
        guard !model.pendingCommands.contains("rsvp:\(eventID)") else { return }
        // Local reasonableness check before the optimistic flip: a refused change gets the failure haptic and
        // a clear message, and the state never changes.
        if let event = model.snapshot?.eventDetails[eventID], let metadata = event.metadata,
           let denial = DIPParticipationRules.denial(going: going, metadata: metadata, attendeeCount: event.attendeeCount,
                                                     isGoing: event.isJoined, now: Date()) {
            DIPHaptics.failure(); rsvpError = denial.message; return
        }
        // The repository flips the state immediately, so the success haptic plays now; a server failure rolls back.
        DIPHaptics.success()
        Task {
            do { try await model.setRSVP(eventID: eventID, going: going) }
            catch { DIPHaptics.failure(); rsvpError = Self.rsvpMessage(error) }
        }
    }

    @ViewBuilder private func destination(_ route: Route) -> some View {
        if let snapshot = model.snapshot {
            switch route {
            case .event(let id):
                if let event = snapshot.eventDetails[id] {
                    DIPEventDetailsScreen(
                        event: event, joined: event.isJoined, showsBottomBar: false,
                        onJoin: { join(id) }, onBack: pop,
                        onAttendees: { if participationUnavailable { notice = "Attendee lists" } else { routes.append(.participants(id)) } }, onChat: { openChat(id) },
                        photos: snapshot.albums[id]?.photos ?? [], onAlbum: { routes.append(.album(id)) },
                        onLeave: { changeRSVP(id, going: false) })
                    .disabled(isRSVPPending)
                } else { missingResource }
            case .challenge(let id):
                if let challenge = challengeFeed?.detail(id) ?? snapshot.challengeDetails[id] {
                    DIPChallengeDetailsScreen(challenge: challenge, onBack: pop)
                } else { missingResource }
            case .participants(let id):
                if let people = snapshot.participants[id] {
                    DIPParticipantsScreen(
                        people: people, participantCount: people.count,
                        showsBottomBar: false, onBack: pop, onChat: { openChat(id) })
                } else { missingResource }
            case .album(let id):
                if let album = snapshot.albums[id] {
                    DIPAlbumScreen(
                        album: album, commentsByPhoto: snapshot.photoComments[id] ?? [:],
                        currentUser: accountProfile ?? snapshot.profile, showsBottomBar: false,
                        initialPhotoID: memoryPhotoIDs[id] ?? nil,
                        isPickerPresented: $albumPickerPresented, onBack: pop,
                        onAddPhotos: { try await model.addPhotos(eventID: id, photos: $0) },
                        onAddComment: { try await model.addPhotoComment(
                            eventID: id, photoID: $0, commentID: $1, text: $2) })
                } else { missingResource }
            }
        } else { ProgressView("Loading…") }
    }

    private var missingResource: some View {
        ContentUnavailableView {
            Label("Activity unavailable", systemImage: "calendar.badge.exclamationmark")
        } description: {
            Text("This activity isn’t available to your account. It may belong to another company or no longer exist.")
        } actions: { Button("Back", action: pop) }
    }

    private func selectTab(_ tab: DIPHomeTab) {
        withAnimation(DIPMotion.navigation(reduceMotion: reduceMotion)) {
            selectedTab = tab
            routes = []
        }
    }
    private func pop() {
        if case .album(let id)? = routes.last { memoryPhotoIDs[id] = nil }
        if !routes.isEmpty { routes.removeLast() }
    }
    private func homeSelection(_ selection: String) {
        switch selection {
        case "Profile": selectTab(.profile)
        case "My Events": selectTab(.events)
        case "Home": selectTab(.home)
        case "Recent attendees": if eventReadsOnly { notice = "Attendee lists" } else { routes.append(.participants("puppy-yoga")) }
        default: notice = selection
        }
    }
}
