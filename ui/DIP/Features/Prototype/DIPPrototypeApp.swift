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
    private let readsOriginalPhotos: Bool
    /// `--comment-count=N` (review builds): how many comments the comment fixtures put on each photo.
    private static var commentCount: Int {
        MockLaunch.Flags.value(of: "--comment-count=")
            .flatMap { Int($0) } ?? 5
    }
    @State private var invites: DIPInvitesModel?
    @State private var showInvitations = false
    @State private var invitesObservationID = UUID()
    @State private var inviteSession: InviteSession?
    /// The notifications center (the bell): nil when there is no notifications adapter (the bell then opens Invitations).
    @State private var notifications: DIPNotificationsModel?
    @State private var showNotifications = false
    @State private var notificationsObservationID = UUID()
    @State private var pushAuthorization: DIPPushAuthorization?
    /// Profile > Notifications: nil unless the push client is enabled and there is a preferences adapter (the row is then hidden).
    @State private var notificationSettings: DIPNotificationSettingsModel?
    @State private var showNotificationSettings = false
    private let pushPermission: PushPermissionControl?
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
         invitesRepository: (any DIPInvitesRepository)? = nil,
         notificationsRepository: (any DIPNotificationsRepository)? = nil,
         notificationPreferencesRepository: (any DIPNotificationPreferencesRepository)? = nil,
         pushPermission: PushPermissionControl? = nil) {
        #if DEBUG
        // The fixture needs `--notifications-push=` (also in `--mock-member` mode, where a repository is passed).
        let resolvedPermission = pushPermission ?? PushPermissionControl.fixture()
        #else
        let resolvedPermission = pushPermission
        #endif
        self.pushPermission = resolvedPermission
        // Settings need a preferences adapter. Push controls need the push client (flag) and the permission seam; without
        // them the screen still opens with the Email section, because email preferences do not depend on push.
        if let source = notificationPreferencesRepository ?? (repository == nil ? Self.fixtureNotificationPreferences() : nil) {
            let permission = PushFeature.isEnabled ? resolvedPermission.map { PushPermissionProvider(control: $0) } : nil
            _notificationSettings = State(initialValue: DIPNotificationSettingsModel(repository: source, permission: permission))
        }
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
        // Only a Storage-backed repository can return the stored original; fixtures save the photo as shown.
        self.readsOriginalPhotos = repository != nil
        let argument = MockLaunch.Flags.value(of: "--screen=")
        let screen = initialScreen ?? argument ?? "home"
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
                ?? (MockLaunch.Flags.contains("--event-full") || MockLaunch.Flags.contains("--event-cancelled")
                ? Self.fullEventReview()
                : MockLaunch.Flags.contains("--many-tags")
                ? DIPMockFixtures.manyTagsReview()
                : MockLaunch.Flags.contains("--v1-event-fixtures")
                ? DIPMockFixtures.v1Events()
                : MockLaunch.Flags.contains("--empty-social-fixtures")
                ? DIPMockFixtures.emptySocialReview
                : MockLaunch.Flags.contains("--chat-grouping-fixtures")
                ? DIPMockFixtures.chatGroupingReview
                : MockLaunch.Flags.contains("--chat-history-fixtures")
                ? DIPMockFixtures.chatHistoryReview
                : MockLaunch.Flags.contains("--comment-bubble-fixtures")
                ? DIPMockFixtures.photoCommentReview(count: Self.commentCount)
                : ["event", "event-joined", "past-event", "invite-picker"].contains(screen)
                ? Self.eventReview(unjoined: screen == "event") : DIPMockFixtures.reference),
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
        // Same rule as invitations: the shell's own mock mode gets the fixture notifications, real members get the adapter.
        let notificationSource = notificationsRepository ?? (repository == nil ? Self.fixtureNotifications() : nil)
        _notifications = State(initialValue: notificationSource.map { DIPNotificationsModel(repository: $0) })
        _showNotifications = State(initialValue: notificationSource != nil && screen == "notifications")
        #if DEBUG
        _showNotificationSettings = State(initialValue: screen == "notification-settings" && (notificationPreferencesRepository != nil || repository == nil))
        #endif
    }

    /// Fixture preferences; `--notification-settings=load-failed|save-failed` (Debug) for review and UI tests.
    static func fixtureNotificationPreferences() -> any DIPNotificationPreferencesRepository {
        #if DEBUG
        let state = ProcessInfo.processInfo.arguments.first { $0.hasPrefix("--notification-settings=") }.map { String($0.dropFirst("--notification-settings=".count)) }
        switch state {
        case "load-failed": return DIPMockNotificationPreferencesRepository(behavior: .init(loadFailure: true))
        case "save-failed": return DIPMockNotificationPreferencesRepository(behavior: .init(failingSaves: 1))
        default: break
        }
        #endif
        return DIPMockNotificationPreferencesRepository()
    }

    /// Fixture notifications; `--notifications-state=empty|loading|failed|many|mark-failed|more-failed` (Debug) for review and UI tests.
    static func fixtureNotifications() -> any DIPNotificationsRepository {
        #if DEBUG
        let state = ProcessInfo.processInfo.arguments.first { $0.hasPrefix("--notifications-state=") }.map { String($0.dropFirst("--notifications-state=".count)) }
        switch state {
        case "empty": return DIPMockNotificationsRepository.empty()
        case "loading": return DIPMockNotificationsRepository.reference(behavior: .init(latency: .seconds(3600)))
        case "failed": return DIPMockNotificationsRepository.reference(behavior: .init(observeFailure: true))
        case "many": return DIPMockNotificationsRepository.reference(count: 70)
        case "mark-failed": return DIPMockNotificationsRepository.reference(behavior: .init(markFailure: .offline))
        case "more-failed": return DIPMockNotificationsRepository.reference(count: 70, behavior: .init(loadOlderFailure: .offline))
        default: break
        }
        #endif
        return DIPMockNotificationsRepository.reference()
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
        guard MockLaunch.Flags.contains("--album-upload-review") else { return nil }
        let queue = AlbumUploadQueue(send: { _, photo, progress in
            if photo.data.first == 1 { progress(0.4); try await Task.sleep(for: .seconds(3600)) }
            if photo.data.first == 2 { throw DIPRepositoryError.rejected(DIPMemberMessage(localized: AlbumFailure.unavailable.message)) }
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

    /// `--event-full` / `--event-cancelled` (Debug review): Puppy Yoga at capacity, or cancelled, to review the pill pair
    /// (Directions replaces Invite Coworker when inviting is not possible).
    private static func fullEventReview() -> DIPAppSnapshot {
        var snapshot = DIPMockFixtures.v1Events()
        if MockLaunch.Flags.contains("--event-cancelled") {
            snapshot.eventDetails["puppy-yoga"]?.metadata?.status = .cancelled
        } else if let capacity = snapshot.eventDetails["puppy-yoga"]?.metadata?.capacity {
            snapshot.eventDetails["puppy-yoga"]?.attendeeCount = capacity
        }
        return snapshot
    }

    /// `--empty-state=<fixture>` (see `DIPEmptyStateFixture`) for designed empty-state review only.
    /// V1 events; `--screen=event` is the not-yet-joined review of Puppy Yoga (the fixture seeds it as joined).
    static func eventReview(unjoined: Bool) -> DIPAppSnapshot {
        var snapshot = DIPMockFixtures.v1Events()
        if unjoined { snapshot.eventDetails["puppy-yoga"]?.isJoined = false }
        return snapshot
    }

    private static func emptyStateFixture() -> DIPEmptyStateFixture? {
        MockLaunch.Flags.value(of: "--empty-state=")
            .flatMap { DIPEmptyStateFixture(rawValue: $0) }
    }

    /// Deterministic failure paths for local preview/UI testing only.
    private static func previewFailures() -> [DIPMockOperation: String] {
        var failures: [DIPMockOperation: String] = [:]
        if MockLaunch.Flags.contains("--fail-profile-once") { failures[.profile] = "Preview failure" }
        if MockLaunch.Flags.contains("--fail-chat-once") { failures[.message] = "Preview failure" }
        if MockLaunch.Flags.contains("--fail-comment-once") { failures[.comment] = "Preview failure" }
        return failures
    }

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    /// True only on the iPhone Duo's open inner display (see DuoLayout.swift): the shell is then a rail plus panes.
    @Environment(\.dipDuoOpen) private var duoOpen
    /// The sensor column the rail lives in (side from the safe area, so it follows rotation); nil outside the open Duo.
    @Environment(\.dipDuoSensor) private var duoSensor
    @Environment(\.dipDuoRailSlot) private var railSlot
    /// The route the shell itself put in the detail pane (the first event listed), not one the member or a link chose.
    /// Folding the Duo clears it, and only it, so a deliberate selection or deep link survives.
    @State private var duoAutoRoute: Route?
    /// Live weekly theme (configured member Home). Nil: the snapshot's fixture challenge is shown.
    @Environment(\.weeklyChallengeFeed) private var challengeFeed
    /// The theme page publishes its entry action here; the shared bottom bar below renders it.
    @State private var challengeBar = ChallengeEntryBar()
    @State private var albumPickerPresented = false
    /// The tab whose name the fixed header shows (the last non-Profile tab while Profile is selected).
    @State private var headerTab: DIPHomeTab = .home
    /// Home's interest filter scope; persisted per member on this device.
    @State private var homeScope: DIPHomeEventScope = .all
    @Environment(\.dipCalendar) private var calendar
    /// Upcoming Home events that overlap the member's calendar; filled after the feed renders.
    @State private var calendarOverlaps: DIPCalendarOverlaps = .none
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
                if duoOpen {
                    duoShell
                } else {
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
                avatarFlyer
            }
            .environment(\.challengeEntryBar, challengeBar)
            .background(.white)
            .onGeometryChange(for: CGPoint.self) { $0.frame(in: .global).origin } action: { shellOrigin = $0 }
            .onAppear { if flightFrame == .zero { flightFrame = idleAvatarFrame(for: selectedTab, in: geometry.size) } }
            .onChange(of: selectedTab) { old, new in if !duoOpen { flyAvatar(from: old, to: new, in: geometry.size) } }
            .onChange(of: duoSyncKey, initial: true) { _, _ in syncDuoSelection() }
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
            Text(String(localized: "shell.notice.notConnected", defaultValue: "\(notice ?? "") is not connected yet.", comment: "Not available yet alert message; %@ = a feature name such as RSVP or Attendee lists (shell.notice.*). Translations should read correctly for singular and plural feature names"))
        }
        .sheet(isPresented: $showChat) {
            DIPActivityChatScreen(
                eventTitle: model.snapshot?.eventDetails[chatEventID]?.title ?? String(localized: "event.bar.chat", defaultValue: "Activity Chat", comment: "Bottom action bar button on an activity screen: opens the activity chat"),
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
            .dipDuoSheetSizing(duoOpen)
        }
        .sheet(isPresented: $showNotifications) { notificationsSheet.dipDuoSheetSizing(duoOpen) }
        .sheet(isPresented: $showInvitations) { invitationsSheet.dipDuoSheetSizing(duoOpen) }
        .sheet(isPresented: $showNotificationSettings) { notificationSettingsSheet.dipDuoSheetSizing(duoOpen) }
        .sheet(item: $inviteSession) { session in
            DIPInviteSheet(model: session.model, eventTitle: session.title, onClose: { inviteSession = nil })
                .dipDuoSheetSizing(duoOpen)
        }
        .task(id: invitesObservationID) { await invites?.observe() }
        // Live for as long as the member's shell exists (it is keyed by member): the bell badge counts unread, and the
        // listeners go away with the view on sign-out.
        .task(id: notificationsObservationID) { await notifications?.observe() }
        .task(id: showNotifications) { if showNotifications { await refreshPushAuthorization() } }
        // Coming back from iOS Settings: re-read the permission so the banner disappears once it is on.
        .onChange(of: scenePhase) { _, phase in if phase == .active, showNotifications { Task { await refreshPushAuthorization() } } }
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
        .task(id: calendarConflictKey) { await refreshCalendarConflicts() }
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
                Text(model.loadError ?? String(localized: "shell.loadFailed.fallback", defaultValue: "Please try again.", comment: "Fallback message under the Couldn’t load your activities error when no reason is known"))
            } actions: {
                Button("Retry") { observationID = UUID() }.accessibilityIdentifier("data.retry")
            }
        }
    }

    private func tabPages(_ snapshot: DIPAppSnapshot) -> some View {
        let pages = tabBuilder(snapshot)
        // Home, Rewards and My Events share one header drawn by the shell (fixed while pages slide);
        // Profile has its own header card that scrolls with its page.
        return DIPSlidingPages(selection: selectedTab, reduceMotion: reduceMotion) { tab in
            AnyView(pages(tab).environment(\.dipHeaderHosted, tab != .profile)
                .environment(\.profileBadgeLink, ProfileBadgeLink(isHidden: isAvatarFlying, report: reportBadgeFrame)))
        }
    }

    /// The four tab pages, built once per snapshot. The phone slides them; the open Duo shows one beside its detail pane.
    private func tabBuilder(_ snapshot: DIPAppSnapshot) -> (DIPHomeTab) -> AnyView {
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
                    onEvent: { openRoute(.event($0)) },
                    onChallenge: { openRoute(.challenge($0)) }, onSelect: homeSelection,
                    onLoadMore: onLoadMoreEvents ?? Self.previewLoadMore, loadingMore: loadingMoreEvents || Self.previewLoadingMore,
                    paginationError: eventPaginationError,
                    eventSectionTitle: eventReadsOnly ? String(localized: "home.events.title.upcoming", defaultValue: "Upcoming events", comment: "Home section heading above the event cards when events are read only") : String(localized: "home.events.title", defaultValue: "This Week’s Events", comment: "Home section heading above the upcoming event cards"),
                    onRefresh: homeRefresh, challengeState: challengeFeed?.state,
                    onRetryChallenge: challengeFeed.map { feed in { Task { await feed.load() } } },
                    eventFilter: eventFilter, onFilterScope: { setHomeScope($0, uid: member.id, shown: matchingCount, total: eventFilter?.totalCount) },
                    eventsPhase: eventsPhase(snapshot, hasEvents: !lists.discovery.isEmpty),
                    onRetryEvents: { observationID = UUID() },
                    calendarOverlaps: calendarOverlaps))
            case .events:
                if participationUnavailable {
                    AnyView(ContentUnavailableView("My Events isn’t available yet", systemImage: "calendar",
                        description: Text("You can browse company events from Home.")))
                } else { AnyView(DIPMyEventsScreen(
                    activeEvents: lists.upcoming, memories: lists.past,
                    unreadCount: bellCount(snapshot), profileAvatar: snapshot.home.profileAvatar,
                    initialMemories: initialMemories, showsBottomBar: false,
                    onSelectTab: selectTab,
                    onEvent: { openRoute(.event($0)) }, onAlbum: { openRoute(.event($0)) },
                    onNotifications: openNotifications, onProfile: { selectTab(.profile) })) }
            case .profile:
                AnyView(DIPProfileScreen(
                    profile: accountProfile ?? snapshot.profile, showsBottomBar: false, onSelectTab: selectTab,
                    onMemory: { event, photo in memoryPhotoIDs[event] = photo; pushRoute(.album(event)) },
                    onSave: { edit in
                        if let onProfileSave { try await onProfileSave(edit) }
                        else { try await model.updateProfile(edit) }
                    }, onSignOut: onSignOut, interestCatalogLoading: interestCatalogLoading,
                    interestCatalogError: interestCatalogError, onRetryInterestCatalog: onRetryInterestCatalog,
                    onReplayTour: onReplayTour,
                    onOpenNotificationSettings: notificationSettings == nil ? nil : { showNotificationSettings = true }))
            case .rewards:
                AnyView(DIPRewardsScreen(
                    unreadCount: bellCount(snapshot), profileAvatar: snapshot.home.profileAvatar,
                    showsBottomBar: false, onSelectTab: selectTab,
                    onNotifications: openNotifications, onProfile: { selectTab(.profile) },
                    pointsDisplay: pointsDisplay(accountProfile == nil ? nil : (accountProfile ?? snapshot.profile).pointsBalance)))
            }
        }
        return pages
    }

    /// Re-run key for the conflict pass: calendar changes plus a cheap signature of the loaded events.
    private var calendarConflictKey: [String] {
        let events = model.snapshot?.eventDetails.values.sorted { $0.id < $1.id } ?? []
        let signature = events.map { "\($0.id):\($0.isPast):\($0.metadata?.revision ?? 0)" }.joined(separator: ",")
        return [String(calendar.revision), signature]
    }

    /// Runs after the feed has rendered, so first paint is unchanged.
    private func refreshCalendarConflicts() async {
        guard let snapshot = model.snapshot else { calendarOverlaps = .none; return }
        let all = Array(snapshot.eventDetails.values)
        let candidates = DIPEventLists(snapshot: snapshot, now: Date()).discovery.compactMap { summary -> DIPEventDetail? in
            guard let detail = snapshot.eventDetails[summary.id], detail.metadata != nil, !detail.isPast else { return nil }
            return detail
        }
        let result = await calendar.homeOverlaps(candidates, among: all)
        if result != calendarOverlaps { calendarOverlaps = result }
    }

    /// Freshness of Home's events. The snapshot only exists after a successful read, so a load error with a
    /// snapshot means the list on screen is the last good one (offline); without events it is a failure.
    private func eventsPhase(_ snapshot: DIPAppSnapshot, hasEvents: Bool) -> DIPHomeEventsPhase {
        if let forced = Self.previewEventsPhase { return forced }
        if model.loadError != nil {
            return hasEvents ? .offline : .failed(String(localized: "home.events.error.message", defaultValue: "Check your connection and try again.", comment: "Home error state message when the events could not be loaded and nothing is cached"))
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

    /// `--home-load-more` / `--home-load-more=loading` show the pagination button for design review (DEBUG only).
    private static var previewLoadMore: (() -> Void)? {
        #if DEBUG
        return ProcessInfo.processInfo.arguments.contains(where: { $0.hasPrefix("--home-load-more") }) ? {} : nil
        #else
        return nil
        #endif
    }
    private static var previewLoadingMore: Bool {
        #if DEBUG
        return ProcessInfo.processInfo.arguments.contains("--home-load-more=loading")
        #else
        return false
        #endif
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
            title: headerTab.title, unreadCount: bellCount(snapshot),
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
                rsvp: { id in model.snapshot?.rsvpKnown == true ? model.snapshot?.eventDetails[id]?.isJoined : nil },
                onRejoin: { await rejoinFromInvitation($0) },
                onOpenEvent: { id in showInvitations = false; routes = [.event(id)] },
                onRetry: { invitesObservationID = UUID() },
                onClose: { showInvitations = false })
        }
    }

    /// The notifications center; invitations are one tap away from it.
    @ViewBuilder private var notificationsSheet: some View {
        if let notifications {
            DIPNotificationsScreen(
                model: notifications,
                invitesWaiting: invites?.badgeCount,
                permissionPrompt: permissionPrompt,
                onOpen: { openNotification($0) },
                onOpenInvitations: { showNotifications = false; presentInvitationsAfterSheet() },
                onPermission: { Task { await turnOnPush() } },
                onOpenSettings: notificationSettings == nil ? nil : { showNotifications = false; presentNotificationSettingsAfterSheet() },
                onRetry: { notificationsObservationID = UUID() },
                onClose: { showNotifications = false })
        }
    }

    /// Profile > Notifications (kept out of `body` like the other sheets).
    @ViewBuilder private var notificationSettingsSheet: some View {
        if let notificationSettings {
            DIPNotificationSettingsScreen(model: notificationSettings, onClose: { showNotificationSettings = false })
        }
    }

    /// One sheet at a time: the notifications sheet finishes dismissing before the settings present.
    private func presentNotificationSettingsAfterSheet() {
        guard notificationSettings != nil else { return }
        Task { try? await Task.sleep(for: .milliseconds(450)); showNotificationSettings = true }
    }

    /// The bell opens the notifications center when there is an adapter (otherwise the invitations, otherwise a notice).
    private func openNotifications() {
        if notifications != nil { showNotifications = true }
        else if invites != nil { showInvitations = true }
        else { notice = String(localized: "shell.notice.notifications", defaultValue: "Notifications", comment: "Feature name shown in the Not available yet alert: %@ is not connected yet") }
    }

    /// The bell's badge: unread notifications (live); without a notifications adapter, invitations waiting for an answer.
    private func bellCount(_ snapshot: DIPAppSnapshot) -> Int {
        notifications?.unreadCount ?? invites.map(\.badgeCount) ?? snapshot.home.unreadCount
    }

    /// Marks the row read and goes where it points (the same routes as the deep-link inbox uses).
    private func openNotification(_ item: DIPNotification) {
        Task { await notifications?.markRead(item.id) }
        switch item.destination {
        case .event(let id): showNotifications = false; routes = [.event(id)]
        case .challenge(let id): showNotifications = false; routes = [.challenge(id)]
        case .album(let id): showNotifications = false; routes = [.album(id)]
        case .invitations:
            showNotifications = false
            if invites != nil { presentInvitationsAfterSheet() }
        case .none: break
        }
    }

    /// One sheet at a time: the notifications sheet finishes dismissing before Invitations presents.
    private func presentInvitationsAfterSheet() {
        guard invites != nil else { return }
        Task { try? await Task.sleep(for: .milliseconds(450)); showInvitations = true }
    }

    // MARK: Push permission banner (only when the push client is enabled by flag)

    private var permissionPrompt: NotificationPermissionPrompt? {
        guard pushPermission != nil, let pushAuthorization else { return nil }
        switch pushAuthorization {
        case .notDetermined: return .turnOn
        case .denied: return .openSettings
        case .authorized, .provisional, .ephemeral: return nil
        }
    }

    private func refreshPushAuthorization() async {
        guard let pushPermission else { return }
        pushAuthorization = await pushPermission.status()
    }

    private func turnOnPush() async {
        guard let pushPermission else { return }
        if pushAuthorization == .denied { pushPermission.openSettings(); return }
        pushAuthorization = await pushPermission.turnOn()
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
            // Classify by state, not by wording: the same rules the Join button checks, against the freshest snapshot.
            if let event = model.snapshot?.eventDetails[eventID], let metadata = event.metadata,
               let denial = DIPParticipationRules.joinDenial(metadata, attendeeCount: event.attendeeCount, isGoing: event.isJoined, now: Date()) {
                switch denial {
                case .alreadyGoing: return nil
                case .full: return .full
                case .started, .ended: return .closed
                case .cancelled: return .cancelled
                case .notGoing: return .unknown
                }
            }
            if error is CancellationError { return .unknown }
            if case .notFound? = error as? DIPRepositoryError { return .notFound }
            return (error as NSError).domain == NSURLErrorDomain ? .offline : .unknown
        }
    }

    private func openInvite(_ eventID: String) {
        guard let invites, inviteSession == nil else { return }
        let title = model.snapshot?.eventDetails[eventID]?.title ?? String(localized: "shell.invite.fallbackTitle", defaultValue: "This activity", comment: "Title used in the invite sheet when the activity name is not known")
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
            return DIPBottomBarAction(title: String(localized: "album.bar.adding", defaultValue: "Adding photos…", comment: "Bottom action bar label on the album while photos are uploading"), identifier: "album.add-photos", showsProgress: true)
        }
        return EventBarAction.resolve(route: routes.last, snapshot: model.snapshot, isLoading: model.isLoading)
    }

    private func performBottomAction() {
        switch routes.last {
        case .event(let id):
            if model.snapshot?.eventDetails[id]?.isPast == true { pushRoute(.album(id)) }
            else if model.snapshot?.eventDetails[id]?.isJoined == true { openChat(id) }
            else { join(id) }
        case .participants(let id):
            if model.snapshot?.eventDetails[id]?.isPast == true { pushRoute(.album(id)) }
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
        // Both reads are independent: run them together. The events closure is created and run on the main actor.
        nonisolated(unsafe) let refreshEvents = onRefreshEvents
        return { [challengeFeed] in
            // Unstructured main-actor tasks (not `async let`): Xcode 26's checker rejects sending the closure.
            let challenge = Task { @MainActor in await challengeFeed?.load() }
            let events = Task { @MainActor in await refreshEvents?() }
            await challenge.value
            await events.value
        }
    }

    private func join(_ eventID: String) {
        guard !participationUnavailable else { notice = String(localized: "shell.notice.rsvp", defaultValue: "RSVP", comment: "Feature name shown in the Not available yet alert: %@ is not connected yet"); return }
        changeRSVP(eventID, going: true)
    }

    /// Readable RSVP failure text (the live adapter sends localized `rejected` member messages).
    nonisolated static func rsvpMessage(_ error: Error) -> String {
        switch error as? DIPRepositoryError {
        case .rejected(let message)?: message.text
        case .injectedFailure(let message)?: message
        case .notFound?: String(localized: "event.rsvp.error.notFound", defaultValue: "This event no longer exists.", comment: "Error when joining or leaving an event that was removed")
        case nil: String(localized: "event.rsvp.error.generic", defaultValue: "Couldn’t change your RSVP. Please try again.", comment: "Error when joining or leaving an event failed")
        }
    }

    private func changeRSVP(_ eventID: String, going: Bool) {
        guard beginRSVP(eventID, going: going) else { return }
        Task { _ = await commitRSVP(eventID, going: going) }
    }

    /// Leave from the event page's confirmation: true only when the server confirmed (the page removes the
    /// calendar entry after that, never on a refused or rolled-back leave).
    private func confirmLeave(_ eventID: String) async -> Bool {
        guard beginRSVP(eventID, going: false) else { return false }
        return await commitRSVP(eventID, going: false)
    }

    /// Synchronous gate before the optimistic flip; false means nothing was started.
    private func beginRSVP(_ eventID: String, going: Bool) -> Bool {
        guard !participationUnavailable else { notice = String(localized: "shell.notice.rsvp", defaultValue: "RSVP", comment: "Feature name shown in the Not available yet alert: %@ is not connected yet"); return false }
        guard !model.pendingCommands.contains("rsvp:\(eventID)") else { return false }
        // Local reasonableness check before the optimistic flip: a refused change gets the failure haptic and
        // a clear message, and the state never changes.
        if let event = model.snapshot?.eventDetails[eventID], let metadata = event.metadata,
           let denial = DIPParticipationRules.denial(going: going, metadata: metadata, attendeeCount: event.attendeeCount,
                                                     isGoing: event.isJoined, now: Date()) {
            DIPHaptics.failure(); rsvpError = denial.message; return false
        }
        // The repository flips the state immediately, so the success haptic plays now; a server failure rolls back.
        // Join comes from the persistent bar, whose commit haptic already marked the tap: one haptic per action.
        if !going { DIPHaptics.success() }
        return true
    }

    /// Runs the RSVP; the one spoken confirmation (or the failure) comes from here, never from the page.
    private func commitRSVP(_ eventID: String, going: Bool) async -> Bool {
        do {
            try await model.setRSVP(eventID: eventID, going: going); if going { onJoined?() }
            UIAccessibility.post(notification: .announcement, argument: Self.rsvpAnnouncement(title: model.snapshot?.eventDetails[eventID]?.title, going: going))
            return true
        } catch {
            DIPHaptics.failure(); rsvpError = Self.rsvpMessage(error)
            UIAccessibility.post(notification: .announcement, argument: Self.rsvpMessage(error))
            return false
        }
    }

    /// Spoken confirmation of a Join or Leave (the bar and Leave button change silently for VoiceOver users).
    nonisolated static func rsvpAnnouncement(title: String?, going: Bool) -> String {
        guard let title else {
            return going ? String(localized: "event.rsvp.announce.joined", defaultValue: "You joined", comment: "VoiceOver announcement after joining an activity") : String(localized: "event.rsvp.announce.left", defaultValue: "You left", comment: "VoiceOver announcement after leaving an activity")
        }
        return going ? String(localized: "event.rsvp.announce.joinedTitled", defaultValue: "You joined \(title)", comment: "VoiceOver announcement after joining an activity; %@ = activity title") : String(localized: "event.rsvp.announce.leftTitled", defaultValue: "You left \(title)", comment: "VoiceOver announcement after leaving an activity; %@ = activity title")
    }

    @ViewBuilder private func destination(_ route: Route) -> some View {
        if let snapshot = model.snapshot {
            switch route {
            case .event(let id):
                if let event = snapshot.eventDetails[id] {
                    DIPEventDetailsScreen(
                        event: event, joined: event.isJoined, showsBottomBar: false,
                        onJoin: { join(id) }, onBack: pop,
                        onAttendees: { if participationUnavailable { notice = String(localized: "shell.notice.attendeeLists", defaultValue: "Attendee lists", comment: "Feature name shown in the Not available yet alert: %@ is not connected yet") } else { pushRoute(.participants(id)) } }, onChat: { openChat(id) },
                        photos: snapshot.albums[id]?.photos ?? [], onAlbum: { pushRoute(.album(id)) },
                        albumLoading: snapshot.albums[id].map { !$0.isLoaded && $0.loadError == nil } ?? false,
                        onLeave: { changeRSVP(id, going: false) },
                        onConfirmedLeave: { await confirmLeave(id) },
                        participationPending: isRSVPPending,
                        onInvite: invites == nil || participationUnavailable ? nil : { openInvite(id) },
                        calendarEvents: Array(snapshot.eventDetails.values))
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
                        onViewPhoto: { onPhotoViewed?(id, $0) },
                        loadOriginal: readsOriginalPhotos ? { try await model.originalPhotoData(eventID: id, photoID: $0) } : nil)
                } else { missingResource }
            }
        } else { ProgressView("Loading…") }
    }

    private var missingResource: some View {
        ContentUnavailableView {
            Label("Activity unavailable", systemImage: "calendar.badge.exclamationmark")
        } description: {
            Text(EventBarAction.unavailableReason(updatesPaused: model.loadError != nil))
        } actions: { Button("Back", action: pop) }
    }

    // MARK: Open Duo (inner display): rail, list pane and detail pane

    /// What the selection sync reacts to; one `onChange` keeps the body's modifier chain short.
    private struct DuoSyncKey: Equatable {
        var open: Bool; var tab: DIPHomeTab; var routesEmpty: Bool; var firstEvent: String?; var rootMissing: Bool
    }
    private var duoSyncKey: DuoSyncKey {
        DuoSyncKey(open: duoOpen, tab: selectedTab, routesEmpty: routes.isEmpty, firstEvent: duoDefaultEventID(),
                   rootMissing: duoRootEventMissing)
    }

    /// True when the detail pane's root is an event that is no longer in the snapshot (removed or filtered away).
    private var duoRootEventMissing: Bool {
        guard duoOpen, isMasterDetailTab, let snapshot = model.snapshot, routes.count == 1,
              case .event(let id)? = routes.first else { return false }
        return snapshot.eventDetails[id] == nil
    }

    private var isMasterDetailTab: Bool { selectedTab == .home || selectedTab == .events }

    /// Opens a page from a list. On the open Duo's Home and My Events it replaces the detail pane; elsewhere it pushes.
    private func openRoute(_ route: Route) {
        if duoOpen && isMasterDetailTab { routes = [route]; duoAutoRoute = nil } else { pushRoute(route) }
    }

    /// Pushes a page unless it is already on top (a rapid double tap must not stack it twice).
    private func pushRoute(_ route: Route) { routes = DIPDuoPaneLayout.appending(route, to: routes) }

    /// The detail pane is never blank while events exist: Home and My Events open their first event. Folding the Duo
    /// drops a selection the shell made itself, so the phone layout starts on its list.
    private func syncDuoSelection() {
        guard duoOpen else {
            if let auto = duoAutoRoute, routes == [auto] { routes = [] }
            duoAutoRoute = nil
            return
        }
        if duoRootEventMissing { routes = []; duoAutoRoute = nil }
        guard routes.isEmpty, let id = duoDefaultEventID() else { return }
        routes = [.event(id)]
        duoAutoRoute = .event(id)
    }

    /// The event the detail pane opens when nothing is selected: the first one the current list shows. Nil off the
    /// list tabs, when the Duo is not open, or when there are no events yet.
    private func duoDefaultEventID() -> String? {
        guard duoOpen, isMasterDetailTab, let snapshot = model.snapshot else { return nil }
        let lists = DIPEventLists(snapshot: snapshot, now: Date())
        // Home lists calendar-friendly events first (`DIPHomeScreen.orderedEvents`); the default is that first card.
        if selectedTab == .home {
            return DIPDuoPaneLayout.defaultSelection(
                in: visibleHomeEvents(snapshot, lists: lists).map(\.id), conflicted: calendarOverlaps.dip, busy: calendarOverlaps.personal)
        }
        return DIPDuoPaneLayout.defaultSelection(in: lists.upcoming.map(\.id))
    }

    /// The events Home lists, after the member's interest scope (the same rule `tabBuilder` applies).
    private func visibleHomeEvents(_ snapshot: DIPAppSnapshot, lists: DIPEventLists) -> [DIPEventSummary] {
        let member = accountProfile ?? snapshot.profile
        let interests = accountProfile == nil ? [] : DIPInterestFilter.activeInterests(
            storedIDs: member.interestTagIDs, catalog: member.interestCatalog.isEmpty ? nil : member.interestCatalog)
        return DIPInterestFilter.visibleEvents(lists.discovery, scope: homeScope, activeInterests: interests).events
    }

    /// The detail pane's root page: the first route, else the default event, so a tab switch never flashes the placeholder
    /// while the selection sync catches up.
    private var duoEffectiveRoot: Route? {
        routes.first ?? duoDefaultEventID().map { Route.event($0) }
    }

    private var duoSelectedEventID: String? {
        if case .event(let id)? = duoEffectiveRoot { return id }
        return nil
    }

    /// What the rail shows; the rail is republished to the sensor column whenever this changes.
    private struct DuoRailState: Equatable { var selected: DIPHomeTab; var unread: Int; var disabled: Bool }

    private var duoShell: some View {
        let rail = DIPDuoRail(
            columnWidth: duoSensor?.width ?? DIPDuoPaneLayout.railWidth,
            topInset: duoSensor == nil ? DIPDuoPaneLayout.topInset : DIPDuoSensor.pillClearance,
            selected: selectedTab, unreadCount: model.snapshot.map(bellCount) ?? 0,
            onSelect: selectTab, onNotifications: openNotifications)
            .disabled(isRSVPPending)
        let state = DuoRailState(selected: selectedTab, unread: model.snapshot.map(bellCount) ?? 0, disabled: isRSVPPending)
        return HStack(spacing: 0) {
            // Without a sensor inset the rail stays at the leading edge of the shell; on a Duo it is drawn in the sensor
            // column, below the status pill, by the window (`DIPDuoRailSlot`), so the panes use the whole free width.
            if railSlot == nil { rail }
            if let snapshot = model.snapshot {
                duoPages(snapshot)
            } else {
                loadedPages
            }
        }
        .background(Color.white)
        .onChange(of: state, initial: true) { _, _ in railSlot?.rail = AnyView(rail) }
        .onDisappear { railSlot?.rail = nil }
    }

    private func duoPage(_ tab: DIPHomeTab, _ pages: (DIPHomeTab) -> AnyView) -> some View {
        pages(tab)
            .environment(\.dipHeaderHosted, false)
            .environment(\.profileBadgeLink, ProfileBadgeLink(isHidden: false, report: reportBadgeFrame))
    }

    @ViewBuilder private func duoPages(_ snapshot: DIPAppSnapshot) -> some View {
        let pages = tabBuilder(snapshot)
        if isMasterDetailTab {
            HStack(spacing: 0) {
                duoPage(selectedTab, pages)
                    .environment(\.dipDuoSelectedEvent, duoSelectedEventID)
                    .frame(width: DIPDuoPaneLayout.listWidth).frame(maxHeight: .infinity)
                Rectangle().fill(DIPTokens.Color.surfaceMuted.swiftUIColor)
                    .frame(width: DIPDuoPaneLayout.dividerWidth).frame(maxHeight: .infinity)
                duoDetail
            }
        } else {
            NavigationStack(path: $routes) {
                duoPage(selectedTab, pages)
                    .toolbar(.hidden, for: .navigationBar)
                    .navigationDestination(for: Route.self) { route in
                        destination(route).navigationBarBackButtonHidden().toolbar(.hidden, for: .navigationBar)
                    }
            }
            .ignoresSafeArea()
            .overlay(alignment: .bottom) { duoActionBar }
        }
    }

    /// The detail pane: the first route is its root page (no Back), later routes push inside it.
    private var duoDetail: some View {
        let pushed = Binding<[Route]>(
            get: { Array(routes.dropFirst()) },
            set: { routes = (routes.first.map { [$0] } ?? []) + $0 })
        return NavigationStack(path: pushed) {
            Group {
                if let root = duoEffectiveRoot {
                    destination(root).environment(\.dipDuoHidesBack, true)
                } else { DIPDuoDetailPlaceholder() }
            }
            .id(duoEffectiveRoot)
            .ignoresSafeArea()
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: Route.self) { route in
                destination(route).navigationBarBackButtonHidden().toolbar(.hidden, for: .navigationBar)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .ignoresSafeArea()
        .overlay(alignment: .bottom) { duoActionBar }
        // The detail pane changes content without a navigation transition; tell VoiceOver the layout changed.
        .onChange(of: duoEffectiveRoot) { _, _ in UIAccessibility.post(notification: .screenChanged, argument: nil) }
    }

    /// Join / Activity Chat / Add Photos action, contained in the pane it belongs to instead of spanning the window.
    @ViewBuilder private var duoActionBar: some View {
        if let action = bottomAction {
            DIPFloatingNavigation(
                selected: selectedTab, action: action, showsTabs: false,
                onSelect: { _ in }, onAction: performBottomAction)
                .frame(height: DIPFloatingNavigation.height)
                .disabled(isRSVPPending)
                .padding(.horizontal, 20)
                .padding(.bottom, DIPFloatingNavigation.barCenterInset - DIPFloatingNavigation.height / 2)
        }
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
        case "Recent attendees": if eventReadsOnly { notice = String(localized: "shell.notice.attendeeLists", defaultValue: "Attendee lists", comment: "Feature name shown in the Not available yet alert: %@ is not connected yet") } else { openRoute(.participants("puppy-yoga")) }
        default: notice = selection
        }
    }
}
