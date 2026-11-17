import DIPCore
import DIPDesignSystem
import SwiftUI

/// Figma Event Page 46:1397 and Joined 76:1742, with repository-owned participation and chat state.
struct DIPEventDetailsScreen: View {
    let event: DIPEventDetail
    let onBack: () -> Void
    let onAttendees: () -> Void
    let showsBottomBar: Bool
    let onChat: () -> Void
    let joined: Bool
    let onJoin: () -> Void
    let photos: [DIPPhoto]
    let onAlbum: () -> Void
    /// True until the first album read arrives (live), so the page shows tiles instead of "No photos yet".
    let albumLoading: Bool
    let onLeave: () -> Void
    /// Leaves and reports whether the leave went through. When set it replaces `onLeave`, so "Leave and remove from
    /// calendar" removes the entry only after the leave is confirmed (a failed leave keeps the member in the activity).
    let onConfirmedLeave: (() async -> Bool)?
    /// A join or leave is in flight: only the Join and Leave controls stop responding (Back and the rest stay live).
    let participationPending: Bool
    /// Opens the coworker picker; nil hides the action (no invitations adapter, or read-only live events).
    let onInvite: (() -> Void)?
    /// The member's other events, used for DIP-vs-DIP conflicts on the date pill.
    let calendarEvents: [DIPEventDetail]
    @State private var confirmingLeave = false
    @State private var showingChanges = false
    @State private var calendarResult: DIPCalendarAddResult?
    @Environment(\.eventCalendarAdder) private var calendarAdder
    @Environment(\.dipDuoOpen) private var duoOpen
    @Environment(\.openURL) private var openURL
    /// True while the calendar editor is being presented, so a second tap (row or pill) cannot open another one.
    @State private var addingToCalendar = false
    @Environment(\.dipCalendar) private var calendar
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var conflicts: [DIPCalendarConflict] = []
    @State private var showsConflictAlert = false
    @State private var showsAccessAlert = false
    @State private var toast: CalendarToast?
    @State private var toastTask: Task<Void, Never>?
    /// The `.task` id the current `conflicts` were computed for; a tap before the first result waits for a fresh read.
    @State private var conflictsKey: String?
    /// DIP's calendar entry for this event exists and can be removed (checked against the calendar).
    @State private var entryRemovable = false

    /// A short confirmation below the header; `canUndo` adds the Undo button.
    struct CalendarToast: Equatable { let text: String; let canUndo: Bool }

