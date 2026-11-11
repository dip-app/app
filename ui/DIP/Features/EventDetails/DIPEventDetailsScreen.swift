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
    let onLeave: () -> Void
    /// Opens the coworker picker; nil hides the action (no invitations adapter, or read-only live events).
    let onInvite: (() -> Void)?
    @State private var confirmingLeave = false
    @State private var showingChanges = false
    @State private var calendarResult: DIPCalendarAddResult?
    @Environment(\.eventCalendarAdder) private var calendarAdder
    @Environment(\.openURL) private var openURL
    /// True while the calendar editor is being presented, so a second tap (row or pill) cannot open another one.
    @State private var addingToCalendar = false

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
        onLeave: @escaping () -> Void = {},
        onInvite: (() -> Void)? = nil
    ) {
        self.onInvite = onInvite
        self.onLeave = onLeave
        self.photos = photos
        self.onAlbum = onAlbum
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
                if showsBottomBar {
                    Button(action: primaryAction) {
                        HStack(spacing: 0) {
                            Text(primaryTitle)
                                .font(DIPReferenceAssets.font("Figtree-Regular", size: 24))
                                .foregroundStyle(.white)
                                .frame(maxWidth: .infinity)
                            if showsChatAffordance {
                                // Joined: the bar becomes the chat entry, with an icon circle that pops in.
                                DIPReferenceAssets.image("event_HeroiconsOutlineChatBubbleOvalLeft").resizable()
                                    .frame(width: 30, height: 30)
                                    .frame(width: 64, height: 64)
                                    .background(.white, in: Circle())
                                    .transition(.scale(scale: 0.3).combined(with: .opacity))
                                    .accessibilityHidden(true)
                            }
                        }
                        .padding(.horizontal, showsChatAffordance ? 8 : 0)
                        .frame(maxWidth: .infinity).frame(height: 80)
                        .background(
                            joined
                                ? DIPTokens.Color.actionPrimary.swiftUIColor
                                : DIPTokens.Color.navigationBackground.swiftUIColor,
                            in: Capsule()
                        )
                        .contentShape(Capsule())
                        .animation(.spring(response: 0.5, dampingFraction: 0.72), value: joined)
                    }
                    .buttonStyle(.plain)
                    .disabled(!primaryEnabled)
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
        // Joining and leaving change the bottom bar and the Leave button: say so, once, for VoiceOver.
        .onChange(of: joined) { old, new in
            guard old != new else { return }
            AccessibilityNotification.Announcement(new ? "You joined \(event.title)" : "You left \(event.title)").post()
        }
        .sheet(isPresented: $showingChanges) {
            DIPEventChangesSheet(eventTitle: event.title, log: event.metadata?.changeLog ?? [])
        }
        .confirmationDialog("Leave this activity?", isPresented: $confirmingLeave, titleVisibility: .visible) {
            Button("Leave activity", role: .destructive, action: onLeave)
            Button("Keep my place", role: .cancel) {}
        } message: {
            Text("Your place will be released. You can join again before the activity starts if space is available.")
        }
    }

    private var header: some View {
        return DIPDetailHeader(
            timing: event.timing, widePill: event.isPast, identifierPrefix: "event", onBack: onBack,
            calendarLabel: addableMetadata.map(Self.calendarLabel), calendarAdded: calendarResult == .added,
            onCalendar: addToCalendar)
        .alert("Couldn’t add to calendar", isPresented: Binding(
            get: { if case .failed = calendarResult { return true } else { return false } },
            set: { if !$0 { calendarResult = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            if case .failed(let message) = calendarResult { Text(message) }
        }
    }

    /// Metadata when the event can still be added to a calendar (not past, not cancelled); the header pill and the When row share this gate.
    private var addableMetadata: DIPEventMetadata? {
        event.metadata.flatMap { !event.isPast && $0.canAddToCalendar(now: Date()) ? $0 : nil }
    }

    /// The one add-to-calendar action, used by the header pill and the When row.
    private func addToCalendar() {
        guard let metadata = addableMetadata, !addingToCalendar else { return }
        let fields = metadata.calendarFields(title: event.title, description: event.description)
        addingToCalendar = true
        Task {
            defer { addingToCalendar = false }
            calendarResult = await calendarAdder.add(fields)
        }
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
                capacity: event.isPast ? nil : event.metadata?.capacity,
                identifierPrefix: "event", onMore: onAttendees)
            if onInvite != nil, canOfferInvite { inviteButton }
            DIPDetailActionRow(
                showsParticipation: !event.isPast,
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
    private var canOfferInvite: Bool {
        guard !event.isPast else { return false }
        switch inviteDenial { case nil, .full?: return true; default: return false }
    }

    /// Solid (pressable) ink pill under the attendees, like "See what changed" (a separate action from the iOS share sheet).
    private var inviteButton: some View {
        let denial = inviteDenial
        return VStack(alignment: .leading, spacing: 6) {
            Button { onInvite?() } label: {
                DIPActionPill(title: "Invite a Coworker", color: DIPTokens.Color.navigationBackground.swiftUIColor, style: .solid) {
                    Image(systemName: "person.badge.plus").resizable().scaledToFit()
                }
            }
            .buttonStyle(DIPPressFeedbackStyle())
            .disabled(denial != nil)
            .opacity(denial == nil ? 1 : 0.5)
            .accessibilityLabel("Invite a coworker")
            .accessibilityHint(denial?.message ?? "Choose a coworker from your company to invite")
            .accessibilityIdentifier("event.invite")
            if let denial {
                Text(denial.message).font(DIPReferenceAssets.font("Inter-Regular", size: 13, relativeTo: .footnote)).foregroundStyle(.secondary)
            }
        }
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
                .foregroundStyle(.red)
                .frame(maxWidth: .infinity, minHeight: 44)
                .contentShape(Rectangle())
        }
        // The column spaces sections by 20; 4 more above and below makes ~24pt of air around the button.
        .padding(.vertical, 4)
        .buttonStyle(DIPPressFeedbackStyle())
        .disabled(!canChangeParticipation)
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
                let multiDay = !Calendar.current.isDate(metadata.startTime, inSameDayAs: metadata.endTime)
                Text("\(metadata.startTime.formatted(date: .omitted, time: .shortened)) – \(metadata.endTime.formatted(date: .omitted, time: .shortened))\(multiDay ? " (\(metadata.endTime.formatted(.dateTime.month(.abbreviated).day())))" : "")")
                Text(durationLabel(metadata))
                    .foregroundStyle(.secondary)
            }
        }
        if addableMetadata != nil {
            let added = calendarResult == .added
            Button(action: addToCalendar) {
                row(AnyView(rowGlyph(added ? "checkmark" : "calendar.badge.plus")))
                    .frame(minHeight: 44).contentShape(Rectangle())
            }
            .buttonStyle(DIPPressFeedbackStyle(cornerRadius: 12))
            .disabled(added || addingToCalendar)
            .accessibilityHint(added ? "Added to calendar" : "Add to calendar")
            .accessibilityIdentifier("event.when")
        } else {
            row(AnyView(EmptyView())).accessibilityIdentifier("event.when")
        }
    }

    /// Tappable (opens directions, like the Directions pill) when there is a venue or address and the event is not past.
    @ViewBuilder private func whereRow(_ metadata: DIPEventMetadata) -> some View {
        let row = { (trailing: AnyView) in
            metadataRow("mappin.and.ellipse", title: "Where", trailing: trailing) {
                Text(metadata.venueName)
                Text(metadata.address).foregroundStyle(.secondary)
                if !metadata.locality.isEmpty { Text(metadata.locality).foregroundStyle(.secondary) }
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
        if ProcessInfo.processInfo.arguments.contains("--calendar-label=generic") { return "Add to Calendar" }
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
        let minutes = max(0, Int(metadata.endTime.timeIntervalSince(metadata.startTime) / 60))
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
