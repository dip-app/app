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
                                if let metadata = event.metadata { eventMetadata(metadata) }
                                attendeeDetails
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
                        Text(primaryTitle)
                            .font(DIPReferenceAssets.font("Figtree-Regular", size: 24))
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity).frame(height: 80)
                            .background(
                                joined
                                    ? DIPTokens.Color.actionPrimary.swiftUIColor
                                    : DIPTokens.Color.navigationBackground.swiftUIColor,
                                in: Capsule()
                            )
                            .contentShape(Capsule())
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
        HStack {
            Button(action: onBack) {
                DIPReferenceAssets.image("event_BackButton").resizable()
                    .frame(width: 50, height: 50)
            }
            .buttonStyle(.plain).accessibilityLabel("Back")
            .accessibilityIdentifier("event.back")
            Spacer(minLength: 10)
            Text(event.timing)
                .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                .foregroundStyle(.black)
                .padding(.horizontal, event.isPast ? 28 : 0)
                .frame(width: event.isPast ? nil : 164, height: 50)
                .overlay(Capsule().strokeBorder(DIPTokens.Color.actionPrimary.swiftUIColor, lineWidth: 2))
        }
        .padding(.horizontal, 20).padding(.top, 60).padding(.bottom, 10)
    }

    private var hero: some View {
        GeometryReader { geometry in
            ZStack(alignment: .bottomTrailing) {
                DIPMedia(event.image).resizable().scaledToFill()
                    .frame(width: geometry.size.width, height: 264).clipped()
                HStack(spacing: 10.435) {
                    ForEach(event.tags, id: \.self) { tag in
                        Text(tag)
                            .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                            .foregroundStyle(.black)
                            .padding(.horizontal, 13.043)
                            .frame(height: 30)
                            .background(.white, in: Capsule())
                    }
                }
                .padding(10)
            }
            .clipShape(RoundedRectangle(cornerRadius: 20))
        }
        .frame(height: 264)
        .accessibilityIdentifier("event.hero")
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
                .frame(minHeight: event.isPast ? 0 : 126, alignment: .topLeading)
        }
        .foregroundStyle(.black)
        .padding(.top, 10)
    }

    private var attendeeDetails: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(event.isPast ? "Who Attended" : "Who’s Attending")
                .font(DIPReferenceAssets.font("Figtree-Regular", size: 18))
                .foregroundStyle(.black).frame(height: 22)
            if event.attendeeCount == 0 {
                Text("No one has joined yet. Be the first to make plans.")
                    .font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .body))
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("event.attendees.empty")
            } else {
                HStack(spacing: 10) {
                    ForEach(Array(event.attendeeAvatars.prefix(4).enumerated()), id: \.offset) { _, avatar in
                        DIPMedia(avatar)
                            .resizable().frame(width: 40, height: 40)
                            .accessibilityHidden(true)
                    }
                    Button(action: onAttendees) {
                        Text("View attendees · \(event.attendeeCount)")
                            .font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .body))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 14).padding(.vertical, 12)
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .background(DIPTokens.Color.navigationBackground.swiftUIColor, in: Capsule())
                    }
                    .buttonStyle(DIPPressFeedbackStyle()).accessibilityLabel("View \(event.attendeeCount) attendees")
                    .accessibilityIdentifier("event.attendees")
                }
            }
            if joined && !event.isPast {
                Label("You’re going", systemImage: "checkmark.circle.fill")
                    .font(DIPReferenceAssets.font("Figtree-Regular", size: 16, relativeTo: .body))
                    .foregroundStyle(DIPTokens.Color.actionPrimary.swiftUIColor)
                    .accessibilityIdentifier("event.joined")
            }
            HStack(spacing: 10) {
                ShareLink(item: event.metadata?.shareText(title: event.title) ?? "\(event.title) — \(event.timing)") {
                    secondaryLabel(
                        "Share event", asset: "event_HeroiconsMiniLink",
                        background: Color(red: 240 / 255, green: 84 / 255, blue: 165 / 255))
                }
                .buttonStyle(DIPPressFeedbackStyle())
                .accessibilityLabel("Share event")
                .accessibilityIdentifier("event.share")
                if joined && !event.isPast && (event.metadata?.canCancel(now: Date()) ?? true) {
                    Button { confirmingLeave = true } label: {
                        Text("Leave activity")
                            .font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .body))
                            .foregroundStyle(.primary)
                            .padding(.horizontal, 16)
                            .frame(maxWidth: .infinity, minHeight: 50)
                            .overlay(Capsule().strokeBorder(Color.secondary.opacity(0.35), lineWidth: 1))
                            .contentShape(Capsule())
                    }
                    .buttonStyle(DIPPressFeedbackStyle())
                    .accessibilityIdentifier("event.leave")
                }
            }
        }
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

    private func secondaryLabel(_ title: String, asset: String, background: Color) -> some View {
        HStack(spacing: 0) {
            Text(title)
                .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity).frame(height: 29)
            DIPReferenceAssets.image(asset).resizable().frame(width: 20, height: 20)
                .frame(width: 40, height: 40)
                .background(.white, in: Circle())
        }
        .padding(5).frame(height: 50)
        .background(background, in: Capsule())
        .contentShape(Capsule())
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
            metadataRow("person.2", title: "Places") {
                Text("\(event.attendeeCount) going · \(metadata.capacity) places")
                if event.attendeeCount >= metadata.capacity && !joined {
                    Text("This activity is full").foregroundStyle(.secondary)
                }
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
