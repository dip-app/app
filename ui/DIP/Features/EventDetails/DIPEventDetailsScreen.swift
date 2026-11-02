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

    init(
        event: DIPEventDetail,
        joined: Bool,
        showsBottomBar: Bool = true,
        onJoin: @escaping () -> Void,
        onBack: @escaping () -> Void,
        onAttendees: @escaping () -> Void,
        onChat: @escaping () -> Void
    ) {
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
                        Text(joined ? "Activity Chat" : "Join the Activity")
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
                .frame(width: 164, height: 50)
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
                .frame(height: 50, alignment: .leading)
                .accessibilityIdentifier("event.title")
            Text(event.description)
                .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                // The source uses 18-point lines; Inter 3.19 has a 16.943-point natural line height.
                .lineSpacing(1.0566566)
                .frame(width: 328, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
                .frame(minHeight: 126, alignment: .topLeading)
        }
        .foregroundStyle(.black)
        .padding(.top, 10)
    }

    private var attendeeDetails: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Who’s Attending")
                .font(DIPReferenceAssets.font("Figtree-Regular", size: 18))
                .foregroundStyle(.black).frame(height: 22)
            HStack(spacing: 10) {
                ForEach(Array(event.attendeeAvatars.enumerated()), id: \.offset) { _, avatar in
                    DIPMedia(avatar)
                        .resizable().frame(width: 40, height: 40)
                        .accessibilityHidden(true)
                }
                Button(action: onAttendees) {
                    Text("+ \(event.attendeeOverflowCount) More")
                        .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity).frame(height: 40)
                        .background(DIPTokens.Color.navigationBackground.swiftUIColor, in: Capsule())
                }
                .buttonStyle(.plain).accessibilityLabel("View attendees")
                .accessibilityIdentifier("event.attendees")
            }
            HStack(spacing: 10) {
                Button {
                    if joined { onChat() } else { onJoin() }
                } label: {
                    secondaryLabel(
                        "Join Activity", asset: "event_HeroiconsOutlineChatBubbleOvalLeft",
                        background: DIPTokens.Color.actionPrimary.swiftUIColor)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(joined ? "Open activity chat" : "Join Activity")
                .accessibilityValue(joined ? "Joined" : "Not joined")
                .accessibilityIdentifier("event.join")
                ShareLink(item: "\(event.title) — \(event.timing)") {
                    secondaryLabel(
                        "Share Link", asset: "event_HeroiconsMiniLink",
                        background: Color(red: 240 / 255, green: 84 / 255, blue: 165 / 255))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Share event")
                .accessibilityIdentifier("event.share")
            }
        }
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

    private func primaryAction() {
        if joined { onChat() } else { onJoin() }
    }
}
