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
    @State private var confirmingLeave = false

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
        onLeave: @escaping () -> Void = {}
    ) {
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
        .confirmationDialog("Leave this activity?", isPresented: $confirmingLeave, titleVisibility: .visible) {
            Button("Leave activity", role: .destructive, action: onLeave)
            Button("Keep my place", role: .cancel) {}
        } message: {
            Text("Your place will be released. You can join again before the activity starts if space is available.")
        }
    }

    private var header: some View {
        DIPDetailHeader(timing: event.timing, widePill: event.isPast, identifierPrefix: "event", onBack: onBack)
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
                emptyText: "No one has joined yet. Be the first to make plans.",
                capacity: event.isPast ? nil : event.metadata?.capacity,
                identifierPrefix: "event", onMore: onAttendees)
            DIPDetailActionRow(
                showsParticipation: !event.isPast,
                // The bottom bar (own or the shell's) is the one Join action; this slot is Directions before joining, Leave after.
                joinInRow: false, directionsURL: event.metadata?.mapsURL,
                isParticipating: joined, canChange: canChangeParticipation,
                joinTitle: "Join Activity", leaveTitle: "Leave Activity",
                shareItem: event.metadata?.shareText(title: event.title) ?? "\(event.title) — \(event.timing)",
                shareTitle: "Share Event", identifierPrefix: "event",
                onJoin: onJoin, onLeave: { confirmingLeave = true })
        }
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
            metadataRow("calendar", title: "When") {
                Text(metadata.startTime, format: .dateTime.weekday(.wide).month(.wide).day().year())
                Text("\(metadata.startTime.formatted(date: .omitted, time: .shortened)) – \(metadata.endTime.formatted(date: .omitted, time: .shortened))")
                if !Calendar.current.isDate(metadata.startTime, inSameDayAs: metadata.endTime) {
                    Text("Ends \(metadata.endTime.formatted(date: .abbreviated, time: .omitted))")
                }
                Text(durationLabel(metadata))
                    .foregroundStyle(.secondary)
            }
            metadataRow("mappin.and.ellipse", title: "Where") {
                Text(metadata.venueName)
                Text(metadata.address).foregroundStyle(.secondary)
                if !metadata.locality.isEmpty { Text(metadata.locality).foregroundStyle(.secondary) }
            }
            metadataRow("ticket", title: "Price") {
                Text(metadata.costCents == 0 ? "Free" : (Double(metadata.costCents) / 100).formatted(.currency(code: "USD")))
                if !metadata.costNote.isEmpty { Text(metadata.costNote).foregroundStyle(.secondary) }
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DIPTokens.Color.actionPrimary.swiftUIColor.opacity(0.07), in: RoundedRectangle(cornerRadius: 20))
        .accessibilityIdentifier("event.metadata")
    }

    private func metadataRow<Content: View>(_ symbol: String, title: String, @ViewBuilder content: () -> Content) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol)
                .foregroundStyle(DIPTokens.Color.actionPrimary.swiftUIColor)
                .frame(width: 24).padding(.top, 2)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(DIPReferenceAssets.font("Figtree-Bold", size: 16, relativeTo: .headline))
                content().font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .body))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
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
