import DIPCore
import DIPDesignSystem
import SwiftUI

/// Pieces shared by the event page (Figma 46:1397) and the challenge page (160:6357),
/// which use the same header, hero, people row and Join / Share row.
struct DIPDetailHeader: View {
    let timing: String
    var widePill = false
    let identifierPrefix: String
    let onBack: () -> Void

    var body: some View {
        HStack {
            Button(action: onBack) {
                DIPReferenceAssets.image("event_BackButton").resizable()
                    .frame(width: 50, height: 50)
            }
            .buttonStyle(.plain).accessibilityLabel("Back")
            .accessibilityIdentifier("\(identifierPrefix).back")
            Spacer(minLength: 10)
            Text(timing)
                .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                .foregroundStyle(.black)
                .padding(.horizontal, widePill ? 28 : 0)
                .frame(width: widePill ? nil : 164, height: 50)
                .overlay(Capsule().strokeBorder(DIPTokens.Color.actionPrimary.swiftUIColor, lineWidth: 2))
        }
        .padding(.horizontal, 20).padding(.top, 60).padding(.bottom, 10)
    }
}

struct DIPDetailHero: View {
    let image: MediaReference
    let tags: [String]
    let identifierPrefix: String
    /// Illustrated artwork sits on a flat color and is fitted, not cropped.
    var artworkBackground: Color?

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .bottomTrailing) {
                if let artworkBackground {
                    artworkBackground
                    DIPMedia(image).resizable().scaledToFit()
                        .frame(width: geometry.size.width, height: 264 - 40)
                } else {
                    DIPMedia(image).resizable().scaledToFill()
                        .frame(width: geometry.size.width, height: 264).clipped()
                }
                HStack(spacing: 10.435) {
                    ForEach(tags, id: \.self) { tag in
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
            .frame(width: geometry.size.width, height: 264)
            .clipShape(RoundedRectangle(cornerRadius: 20))
        }
        .frame(height: 264)
        .accessibilityIdentifier("\(identifierPrefix).hero")
    }
}

/// "Who's Attending" / "People that completed": four avatars and a dark "+ N More" pill.
struct DIPDetailPeopleRow: View {
    let title: String
    let avatars: [MediaReference]
    let total: Int
    let emptyText: String
    let identifierPrefix: String
    let onMore: () -> Void

    private var shown: [MediaReference] { Array(avatars.prefix(4)) }
    private var remaining: Int { max(0, total - shown.count) }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(DIPReferenceAssets.font("Figtree-Regular", size: 18))
                .foregroundStyle(.black).frame(height: 22)
            if total == 0 {
                Text(emptyText)
                    .font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .body))
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("\(identifierPrefix).attendees.empty")
            } else {
                HStack(spacing: 10) {
                    ForEach(Array(shown.enumerated()), id: \.offset) { _, avatar in
                        DIPMedia(avatar).resizable().frame(width: 40, height: 40)
                            .accessibilityHidden(true)
                    }
                    Button(action: onMore) {
                        Text(remaining > 0 ? "+ \(remaining) More" : "See all")
                            .font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .body))
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity, minHeight: 40)
                            .background(DIPTokens.Color.navigationBackground.swiftUIColor, in: Capsule())
                            .contentShape(Capsule())
                    }
                    .buttonStyle(DIPPressFeedbackStyle())
                    .accessibilityLabel("View all \(total)")
                    .accessibilityIdentifier("\(identifierPrefix).attendees")
                }
            }
        }
    }
}

/// Join (or Leave) beside Share, as in the design. Joining and leaving use the same slot.
struct DIPDetailActionRow: View {
    var showsParticipation = true
    let isParticipating: Bool
    let canChange: Bool
    let joinTitle: String
    let leaveTitle: String
    let shareItem: String
    let shareTitle: String
    let identifierPrefix: String
    let onJoin: () -> Void
    let onLeave: () -> Void

    private let shareColor = Color(red: 240 / 255, green: 84 / 255, blue: 165 / 255)

    var body: some View {
        HStack(spacing: 10) {
            if showsParticipation {
            Button(action: isParticipating ? onLeave : onJoin) {
                label(isParticipating ? leaveTitle : joinTitle,
                      asset: "event_HeroiconsOutlineChatBubbleOvalLeft",
                      background: isParticipating
                          ? DIPTokens.Color.navigationBackground.swiftUIColor
                          : DIPTokens.Color.actionPrimary.swiftUIColor)
            }
            .buttonStyle(DIPPressFeedbackStyle())
            .disabled(!canChange)
            .opacity(canChange ? 1 : 0.5)
            .accessibilityIdentifier(isParticipating ? "\(identifierPrefix).leave" : "\(identifierPrefix).join")
            }
            ShareLink(item: shareItem) {
                label(shareTitle, asset: "event_HeroiconsMiniLink", background: shareColor)
            }
            .buttonStyle(DIPPressFeedbackStyle())
            .accessibilityLabel(shareTitle)
            .accessibilityIdentifier("\(identifierPrefix).share")
        }
    }

    private func label(_ title: String, asset: String, background: Color) -> some View {
        HStack(spacing: 0) {
            Text(title)
                .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                .foregroundStyle(.white)
                .lineLimit(1).minimumScaleFactor(0.8)
                .frame(maxWidth: .infinity).frame(height: 29)
            DIPReferenceAssets.image(asset).resizable().frame(width: 20, height: 20)
                .frame(width: 40, height: 40)
                .background(.white, in: Circle())
        }
        .padding(5).frame(height: 50)
        .background(background, in: Capsule())
        .contentShape(Capsule())
    }
}
