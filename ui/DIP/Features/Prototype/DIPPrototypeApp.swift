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
    /// Album upload drafts, owned here so uploads continue while the member navigates.
    @State private var uploads: AlbumUploadQueue
    @State private var observationID = UUID()
    @State private var notice: String?
    @State private var rsvpError: String?
    @State private var showChat = false
    @State private var chatNotificationLevel: DIPNotificationLevel?
    @State private var chatEventID = "puppy-yoga"
    /// Coworker invitations (F4): nil when there is no invitations adapter (the bell then says "not connected").
    @State private var invites: DIPInvitesModel?
    @State private var showInvitations = false
    @State private var invitesObservationID = UUID()
    @State private var inviteSession: InviteSession?
    private let startsWithInvitePicker: Bool
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
    /// The photo open in an album's viewer (event ID, photo ID or nil), for live comment observation.
    private let onPhotoViewed: ((String, String?) -> Void)?
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
    /// The deep link asked for the chat (`.../chat`); honoured when the member is going to the event.
    private let deepLinkOpensChat: Bool
    /// Called after the member's join was accepted (push permission priming hangs off the first one).
    private let onJoined: (() -> Void)?

    init(initialScreen: String? = nil, repository: (any DIPRepository)? = nil, onSignOut: (() async -> Void)? = nil,
         accountProfile: DIPProfile? = nil, interestCatalogLoading: Bool = false,
         interestCatalogError: String? = nil, onRetryInterestCatalog: (() -> Void)? = nil,
         onProfileSave: ((ProfileEdit) async throws -> Void)? = nil,
         eventReadsOnly: Bool = false, liveParticipation: Bool = false, onEventOpened: ((String?) -> Void)? = nil,
         onLoadMoreEvents: (() -> Void)? = nil, loadingMoreEvents: Bool = false,
         eventPaginationError: String? = nil, onRefreshEvents: (() async -> Void)? = nil,
         onPhotoViewed: ((String, String?) -> Void)? = nil,
         onSurfaceChange: ((OnboardingHomeSurface) -> Void)? = nil, onReplayTour: (() -> Void)? = nil,
         deepLinkEventID: String? = nil, onDeepLinkHandled: ((String) -> Void)? = nil,
         deepLinkOpensChat: Bool = false, onJoined: (() -> Void)? = nil,
         invitesRepository: (any DIPInvitesRepository)? = nil) {
        self.deepLinkOpensChat = deepLinkOpensChat
        self.onJoined = onJoined
        self.deepLinkEventID = deepLinkEventID
        self.onDeepLinkHandled = onDeepLinkHandled
        self.onSurfaceChange = onSurfaceChange
        self.onReplayTour = onReplayTour
        self.onRefreshEvents = onRefreshEvents
        self.onPhotoViewed = onPhotoViewed
        self.eventReadsOnly = eventReadsOnly; self.liveParticipation = liveParticipation; self.onEventOpened = onEventOpened
        self.onLoadMoreEvents = onLoadMoreEvents; self.loadingMoreEvents = loadingMoreEvents
        self.eventPaginationError = eventPaginationError
        self.accountProfile = accountProfile
        // Read the saved scope up front so the first frame is already filtered (no flash of All events).
        _homeScope = State(initialValue: accountProfile.map { DIPHomeScopeStore().scope(uid: $0.id) } ?? .all)
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
        case "event", "event-joined", "invite-picker": _routes = State(initialValue: [.event("puppy-yoga")])
        case "attendees": _routes = State(initialValue: [.participants("puppy-yoga")])
        case "past-event": _routes = State(initialValue: [.event("kayaking-memory")])
        case "album": _routes = State(initialValue: [.album("kayaking-memory")])
        case "challenge": _routes = State(initialValue: [.challenge("fitness-challenge")])
        default: _routes = State(initialValue: [])
        }
        let model = DIPAppViewModel(repository: repository ?? DIPMockRepository(
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
                : ["event", "event-joined", "past-event", "invite-picker"].contains(screen)
                ? DIPMockFixtures.v1Events() : DIPMockFixtures.reference),
            initiallyJoinedEventIDs: screen == "event-joined" ? ["puppy-yoga"] : [],
            initialFailures: Self.previewFailures()))
        _model = State(initialValue: model)
        let uploads = AlbumUploadQueue(send: { eventID, photo, progress in
            try await model.uploadPhoto(eventID: eventID, photo: photo, progress: progress)
        })
        uploads.onRunFinished = DIPAlbumScreen.feelRun
        uploads.onDiscard = { id in Task { await model.discardUpload(uploadID: id) } }
        _uploads = State(initialValue: Self.uploadReview() ?? uploads)
        // The shell's own mock mode (previews, UI tests) gets the fixture invitations; real members get the adapter.
        let inviteSource = invitesRepository ?? (repository == nil ? Self.fixtureInvites() : nil)
        let inviteModel = inviteSource.map { DIPInvitesModel(repository: $0) }
        // Fixture invitations do not talk to the RSVP fixtures, so an accepted invite joins the fixture event here (live: the server did).
        if invitesRepository == nil, repository == nil { inviteModel?.didJoin = { id in try? await model.setRSVP(eventID: id, going: true) } }
        _invites = State(initialValue: inviteModel)
        _showInvitations = State(initialValue: inviteSource != nil && screen == "invitations")
        startsWithInvitePicker = inviteSource != nil && screen == "invite-picker"
    }

    /// Fixture invitations; `--invites-state=empty|loading|failed|full|search-failed|send-failed|already-invited|slow-send` (Debug) for review and UI tests.
    static func fixtureInvites() -> any DIPInvitesRepository {
        #if DEBUG
        let state = ProcessInfo.processInfo.arguments.first { $0.hasPrefix("--invites-state=") }.map { String($0.dropFirst("--invites-state=".count)) }
        switch state {
        case "empty": return DIPMockInvitesRepository.empty()
        case "loading": return DIPMockInvitesRepository.reference(behavior: .init(latency: .seconds(3600)))
        case "failed": return DIPMockInvitesRepository.reference(behavior: .init(observeFailure: true))
        case "full": return DIPMockInvitesRepository.reference(behavior: .init(respondFailure: .full))
        case "search-failed": return DIPMockInvitesRepository.reference(behavior: .init(searchFailure: .offline))
        case "send-failed": return DIPMockInvitesRepository.reference(behavior: .init(sendFailure: .offline))
        case "already-invited": return DIPMockInvitesRepository.reference(behavior: .init(sendFailure: .alreadyInvited))
        case "slow-send": return DIPMockInvitesRepository.reference(behavior: .init(sendLatency: .seconds(3600)))
        default: break
        }
        #endif
        return DIPMockInvitesRepository.reference()
    }

    /// One open invite sheet: its picker model is created with it and dropped with it.
    struct InviteSession: Identifiable {
        let id: String
        let title: String
        let model: DIPInvitePickerModel
    }

    /// `--album-upload-review` (Debug): the Kayaking album with three drafts (uploading at 40%, failed with a
    /// retry, finished) for design review and UI tests; nothing is sent anywhere.
    private static func uploadReview() -> AlbumUploadQueue? {
        #if DEBUG
        guard ProcessInfo.processInfo.arguments.contains("--album-upload-review") else { return nil }
        let queue = AlbumUploadQueue(send: { _, photo, progress in
            if photo.data.first == 1 { progress(0.4); try await Task.sleep(for: .seconds(3600)) }
            if photo.data.first == 2 { throw DIPRepositoryError.invalidInput(AlbumFailure.unavailable.message) }
            return photo.id
        }, prepare: { data in
            let shades: [UInt8: (Double, Double, Double)] = [1: (0.48, 0.53, 0.98), 2: (0.94, 0.33, 0.65), 3: (1, 0.8, 0.24)]
            let (r, g, b) = shades[data.first ?? 1] ?? (0.5, 0.5, 0.5)
            guard let context = CGContext(data: nil, width: 120, height: 120, bitsPerComponent: 8, bytesPerRow: 0,
                                          space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
            else { return (data, nil) }
            context.setFillColor(CGColor(red: r, green: g, blue: b, alpha: 1))
            context.fill(CGRect(x: 0, y: 0, width: 120, height: 120))
            return (data, context.makeImage().flatMap { AlbumImageProcessing.jpeg($0, quality: 0.8) })
        })
        // Sent in order: two failures and the finished photo settle first, then one stays uploading.
        queue.enqueue(eventID: "kayaking-memory", loaders: [{ Data([2]) }, { Data([2, 0]) }, { Data([3]) }, { Data([1]) }])
        return queue
        #else
        return nil
        #endif
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
    /// The theme page publishes its entry action here; the shared bottom bar below renders it.
    @State private var challengeBar = ChallengeEntryBar()
    @State private var albumPickerPresented = false
    /// The tab whose name the fixed header shows (the last non-Profile tab while Profile is selected).
    @State private var headerTab: DIPHomeTab = .home
    /// Home's interest filter scope; persisted per member on this device.
    @State private var homeScope: DIPHomeEventScope = .all
    // Avatar flight between the header capsule and the Profile badge (see `avatarFlyer`).
    @State private var flightFrame = CGRect.zero
    @State private var flightRing: CGFloat = 0
    @State private var isAvatarFlying = false
    @State private var flightGeneration = 0
    /// The Profile badge's frame in the Profile page's own (screen-aligned) space; nil until reported.
    @State private var badgeFrame: CGRect?
    /// Where the shell's overlay space starts on screen (normally zero).
    @State private var shellOrigin = CGPoint.zero
    @State private var shellSize = CGSize.zero
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
            .environment(\.challengeEntryBar, challengeBar)
            .background(.white)
            .onGeometryChange(for: CGPoint.self) { $0.frame(in: .global).origin } action: { shellOrigin = $0 }
            .onAppear { if flightFrame == .zero { flightFrame = idleAvatarFrame(for: selectedTab, in: geometry.size) } }
            .onChange(of: selectedTab) { old, new in flyAvatar(from: old, to: new, in: geometry.size) }
            .onChange(of: accountProfile?.id ?? model.snapshot?.profile.id, initial: true) { _, uid in
                if let uid { homeScope = DIPHomeScopeStore().scope(uid: uid) }
            }
        }
        .ignoresSafeArea()
        .preferredColorScheme(.light)
        .shakeToReport(screen: reportScreen)
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
        .sheet(isPresented: $showInvitations) { invitationsSheet }
        .sheet(item: $inviteSession) { session in
            DIPInviteSheet(model: session.model, eventTitle: session.title, onClose: { inviteSession = nil })
        }
        .task(id: invitesObservationID) { await invites?.observe() }
        .onAppear {
            if startsWithInvitePicker, inviteSession == nil, let invites {
                inviteSession = InviteSession(id: "puppy-yoga", title: model.snapshot?.eventDetails["puppy-yoga"]?.title ?? "Puppy Yoga",
                                              model: invites.makePicker(eventID: "puppy-yoga"))
            }
        }
        .onChange(of: routes, initial: true) { _, path in
            // The album route keeps its event observed (album photos and upload rights come with it).
            switch path.last {
            case .event(let id)?, .album(let id)?: onEventOpened?(id)
            default: onEventOpened?(nil)
            }
        }
        .onChange(of: deepLinkEventID, initial: true) { _, id in
            guard let id else { return }
            // Open the linked event on top of the current tab; an id outside this company shows "Activity unavailable".
            routes = [.event(id)]
            if deepLinkOpensChat, model.snapshot?.eventDetails[id]?.isJoined == true, model.snapshot?.eventDetails[id]?.isPast == false {
                chatEventID = id
                showChat = true
            } else { showChat = false }
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
        // Interest filter over the loaded events (no extra reads). Only members with interests the catalog
        // still knows get the control; everyone else sees Home exactly as before.
        // Fixture (non-account) Home keeps its reference layout: the control is for real members only.
        let member = accountProfile ?? snapshot.profile
        let interests = accountProfile == nil ? [] : DIPInterestFilter.activeInterests(
            storedIDs: member.interestTagIDs, catalog: member.interestCatalog.isEmpty ? nil : member.interestCatalog)
        let visible = DIPInterestFilter.visibleEvents(lists.discovery, scope: homeScope, activeInterests: interests)
        home.events = visible.events
        // Design review / UI tests: a forced loading or failed state has no events behind it.
        switch Self.previewEventsPhase { case .loading?, .failed?: home.events = []; default: break }
        let matchingCount = DIPInterestFilter.visibleEvents(lists.discovery, scope: .matching, activeInterests: interests).events.count
        let eventFilter: DIPHomeEventFilter? = interests.isEmpty ? nil : DIPHomeEventFilter(
            interests: interests, scope: homeScope, shownCount: visible.events.count, totalCount: lists.discovery.count)
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
                    onRetryChallenge: challengeFeed.map { feed in { Task { await feed.load() } } },
                    eventFilter: eventFilter, onFilterScope: { setHomeScope($0, uid: member.id, shown: matchingCount, total: eventFilter?.totalCount) },
                    eventsPhase: eventsPhase(snapshot, hasEvents: !lists.discovery.isEmpty),
                    onRetryEvents: { observationID = UUID() }))
            case .events:
                if participationUnavailable {
                    AnyView(ContentUnavailableView("My Events isn’t available yet", systemImage: "calendar",
                        description: Text("You can browse company events from Home.")))
                } else { AnyView(DIPMyEventsScreen(
                    activeEvents: lists.upcoming, memories: lists.past,
                    unreadCount: bellCount(snapshot), profileAvatar: snapshot.home.profileAvatar,
                    initialMemories: initialMemories, showsBottomBar: false,
                    onSelectTab: selectTab,
                    onEvent: { routes.append(.event($0)) }, onAlbum: { routes.append(.event($0)) },
                    onNotifications: openNotifications, onProfile: { selectTab(.profile) })) }
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
                    unreadCount: bellCount(snapshot), profileAvatar: snapshot.home.profileAvatar,
                    showsBottomBar: false, onSelectTab: selectTab,
                    onNotifications: openNotifications, onProfile: { selectTab(.profile) },
                    pointsDisplay: pointsDisplay(accountProfile == nil ? nil : (accountProfile ?? snapshot.profile).pointsBalance)))
            }
        }
        // Home, Rewards and My Events share one header drawn by the shell (fixed while pages slide);
        // Profile has its own header card that scrolls with its page.
        return DIPSlidingPages(selection: selectedTab, reduceMotion: reduceMotion) { tab in
            AnyView(pages(tab).environment(\.dipHeaderHosted, tab != .profile)
                .environment(\.profileBadgeLink, ProfileBadgeLink(isHidden: isAvatarFlying, report: reportBadgeFrame)))
        }
    }

    /// Freshness of Home's events. The snapshot only exists after a successful read, so a load error with a
    /// snapshot means the list on screen is the last good one (offline); without events it is a failure.
    private func eventsPhase(_ snapshot: DIPAppSnapshot, hasEvents: Bool) -> DIPHomeEventsPhase {
        if let forced = Self.previewEventsPhase { return forced }
        if model.loadError != nil {
            return hasEvents ? .offline : .failed("Check your connection and try again.")
        }
        return model.isLoading && !hasEvents ? .loading : .ready
    }

    /// The points pill. A fixture profile (no account) shows the design's mock. Points ride on the profile, which has no
    /// freshness signal of its own, so a data load error (the events feed is offline) flags the value as possibly out of date.
    private func pointsDisplay(_ real: Int?) -> DIPPointsDisplay {
        if let forced = Self.previewPointsDisplay { return forced }
        guard let real else { return .balance(520) }
        return model.loadError == nil ? .balance(real) : .stale(real)
    }

    /// `--home-events-state=loading|failed|offline` for design review and UI tests only.
    private static var previewEventsPhase: DIPHomeEventsPhase? {
        #if !DEBUG
        return nil
        #else
        guard let arg = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix("--home-events-state=") }) else { return nil }
        switch arg.dropFirst("--home-events-state=".count) {
        case "loading": return .loading
        case "failed": return .failed("Check your connection and try again.")
        case "offline": return .offline
        default: return nil
        }
        #endif
    }

    /// `--points-state=loading|unavailable|stale` for design review and UI tests only (`--points=<n>` sets the value).
    private static var previewPointsDisplay: DIPPointsDisplay? {
        #if !DEBUG
        return nil
        #else
        let args = ProcessInfo.processInfo.arguments
        guard let arg = args.first(where: { $0.hasPrefix("--points-state=") }) else { return nil }
        let value = args.first(where: { $0.hasPrefix("--points=") }).flatMap { Int($0.dropFirst("--points=".count)) } ?? 520
        switch arg.dropFirst("--points-state=".count) {
        case "loading": return .loading
        case "unavailable": return .unavailable
        case "stale": return .stale(value)
        default: return nil
        }
        #endif
    }

    private func setHomeScope(_ scope: DIPHomeEventScope, uid: String, shown: Int?, total: Int?) {
        guard scope != homeScope else { return }
        withAnimation(DIPMotion.filter(reduceMotion: reduceMotion)) { homeScope = scope }
        DIPHomeScopeStore().save(scope, uid: uid)
        // The counts after the switch: matching shows the filtered count, all shows every loaded event.
        if let total {
            let count = scope == .all ? total : (shown ?? total)
            AccessibilityNotification.Announcement(DIPHomeFilterAnnouncement.text(scope: scope, shown: count, total: total)).post()
        }
    }

    // MARK: Avatar flight

    private func headerAvatarFrame(in size: CGSize) -> CGRect {
        // Corner capsule: 20pt screen inset, 5pt capsule padding, 40pt avatar, header 60pt from the top.
        CGRect(x: size.width - 20 - 5 - 40, y: 60 + 5, width: 40, height: 40)
    }

    private func idleAvatarFrame(for tab: DIPHomeTab, in size: CGSize) -> CGRect {
        guard tab == .profile else { return headerAvatarFrame(in: size) }
        // Profile page space is screen-aligned; express it in the overlay's space.
        return (badgeFrame ?? ProfileBadgeLink.fallbackFrame()).offsetBy(dx: -shellOrigin.x, dy: -shellOrigin.y)
    }

    /// The Profile page reports the badge frame in its own space, which stays correct while the page
    /// slides (it moves with the page). A report while the avatar is flying toward Profile re-aims the
    /// flight to the real frame; a report while idle on Profile (scrolling) just updates the endpoint.
    private func reportBadgeFrame(_ frame: CGRect) {
        guard frame.width > 0, frame != badgeFrame else { return }
        badgeFrame = frame
        guard selectedTab == .profile else { return }
        if isAvatarFlying {
            animateFlight(toward: .profile, size: nil)
        } else {
            flightFrame = idleAvatarFrame(for: .profile, in: .zero)
        }
    }

    /// One avatar view in the shell overlay travels between the capsule and the Profile badge with a
    /// spring; a tab change mid-flight retargets from the current position. Reduce Motion and the first
    /// layout skip the flight (the header and badge simply crossfade).
    private func flyAvatar(from old: DIPHomeTab, to new: DIPHomeTab, in size: CGSize) {
        shellSize = size
        guard (old == .profile) != (new == .profile), !reduceMotion else {
            if !isAvatarFlying { flightFrame = idleAvatarFrame(for: new, in: size) }
            return
        }
        if !isAvatarFlying {
            flightFrame = idleAvatarFrame(for: old, in: size)
            flightRing = old == .profile ? 3 : 0
            isAvatarFlying = true
        }
        animateFlight(toward: new, size: size)
    }

    private func animateFlight(toward tab: DIPHomeTab, size: CGSize?) {
        flightGeneration += 1
        let generation = flightGeneration
        let target = idleAvatarFrame(for: tab, in: size ?? shellSize)
        withAnimation(DIPMotion.marker, completionCriteria: .logicallyComplete) {
            flightFrame = target
            flightRing = tab == .profile ? 3 : 0
        } completion: {
            guard generation == flightGeneration else { return }
            // Land exactly on the real endpoint (the badge may have reported after the target was chosen).
            flightFrame = idleAvatarFrame(for: tab, in: size ?? shellSize)
            isAvatarFlying = false
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
            title: headerTab.rawValue, unreadCount: bellCount(snapshot),
            profileAvatar: {
                // Hidden instantly while the flyer carries the avatar (no cross-fade ghost).
                DIPMedia(snapshot.home.profileAvatar).opacity(isAvatarFlying ? 0 : 1)
                    .transaction(value: isAvatarFlying) { $0.animation = nil }
            },
            onNotifications: openNotifications, onProfile: { selectTab(.profile) }
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

    /// The route kind for bug reports: a kind only, never an event, album or person id.
    private var reportScreen: BugReportScreen {
        switch routes.last {
        case .event?: return .event
        case .participants?: return .participants
        case .album?: return .album
        case .challenge?: return .challenge
        case nil:
            switch selectedTab {
            case .home: return .home
            case .rewards: return .rewards
            case .events: return .myEvents
            case .profile: return .profile
            }
        }
    }

    /// The Invitations sheet (kept out of `body`, whose modifier chain is already close to the type-checker's limit).
    @ViewBuilder private var invitationsSheet: some View {
        if let invites {
            DIPInvitationsScreen(
                model: invites,
                // Going / Cancelled follows the member's CURRENT RSVP (only events the app has loaded are known).
                rsvp: { id in model.snapshot?.eventDetails[id]?.isJoined },
                onRejoin: { await rejoinFromInvitation($0) },
                onOpenEvent: { id in showInvitations = false; routes = [.event(id)] },
                onRetry: { invitesObservationID = UUID() },
                onClose: { showInvitations = false })
        }
    }

    /// The bell opens the invitations (the notifications area) when there is an adapter; its badge counts invitations waiting for an answer.
    private func openNotifications() {
        if invites != nil { showInvitations = true } else { notice = "Notifications" }
    }

    private func bellCount(_ snapshot: DIPAppSnapshot) -> Int {
        invites.map(\.badgeCount) ?? snapshot.home.unreadCount
    }

    /// Rejoin from the Invitations screen: the same checks and the same RSVP command as the Join button, so capacity and
    /// eligibility rules apply. Returns nil on success, otherwise the neutral reason (full / started / cancelled ...).
    private func rejoinFromInvitation(_ eventID: String) async -> DIPInviteFailure? {
        #if DEBUG
        switch ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix("--rejoin-state=") }).map({ String($0.dropFirst("--rejoin-state=".count)) }) {
        case "full": return .full
        case "closed": return .closed
        default: break
        }
        #endif
        guard !participationUnavailable else { return .unknown }
        if let event = model.snapshot?.eventDetails[eventID], let metadata = event.metadata,
           let denial = DIPParticipationRules.denial(going: true, metadata: metadata, attendeeCount: event.attendeeCount, isGoing: event.isJoined, now: Date()) {
            switch denial {
            case .alreadyGoing: return nil
            case .full: return .full
            case .started, .ended: return .closed
            case .cancelled: return .cancelled
            case .notGoing: return .unknown
            }
        }
        do { try await model.setRSVP(eventID: eventID, going: true); onJoined?(); return nil }
        catch {
            switch error as? DIPRepositoryError {
            case .invalidInput(let message)?, .injectedFailure(let message)?:
                return Self.rejoinFailure(message: message)
            case .notFound?: return .notFound
            case nil: return .offline
            }
        }
    }

    /// Maps the RSVP command's user-facing refusal text to the neutral invite failures (full / closed).
    nonisolated private static func rejoinFailure(message: String) -> DIPInviteFailure {
        let text = message.lowercased()
        if text.contains("full") { return .full }
        let closing = ["ended", "started", "close"]
        if closing.contains(where: { text.contains($0) }) { return .closed }
        return .unknown
    }

    private func openInvite(_ eventID: String) {
        guard let invites, inviteSession == nil else { return }
        let title = model.snapshot?.eventDetails[eventID]?.title ?? "This activity"
        inviteSession = InviteSession(id: eventID, title: title, model: invites.makePicker(eventID: eventID))
    }

    private var isRSVPPending: Bool {
        switch routes.last {
        case .event(let id), .participants(let id): return model.pendingCommands.contains("rsvp:\(id)")
        case .challenge(let id): return model.pendingCommands.contains("challenge:\(id)")
        default: return false
        }
    }

    private var bottomAction: DIPBottomBarAction? {
        if case .challenge? = routes.last { return challengeBar.action }
        if case .album(let id)? = routes.last, uploads.pendingCount(for: id) > 0 {
            return DIPBottomBarAction(title: "Adding photos…", identifier: "album.add-photos", showsProgress: true)
        }
        return EventBarAction.resolve(route: routes.last, snapshot: model.snapshot, isLoading: model.isLoading)
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
        case .challenge: challengeBar.perform?()
        case nil: break
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
            do { try await model.setRSVP(eventID: eventID, going: going); if going { onJoined?() } }
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
                        onLeave: { changeRSVP(id, going: false) },
                        onInvite: invites == nil || participationUnavailable ? nil : { openInvite(id) })
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
                        isPickerPresented: $albumPickerPresented, uploads: uploads, onBack: pop,
                        onAddPhotos: { try await model.addPhotos(eventID: id, photos: $0) },
                        onAddComment: { try await model.addPhotoComment(
                            eventID: id, photoID: $0, commentID: $1, text: $2) },
                        onViewPhoto: { onPhotoViewed?(id, $0) })
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
