import DIPCore
import DIPMockData
import DIPPresentation
import DIPDesignSystem
import SwiftUI

/// Composition root: only this host chooses the repository implementation.
/// Navigation/picker state stays here; product state comes exclusively from repository observation.
struct DIPPrototypeApp: View {
    private enum Route: Hashable {
        case event(String)
        case participants(String)
        case album(String)
        case challenge(String)
    }
    @State private var selectedTab: DIPHomeTab
    @State private var routes: [Route]
    @State private var model: DIPAppViewModel
    @State private var observationID = UUID()
    @State private var notice: String?
    @State private var rsvpError: String?
    @State private var showChat = false
    @State private var chatEventID = "puppy-yoga"
    private let initialMemories: Bool
    private let onSignOut: (() async -> Void)?
    private let accountProfile: DIPProfile?
    private let interestCatalogLoading: Bool
    private let interestCatalogError: String?
    private let onRetryInterestCatalog: (() -> Void)?
    private let eventReadsOnly: Bool
    private let onEventOpened: ((String?) -> Void)?
    private let onRefreshEvents: (() async -> Void)?
    private let onLoadMoreEvents: (() -> Void)?
    private let loadingMoreEvents: Bool
    private let eventPaginationError: String?
    private let onProfileSave: ((ProfileEdit) async throws -> Void)?