    init(
        event: DIPEventDetail,
        joined: Bool,
        showsBottomBar: Bool = true,
        onJoin: @escaping () -> Void,
        onBack: @escaping () -> Void,
        onAttendees: @escaping () -> Void,
        onChat: @escaping () -> Void,
        photos: [DIPPhoto] = [],
        onAlbum: @escaping () -> Void = {},
        albumLoading: Bool = false,
        onLeave: @escaping () -> Void = {},
        onConfirmedLeave: (() async -> Bool)? = nil,
        participationPending: Bool = false,
        onInvite: (() -> Void)? = nil,
        calendarEvents: [DIPEventDetail] = []
    ) {
        self.onConfirmedLeave = onConfirmedLeave
        self.participationPending = participationPending
        self.calendarEvents = calendarEvents
        self.onInvite = onInvite
        self.onLeave = onLeave
        self.photos = photos
        self.onAlbum = onAlbum
        self.albumLoading = albumLoading
        self.event = event
        self.joined = joined
        self.onJoin = onJoin
        self.showsBottomBar = showsBottomBar
        self.onBack = onBack
        self.onAttendees = onAttendees
        self.onChat = onChat
    }

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .top) {
                Color.white
                VStack(spacing: 0) {
                    header
                    ScrollView {
                        VStack(alignment: .leading, spacing: 10) {
                            hero
                            VStack(alignment: .leading, spacing: 20) {
                                activityDetails
                                attendeeDetails
                                if let metadata = event.metadata { eventMetadata(metadata) }
                                if calendar.showsTeaser, addableMetadata != nil { calendarTeaser }
                                if let log = event.metadata?.changeLog, DIPChangeLogText.visibleCount(log) > 0 { changesButton(log) }
                                if joined, !event.isPast, event.metadata?.status != .cancelled { leaveButton }
                                if event.isPast { albumPreview }
                            }
                        }
                        .padding(.horizontal, 20)
                        .padding(.bottom, 130)
                    }
                    .scrollIndicators(.hidden)
                }
                .padding(.bottom, 22)
                .overlay(alignment: .top) {
                    if let toast {
                        calendarToastView(toast)
                            .padding(.top, DIPDuoPaneLayout.topInset(open: duoOpen) + 66)
                            .transition(reduceMotion ? .opacity : .opacity.combined(with: .move(edge: .top)))
                    }
                }
                if showsBottomBar {
                    Button(action: primaryAction) {
                        HStack(spacing: 0) {
                            Text(primaryTitle)
                                .font(DIPReferenceAssets.font("Figtree-Regular", size: 24))
                                .foregroundStyle(.white)
                                // Accessibility sizes wrap then shrink instead of truncating (normal sizes unchanged).
                                .lineLimit(dynamicTypeSize.isAccessibilitySize ? 2 : nil)
                                .minimumScaleFactor(dynamicTypeSize.isAccessibilitySize ? 0.4 : 1)
                                .multilineTextAlignment(.center)
                                .frame(maxWidth: .infinity)
                            if showsChatAffordance {
                                // Joined: the bar becomes the chat entry, with an icon circle that pops in.
                                DIPReferenceAssets.image("event_HeroiconsOutlineChatBubbleOvalLeft").resizable()
                                    .frame(width: 30, height: 30)
                                    .frame(width: 64, height: 64)
                                    .background(.white, in: Circle())
                                    .transition(reduceMotion ? .opacity : .scale(scale: 0.3).combined(with: .opacity))
                                    .accessibilityHidden(true)
                            }
                        }
                        .padding(.horizontal, showsChatAffordance ? 8 : 0)
                        .frame(maxWidth: .infinity).dipFixedFrame(height: 80)
                        .background(
                            joined
                                ? DIPTokens.Color.actionPrimary.swiftUIColor
                                : DIPTokens.Color.navigationBackground.swiftUIColor,
                            in: Capsule()
                        )
                        .contentShape(Capsule())
                        .animation(reduceMotion ? nil : .spring(response: 0.5, dampingFraction: 0.72), value: joined)
                    }
                    .buttonStyle(.plain)
                    .disabled(!primaryEnabled || (participationPending && !joined))
                    .accessibilityIdentifier("event.primary")
                    .accessibilityValue(joined ? "Joined" : "Not joined")
                    .padding(.horizontal, 20)
                    .position(x: geometry.size.width / 2, y: geometry.size.height - 61)
                }
            }
            .clipped()
        }
        .ignoresSafeArea()
        .preferredColorScheme(.light)
        .accessibilityElement(children: .contain)
        // Joining and leaving are announced by the shell, once, after the server confirmed or the change rolled back.
        .sheet(isPresented: $showingChanges) {
            DIPEventChangesSheet(eventTitle: event.title, log: event.metadata?.changeLog ?? []).dipDuoSheetSizing(duoOpen)
        }
        .task(id: conflictsTaskID) {
            let key = conflictsTaskID
            guard addableMetadata != nil else { conflicts = []; conflictsKey = key; entryRemovable = false; return }
            let fresh = await calendar.conflicts(for: event, among: calendarEvents)
            guard !Task.isCancelled else { return }
            conflicts = fresh
            conflictsKey = key
            // A calendar entry the member deleted in Calendar stops reading "Added"; remember what DIP can remove.
            if let fields = calendarFields {
                let removable = await calendar.reconcileEntry(eventID: event.id, fields: fields)
                if !Task.isCancelled { entryRemovable = removable }
            }
        }
        .alert("Calendar access is off", isPresented: $showsAccessAlert) {
            Button("Open Settings") {
                if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
            }
            Button("OK", role: .cancel) {}
        } message: {
            Text("You can allow it in Settings > DIP > Calendars.")
        }
        .confirmationDialog("Leave this activity?", isPresented: $confirmingLeave, titleVisibility: .visible) {
            Button("Leave activity", role: .destructive) { Task { _ = await leave() } }
            if entryRemovable, calendar.canRemoveEntry(eventID: event.id) {
                Button("Leave and remove from calendar", role: .destructive) {
                    Task {
                        // Only a confirmed leave removes the entry: a refused or failed leave keeps both.
                        guard await leave(), let fields = calendarFields else { return }
                        let removal = await calendar.removeEntry(eventID: event.id, fields: fields)
                        calendarResult = nil
                        entryRemovable = false
                        if removal == .failed {
                            DIPHaptics.failure()
                            show(toast: CalendarToast(text: "You left. Delete the entry in Calendar.", canUndo: false), seconds: 5)
                        }
                    }
                }
            }
            Button("Keep my place", role: .cancel) {}
        } message: {
            Text("Your place will be released. You can join again before the activity starts if space is available.")
        }
    }

    private var header: some View {
        return DIPDetailHeader(
            timing: Self.dateOnly(event), widePill: event.isPast, identifierPrefix: "event", onBack: onBack,
            calendarLabel: addableMetadata.map(Self.calendarLabel), calendarState: pillState,
            onCalendar: addToCalendar)
        .alert(DIPCalendarOverlapText.title(conflicts), isPresented: $showsConflictAlert) {
            Button("Add anyway") { performAdd() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(DIPCalendarOverlapText.message(conflicts, eventStart: event.metadata?.startTime))
        }
        .alert("Couldn’t add to calendar", isPresented: Binding(
            get: { if case .failed = calendarResult { return true } else { return false } },
            set: { if !$0 { calendarResult = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            if case .failed(let message) = calendarResult { Text(message) }
        }
    }

    /// The header pill shows the date only ("Nov 23, 2026"); the time lives in the When row of the info card.
    static func dateOnly(_ event: DIPEventDetail) -> String {
        if let start = event.metadata?.startTime { return start.formatted(.dateTime.month(.abbreviated).day().year()) }
        // Fixture events without metadata: drop a trailing " at 6:30 PM" from the preformatted text.
        if let range = event.timing.range(of: " at ") { return String(event.timing[..<range.lowerBound]) }
        return event.timing
    }

    /// Metadata when the event can still be added to a calendar (not past, not cancelled); the header pill and the When row share this gate.
    private var addableMetadata: DIPEventMetadata? {
        event.metadata.flatMap { !event.isPast && $0.canAddToCalendar(now: Date()) ? $0 : nil }
    }

    private var calendarFields: DIPCalendarEventFields? {
        event.metadata?.calendarFields(title: event.title, description: event.description, eventID: event.id)
    }

    private var pillState: DIPCalendarPillState {
        let isAdded = addableMetadata != nil && calendarFields.map { calendar.isAdded(eventID: event.id, fields: $0) } == true
        return DIPCalendarPillState.resolve(
            canAdd: addableMetadata != nil, isAdded: isAdded || calendarResult == .added, isAdding: addingToCalendar,
            direct: calendar.savesDirectly, conflicts: conflicts)
    }

    private var conflictsTaskID: String { "\(event.id)-\(calendar.revision)-\(event.metadata?.revision ?? 0)" }

    /// Leaves through the shell when it reports back; false when the leave did not go through.
    private func leave() async -> Bool {
        if let onConfirmedLeave { return await onConfirmedLeave() }
        onLeave()
        return true
    }

    /// The one add-to-calendar action, used by the header pill and the When row. A conflict asks first; a tap before
    /// the first conflict read finished waits for it, so an overlap is never skipped.
    private func addToCalendar() {
        guard addableMetadata != nil, !addingToCalendar, pillState.isEnabled else { return }
        Task {
            if conflictsKey != conflictsTaskID {
                addingToCalendar = true
                conflicts = await calendar.conflicts(for: event, among: calendarEvents)
                conflictsKey = conflictsTaskID
                addingToCalendar = false
            }
            if conflicts.isEmpty { performAdd() } else { showsConflictAlert = true }
        }
    }

    private func performAdd() {
        guard addableMetadata != nil, !addingToCalendar, let fields = calendarFields else { return }
        addingToCalendar = true
        Task {
            defer { addingToCalendar = false }
            if calendar.savesDirectly {
                let result = await calendar.addDirectly(fields, eventID: event.id)
                calendarResult = result
                switch result {
                case .added:
                    DIPHaptics.success()
                    show(toast: CalendarToast(text: "Added to your calendar", canUndo: true), seconds: 5,
                         announcement: "Added to your calendar. Undo available.")
                case .failed: DIPHaptics.failure()
                case .cancelled: break
                }
            } else {
                let result = await calendarAdder.add(fields)
                calendarResult = result
                if result == .added { await calendar.markAddedThroughEditor(fields, eventID: event.id) }
                if case .failed = result { DIPHaptics.failure() }
            }
        }
    }

    private func undoAdd() {
        guard let fields = calendarFields else { return }
        Task {
            switch await calendar.removeEntry(eventID: event.id, fields: fields) {
            case .removed, .alreadyGone:
                calendarResult = nil
                show(toast: CalendarToast(text: "Removed from your calendar", canUndo: false), seconds: 2.5)
            case .failed:
                // The entry is still there: keep "Added" and say how to finish the job.
                DIPHaptics.failure()
                show(toast: CalendarToast(text: "Couldn’t remove it. Delete it in Calendar.", canUndo: false), seconds: 5)
            }
        }
    }

    /// Longer while an assistive technology is driving: Undo must outlast a swipe-and-double-tap.
    private func toastDuration(_ seconds: Double) -> Double {
        UIAccessibility.isVoiceOverRunning || UIAccessibility.isSwitchControlRunning ? max(seconds, 10) : seconds
    }

    private func show(toast message: CalendarToast, seconds: Double, announcement: String? = nil) {
        toastTask?.cancel()
        withAnimation(reduceMotion ? .linear(duration: 0.15) : .spring(response: 0.35, dampingFraction: 0.85)) { toast = message }
        AccessibilityNotification.Announcement(announcement ?? message.text).post()
        let lifetime = toastDuration(seconds)
        toastTask = Task {
            try? await Task.sleep(for: .seconds(lifetime))
            guard !Task.isCancelled else { return }
            withAnimation(reduceMotion ? .linear(duration: 0.15) : .easeOut(duration: 0.2)) { toast = nil }
        }
    }

    private func calendarToastView(_ toast: CalendarToast) -> some View {
        HStack(spacing: 8) {
            Text(toast.text)
                .font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .body))
                .foregroundStyle(.white)
                .accessibilityIdentifier("event.calendarToast")
                .accessibilityAction(named: "Undo") { if toast.canUndo { undoAdd() } }
            if toast.canUndo {
                // The whole 44 pt box is the button's label, so the hit area matches what VoiceOver outlines.
                Button { undoAdd() } label: {
                    Text("Undo")
                        .font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .body).weight(.bold))
                        .foregroundStyle(.white).underline()
                        .frame(minWidth: 44, minHeight: 44)
                        .contentShape(Rectangle())
                }
                .accessibilityIdentifier("event.calendarUndo")
            }
        }
        .padding(.leading, 20).padding(.trailing, toast.canUndo ? 12 : 20).padding(.vertical, 2).frame(minHeight: 44)
        .background(DIPTokens.Color.navigationBackground.swiftUIColor, in: Capsule())
        .padding(.horizontal, 20)
        .accessibilityElement(children: .contain)
    }

    /// Opt-in card (CAL-3): shown until the member turns conflicts on or dismisses it.
    private var calendarTeaser: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("See what overlaps")
                .font(DIPReferenceAssets.font("Figtree-Regular", size: 18, relativeTo: .body))
                .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor)
            Text("DIP can warn you when an activity overlaps your calendar. Your calendar stays on your phone.")
                .font(DIPReferenceAssets.font("Inter-Regular", size: 13, relativeTo: .footnote))
                .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor.opacity(0.72))
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 10) {
                DIPButton("Turn on") {
                    Task {
                        await calendar.setShowsConflicts(true)
                        if calendar.accessDeniedNotice {
                            calendar.accessDeniedNotice = false
                            showsAccessAlert = true
                        }
                    }
                }
                DIPButton("Not now", emphasis: .secondary) { calendar.dismissTeaser() }
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DIPTokens.Color.surfaceMuted.swiftUIColor,
                    in: RoundedRectangle(cornerRadius: DIPTokens.Radius.card, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("event.calendarTeaser")
    }

    /// CAL-5: the event moved since DIP wrote the calendar entry.
    private var calendarUpdateRow: some View {
        HStack(spacing: 12) {
            Text("This activity moved. Update your calendar entry.")
                .font(DIPReferenceAssets.font("Inter-Regular", size: 13, relativeTo: .footnote))
                .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button {
                guard let fields = calendarFields else { return }
                Task {
                    if await calendar.updateEntry(eventID: event.id, fields: fields) {
                        show(toast: CalendarToast(text: "Calendar entry updated", canUndo: false), seconds: 2.5)
                    }
                }
            } label: {
                Text("Update")
                    .font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .body))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 16).frame(minWidth: 44, minHeight: 44)
                    .background(DIPTokens.Color.actionPrimary.swiftUIColor, in: Capsule())
                    .contentShape(Capsule())
            }
            .buttonStyle(DIPPressFeedbackStyle())
            .accessibilityIdentifier("event.calendarUpdate")
        }
        .accessibilityElement(children: .contain)
    }

    private var hero: some View {
        DIPDetailHero(image: event.image, tags: event.tags, identifierPrefix: "event")
    }

    private var activityDetails: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(event.title.uppercased())
                .font(DIPReferenceAssets.font("FjallaOne-Regular", size: 40, relativeTo: .largeTitle))
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("event.title")
            Text(event.description)
                .font(DIPReferenceAssets.font("Inter-Regular", size: event.isPast ? 15 : 14))
                // The source uses 18-point lines; Inter 3.19 has a 16.943-point natural line height.
                .lineSpacing(1.0566566)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(.black)
        .padding(.top, 10)
    }

    private var attendeeDetails: some View {
        VStack(alignment: .leading, spacing: 10) {
            DIPDetailPeopleRow(
                title: event.isPast ? "Who Attended" : "Who’s Attending",
                avatars: event.attendeeAvatars, total: event.attendeeCount,
                emptyTitle: event.isPast ? "No attendance recorded" : "Be the first to join",
                emptyText: event.isPast ? "No one checked in to this event." : "Coworkers who join will show up here.",
                capacity: event.isPast || event.metadata?.status == .cancelled ? nil : event.metadata?.capacity,
                trailingNote: event.metadata?.status == .cancelled ? "Cancelled" : event.isPast && event.attendeeCount > 0 ? "\(event.attendeeCount) went" : nil,
                identifierPrefix: "event", onMore: onAttendees)
            DIPDetailActionRow(
                invite: invitePill,
                showsParticipation: true,
                // The bottom bar (own or the shell's) is the one Join action; this slot is Directions (always, when there is a location); Leave sits at the bottom of the page.
                joinInRow: false, directionsURL: event.metadata?.directionsURL(fallbackTitle: event.title),
                isParticipating: joined, canChange: canChangeParticipation,
                joinTitle: "Join Activity", leaveTitle: "Leave Activity",
                shareItem: event.metadata?.shareText(title: event.title, description: event.description) ?? "\(event.title) — \(event.timing)",
                shareLink: event.metadata?.status == .cancelled ? nil : DIPShareLink.url(forEventID: event.id),
                shareTitle: "Share Event", identifierPrefix: "event",
                onJoin: onJoin, onLeave: { confirmingLeave = true })
        }
    }

    /// Cancelled, started and finished activities have nothing to invite to; a full one shows the action disabled with the reason.
    private var inviteDenial: DIPInviteDenial? {
        guard let metadata = event.metadata else { return nil }
        return DIPInviteRules.denial(metadata, attendeeCount: event.attendeeCount, now: Date())
    }
    /// Invite Coworker takes the first slot beside Share only while inviting is possible (upcoming, scheduled, not started,
    /// not full, and an invitations adapter exists); otherwise the slot is Directions again.
    private var invitePill: DIPDetailActionRow.InviteAction? {
        guard let onInvite, !event.isPast, inviteDenial == nil else { return nil }
        return .init(accessibilityLabel: "Invite a coworker to \(event.title)", action: onInvite)
    }

    /// Solid (pressable) pill, shown only when the organizer has edited the event.
    private func changesButton(_ log: [DIPChangeLogEntry]) -> some View {
        Button { showingChanges = true } label: {
            // Dark solid like the other quiet actions ("+ N More", "See All"), so it does not compete with Directions/Share.
            DIPActionPill(title: DIPChangeLogText.visibleCount(log) == 1 ? "See what changed" : "See what changed (\(DIPChangeLogText.visibleCount(log)))",
                          color: DIPTokens.Color.navigationBackground.swiftUIColor, style: .solid) {
                Image(systemName: "clock.arrow.circlepath").resizable().scaledToFit()
            }
        }
        .buttonStyle(DIPPressFeedbackStyle())
        .accessibilityIdentifier("event.changes")
    }

    /// Quiet destructive-secondary text button at the very bottom of the page.
    private var leaveButton: some View {
        Button { confirmingLeave = true } label: {
            Text("Leave Activity")
                .font(DIPReferenceAssets.font("Inter-Regular", size: 15))
                .foregroundStyle(DIPTokens.Color.textError.swiftUIColor)
                .frame(maxWidth: .infinity, minHeight: 44)
                .contentShape(Rectangle())
        }
        // The column spaces sections by 20; 4 more above and below makes ~24pt of air around the button.
        .padding(.vertical, 4)
        .buttonStyle(DIPPressFeedbackStyle())
        .disabled(!canChangeParticipation || participationPending)
        .opacity(canChangeParticipation ? 1 : 0.5)
        .accessibilityHint("Asks you to confirm before giving up your place")
        .accessibilityIdentifier("event.leave")
    }

    private var canChangeParticipation: Bool {
        guard let metadata = event.metadata else { return true }
        guard metadata.status == .scheduled else { return false }
        if joined { return metadata.canCancel(now: Date()) }
        return metadata.startTime > Date() && event.attendeeCount < metadata.capacity
    }

    private var albumPreview: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Photo Album")
                .font(DIPReferenceAssets.font("Figtree-Regular", size: 18))
                .foregroundStyle(.black)
                .accessibilityAddTraits(.isHeader)
            if photos.isEmpty && albumLoading {
                // The first album read is still in flight: neutral tiles, not "No photos yet".
                HStack(spacing: 10) {
                    ForEach(0..<3, id: \.self) { _ in
                        RoundedRectangle(cornerRadius: 20).fill(DIPTokens.Color.surfaceMuted.swiftUIColor).frame(width: 100, height: 134)
                    }
                }
                .accessibilityElement(children: .ignore).accessibilityLabel("Loading photos")
            } else if photos.isEmpty {
                // EVT-Q6: a past activity nobody photographed shows a compact empty state, not an empty scroll.
                HStack(alignment: .center, spacing: 14) {
                    Image(systemName: "photo.on.rectangle.angled")
                        .font(.system(size: 16)).foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor.opacity(0.7))
                        .frame(width: 34, height: 34)
                        .background(DIPTokens.Color.surfaceMuted.swiftUIColor, in: Circle())
                        .accessibilityHidden(true)
                    DIPEmptyState(screen: "event-album", title: "No photos yet",
                                  message: "Photos from this activity will show up here.", style: .compact, faces: 0)
                }
            }
            if !photos.isEmpty {
            ScrollView(.horizontal) {
                HStack(spacing: 10) {
                    ForEach(Array(photos.prefix(8).enumerated()), id: \.element.id) { index, photo in
                        Button(action: onAlbum) {
                            DIPMedia(photo.image).resizable().scaledToFill()
                                .frame(width: 100, height: 134).clipped()
                                .clipShape(RoundedRectangle(cornerRadius: 20))
                        }
                        .buttonStyle(DIPPressFeedbackStyle())
                        .accessibilityLabel("View photo album, photo \(index + 1)")
                        .accessibilityIdentifier("event.album.photo.\(index)")
                    }
                }
                .padding(.horizontal, 20)
            }
            .scrollIndicators(.hidden)
            .padding(.horizontal, -20)
            }
        }
        .accessibilityIdentifier("event.album.preview")
    }

    private func eventMetadata(_ metadata: DIPEventMetadata) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            if metadata.status == .cancelled {
                Label("Activity cancelled", systemImage: "calendar.badge.exclamationmark")
                    .font(.headline)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("event.cancelled")
            }
            whenRow(metadata)
            if let fields = calendarFields, calendar.needsUpdate(eventID: event.id, fields: fields) { calendarUpdateRow }
            whereRow(metadata)
            metadataRow("ticket", title: "Price") {
                Text(metadata.costCents == 0 ? "Free" : (Double(metadata.costCents) / 100).formatted(.currency(code: "USD")))
                if !metadata.costNote.isEmpty { Text(metadata.costNote).foregroundStyle(.secondary) }
            }
            .accessibilityIdentifier("event.price")
            if metadata.status != .cancelled,
               let text = DIPPointsFormat.eventRow(metadata.pointsValue, isPast: event.isPast, attended: joined) {
                metadataRow("star.fill", title: "Points", tint: DIPTokens.Color.notificationAccent.swiftUIColor) {
                    Text(text)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(event.isPast ? text : (DIPPointsFormat.rewardAccessibility(metadata.pointsValue) ?? text))
                .accessibilityIdentifier("event.points")
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DIPTokens.Color.actionPrimary.swiftUIColor.opacity(0.07), in: RoundedRectangle(cornerRadius: 20))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("event.metadata")
    }

    /// Tappable (adds to calendar, like the header pill) while the event can be added; otherwise informational.
    @ViewBuilder private func whenRow(_ metadata: DIPEventMetadata) -> some View {
        let row = { (trailing: AnyView) in
            metadataRow("calendar", title: "When", trailing: trailing) {
                Text(metadata.startTime, format: .dateTime.weekday(.wide).month(.wide).day().year())
                // The same end the calendar entry gets (an absent end defaults to one hour), so row and entry agree.
                let calendarEnd = metadata.calendarEnd
                let multiDay = !Calendar.current.isDate(metadata.startTime, inSameDayAs: calendarEnd)
                Text("\(metadata.startTime.formatted(date: .omitted, time: .shortened)) – \(calendarEnd.formatted(date: .omitted, time: .shortened))\(multiDay ? " (\(calendarEnd.formatted(.dateTime.month(.abbreviated).day())))" : "")")
                Text(durationLabel(metadata))
                    .foregroundStyle(.secondary)
            }
        }
        if addableMetadata != nil {
            let state = pillState
            let glyph: String = switch state {
            case .added: "checkmark"
            case .conflict: "exclamationmark.triangle.fill"
            default: "calendar.badge.plus"
            }
            Button(action: addToCalendar) {
                row(AnyView(rowGlyph(glyph)))
                    .frame(minHeight: 44).contentShape(Rectangle())
            }
            .buttonStyle(DIPPressFeedbackStyle(cornerRadius: 12))
            .disabled(!state.isEnabled)
            .accessibilityHint(state.accessibilityLabel)
            .accessibilityIdentifier("event.when")
        } else {
            row(AnyView(EmptyView())).accessibilityIdentifier("event.when")
        }
    }

    /// Tappable (opens directions, like the Directions pill) when there is a venue or address and the event is not past.
    @ViewBuilder private func whereRow(_ metadata: DIPEventMetadata) -> some View {
        let row = { (trailing: AnyView) in
            metadataRow("mappin.and.ellipse", title: "Where", trailing: trailing) {
                // Live data can lack a venue name or address: say so instead of drawing an empty row.
                if metadata.venueName.isEmpty && metadata.address.isEmpty && metadata.locality.isEmpty {
                    Text("Location to be announced").foregroundStyle(.secondary)
                } else {
                    if !metadata.venueName.isEmpty { Text(metadata.venueName) }
                    if !metadata.address.isEmpty { Text(metadata.address).foregroundStyle(.secondary) }
                    if !metadata.locality.isEmpty { Text(metadata.locality).foregroundStyle(.secondary) }
                }
            }
        }
        if !event.isPast, let url = metadata.mapsURL {
            Button { openURL(url) } label: {
                row(AnyView(rowGlyph("arrow.up.right"))).frame(minHeight: 44).contentShape(Rectangle())
            }
            .buttonStyle(DIPPressFeedbackStyle(cornerRadius: 12))
            .accessibilityHint("Get directions")
            .accessibilityIdentifier("event.where")
        } else {
            row(AnyView(EmptyView())).accessibilityIdentifier("event.where")
        }
    }

    /// Minimal trailing affordance for a tappable row (the chevron the Profile rows use).
    private func rowGlyph(_ symbol: String) -> some View {
        Image(systemName: symbol).font(.callout.weight(.semibold))
            .foregroundStyle(DIPTokens.Color.actionPrimary.swiftUIColor)
            .frame(width: 24, height: 24)
            .accessibilityHidden(true)
    }

    /// Pill label: short date by default ("Monday, 11/23", no time; the card has the full details);
    /// `--calendar-label=generic` switches to "Add to Calendar" for owner comparison.
    private static func calendarLabel(_ metadata: DIPEventMetadata) -> String {
        if MockLaunch.Flags.contains("--calendar-label=generic") { return "Add to Calendar" }
        return metadata.startTime.formatted(.dateTime.weekday(.wide).month(.defaultDigits).day())
    }

    private func metadataRow<Content: View, Trailing: View>(
        _ symbol: String, title: String, tint: Color = DIPTokens.Color.actionPrimary.swiftUIColor,
        trailing: Trailing = EmptyView(), @ViewBuilder content: () -> Content
    ) -> some View {
        HStack(alignment: .center, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: symbol)
                    .foregroundStyle(tint)
                    .frame(width: 24).padding(.top, 2)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    content().font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .body))
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .accessibilityElement(children: .combine)
            trailing
        }
    }

    private func durationLabel(_ metadata: DIPEventMetadata) -> String {
        let minutes = max(0, Int(metadata.calendarEnd.timeIntervalSince(metadata.startTime) / 60))
        let hours = minutes / 60
        let remainder = minutes % 60
        if hours == 0 { return "\(minutes) min" }
        return remainder == 0 ? "\(hours) hr" : "\(hours) hr \(remainder) min"
    }

    private var primaryTitle: String {
        if event.metadata?.status == .cancelled { return "Activity cancelled" }
        if event.isPast { return "View Album" }
        if joined { return "Activity Chat" }
        if let metadata = event.metadata {
            if metadata.startTime <= Date() { return "Activity started" }
            if event.attendeeCount >= metadata.capacity { return "Activity full" }
        }
        return "Join the Activity"
    }

    private var showsChatAffordance: Bool { joined && !event.isPast && event.metadata?.status != .cancelled }

    private var primaryEnabled: Bool {
        guard event.metadata?.status != .cancelled else { return false }
        if event.isPast || joined { return true }
        guard let metadata = event.metadata else { return true }
        return metadata.startTime > Date() && event.attendeeCount < metadata.capacity
    }

    private func primaryAction() {
        guard primaryEnabled else { return }
        if event.isPast { onAlbum() } else if joined { onChat() } else { onJoin() }
    }
}