    init(initialScreen: String? = nil, repository: (any DIPRepository)? = nil, onSignOut: (() async -> Void)? = nil,
         accountProfile: DIPProfile? = nil, interestCatalogLoading: Bool = false,
         interestCatalogError: String? = nil, onRetryInterestCatalog: (() -> Void)? = nil,
         onProfileSave: ((ProfileEdit) async throws -> Void)? = nil,
         eventReadsOnly: Bool = false, onEventOpened: ((String?) -> Void)? = nil,
         onLoadMoreEvents: (() -> Void)? = nil, loadingMoreEvents: Bool = false,
         eventPaginationError: String? = nil, onRefreshEvents: (() async -> Void)? = nil) {
        self.onRefreshEvents = onRefreshEvents
        self.eventReadsOnly = eventReadsOnly; self.onEventOpened = onEventOpened
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
            initialValue: screen == "profile" ? .profile : ["events", "memories"].contains(screen) ? .events : .home)
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
            initialSnapshot: ProcessInfo.processInfo.arguments.contains("--empty-social-fixtures")
                ? DIPMockFixtures.emptySocialReview
                : ProcessInfo.processInfo.arguments.contains("--chat-grouping-fixtures")
                ? DIPMockFixtures.chatGroupingReview
                : ProcessInfo.processInfo.arguments.contains("--chat-history-fixtures")
                ? DIPMockFixtures.chatHistoryReview
                : ProcessInfo.processInfo.arguments.contains("--comment-bubble-fixtures")
                ? DIPMockFixtures.photoCommentReview : DIPMockFixtures.reference,
            initiallyJoinedEventIDs: screen == "event-joined" ? ["puppy-yoga"] : [],
            initialFailures: Self.previewFailures())))
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
    @State private var albumPickerPresented = false

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
            }
            .background(.white)
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
                onSend: { try await model.sendMessage(eventID: chatEventID, messageID: $0, text: $1) })
        }
        .onChange(of: routes, initial: true) { _, path in
            if case .event(let id) = path.last { onEventOpened?(id) } else { onEventOpened?(nil) }
        }
        .task(id: observationID) { await model.observe() }
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
        return DIPSlidingPages(selection: selectedTab, reduceMotion: reduceMotion) { tab in
            switch tab {
            case .home:
                AnyView(DIPHomeScreen(
                    home: home, showsBottomBar: false,
                    onEvent: { routes.append(.event($0)) },
                    onChallenge: { routes.append(.challenge($0)) }, onSelect: homeSelection,
                    onLoadMore: onLoadMoreEvents, loadingMore: loadingMoreEvents,
                    paginationError: eventPaginationError,
                    eventSectionTitle: eventReadsOnly ? "Upcoming events" : "This Week’s Events",
                    onRefresh: onRefreshEvents))
            case .events:
                if eventReadsOnly {
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
                    onMemory: { routes.append(.album($0)) },
                    onSave: { edit in
                        if let onProfileSave { try await onProfileSave(edit) }
                        else { try await model.updateProfile(edit) }
                    }, onSignOut: onSignOut, interestCatalogLoading: interestCatalogLoading,
                    interestCatalogError: interestCatalogError, onRetryInterestCatalog: onRetryInterestCatalog))
            case .rewards: AnyView(EmptyView())
            }
        }
    }

    private var isRSVPPending: Bool {
        switch routes.last {
        case .event(let id), .participants(let id): return model.pendingCommands.contains("rsvp:\(id)")
        case .challenge(let id): return model.pendingCommands.contains("challenge:\(id)")
        default: return false
        }
    }

    private var bottomAction: DIPBottomBarAction? {
        switch routes.last {
        case .event(let id):
            guard let event = model.snapshot?.eventDetails[id] else {
                return DIPBottomBarAction(
                    title: model.isLoading ? "Loading…" : "Activity unavailable",
                    style: .complete, identifier: "event.primary")
            }
            if event.isPast { return DIPBottomBarAction(title: "View Album", identifier: "event.primary") }
            let joined = event.isJoined
            if let metadata = event.metadata {
                switch metadata.state(now: Date(), attendeeCount: event.attendeeCount, isJoined: joined) {
                case .cancelled: return DIPBottomBarAction(title: "Activity cancelled", style: .complete, identifier: "event.primary")
                case .full: return DIPBottomBarAction(title: "Activity full", style: .complete, identifier: "event.primary")
                case .started where !joined: return DIPBottomBarAction(title: "Activity started", style: .complete, identifier: "event.primary")
                default: break
                }
            }
            return DIPBottomBarAction(
                title: joined ? "Activity Chat" : "Join the Activity",
                style: joined ? .accent : .standard,
                identifier: "event.primary", value: joined ? "Joined" : "Not joined")
        case .participants(let id) where model.snapshot?.eventDetails[id]?.isPast == true:
            return DIPBottomBarAction(title: "View Album", identifier: "participants.album")
        case .participants(let id):
            let joined = model.snapshot?.eventDetails[id]?.isJoined == true
            return DIPBottomBarAction(title: joined ? "Activity Chat" : "Join the Activity",
                style: joined ? .accent : .standard,
                identifier: joined ? "participants.chat" : "participants.join")
        case .album:
            return DIPBottomBarAction(title: "Add Photos", identifier: "album.add-photos")
        case .challenge:
            return DIPBottomBarAction(title: "Add Your Entry", identifier: "challenge.primary")
        case nil: return nil
        }
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
        case .challenge: notice = "Challenge entries"
        case nil: break
        }
    }

    private func openChat(_ eventID: String) {
        guard let event = model.snapshot?.eventDetails[eventID], event.isJoined, !event.isPast else { return }
        chatEventID = eventID
        showChat = true
    }

    private func changeChallenge(_ id: String, joined: Bool) {
        guard !model.pendingCommands.contains("challenge:\(id)") else { return }
        Task {
            do { try await model.setChallengeJoined(challengeID: id, joined: joined) }
            catch { rsvpError = (error as? DIPRepositoryError).map { String(describing: $0) } ?? "Couldn’t update the challenge. Please try again." }
        }
    }

    private func join(_ eventID: String) {
        guard !eventReadsOnly else { notice = "RSVP"; return }
        changeRSVP(eventID, going: true)
    }

    private func changeRSVP(_ eventID: String, going: Bool) {
        guard !eventReadsOnly else { notice = "RSVP"; return }
        guard !model.pendingCommands.contains("rsvp:\(eventID)") else { return }
        Task {
            do { try await model.setRSVP(eventID: eventID, going: going) }
            catch { rsvpError = (error as? DIPRepositoryError).map { String(describing: $0) } ?? "Couldn’t change your RSVP. Please try again." }
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
                        onAttendees: { if eventReadsOnly { notice = "Attendee lists" } else { routes.append(.participants(id)) } }, onChat: { openChat(id) },
                        photos: snapshot.albums[id]?.photos ?? [], onAlbum: { routes.append(.album(id)) },
                        onLeave: { changeRSVP(id, going: false) })
                    .disabled(isRSVPPending)
                } else { missingResource }
            case .challenge(let id):
                if let challenge = snapshot.challengeDetails[id] {
                    DIPChallengeDetailsScreen(
                        challenge: challenge, onBack: pop, onCompleted: { notice = "Completed list" },
                        onJoin: { changeChallenge(id, joined: true) },
                        onLeave: { changeChallenge(id, joined: false) })
                    .disabled(isRSVPPending)
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
        } actions: { Button("Back", action: pop) }
    }

    private func selectTab(_ tab: DIPHomeTab) {
        guard tab != .rewards else {
            notice = "Rewards"
            return
        }
        withAnimation(DIPMotion.navigation(reduceMotion: reduceMotion)) {
            selectedTab = tab
            routes = []
        }
    }
    private func pop() { if !routes.isEmpty { routes.removeLast() } }
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
