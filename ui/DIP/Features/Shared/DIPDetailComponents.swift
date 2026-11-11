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
    /// When set, the outlined pill becomes the add-to-calendar button (calendar icon left, label right).
    var calendarLabel: String?
    var calendarAdded = false
    var onCalendar: () -> Void = {}

    var body: some View {
        HStack {
            Button(action: onBack) {
                DIPReferenceAssets.image("event_BackButton").resizable()
                    .frame(width: 50, height: 50)
            }
            .buttonStyle(.plain).accessibilityLabel("Back")
            .accessibilityIdentifier("\(identifierPrefix).back")
            Spacer(minLength: 10)
            if let calendarLabel {
                Button(action: onCalendar) {
                    HStack(spacing: 8) {
                        if calendarAdded {
                            Image(systemName: "checkmark").font(.system(size: 15, weight: .bold))
                        } else {
                            DIPReferenceAssets.image("HeroiconsOutlineCalendar").renderingMode(.template)
                                .resizable().frame(width: 22, height: 22)
                        }
                        Text(calendarAdded ? "Added" : calendarLabel)
                            .font(DIPReferenceAssets.font("Inter-Regular", size: 14)).lineLimit(1).fixedSize()
                    }
                    .foregroundStyle(DIPTokens.Color.actionPrimary.swiftUIColor)
                    .padding(.horizontal, 18).frame(height: 50)
                    .overlay(Capsule().strokeBorder(DIPTokens.Color.actionPrimary.swiftUIColor, lineWidth: 2))
                    .contentShape(Capsule())
                }
                .buttonStyle(DIPPressFeedbackStyle())
                .accessibilityLabel(calendarAdded ? "Added to calendar" : "Add to calendar")
                .accessibilityIdentifier("\(identifierPrefix).addToCalendar")
            } else {
                Text(timing)
                    .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                    .foregroundStyle(.black)
                    .padding(.horizontal, widePill ? 28 : 0)
                    .frame(width: widePill ? nil : 164, height: 50)
                    .overlay(Capsule().strokeBorder(DIPTokens.Color.actionPrimary.swiftUIColor, lineWidth: 2))
            }
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
                DIPTagFlowLayout(spacing: 10.435, lineSpacing: 8) {
                    ForEach(tags, id: \.self) { tag in
                        Text(tag)
                            .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                            .foregroundStyle(.black)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 13.043)
                            .frame(minHeight: 30)
                            .background(.white, in: RoundedRectangle(cornerRadius: 15))
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
    /// Shown, with `emptyText` beneath it, when `total` is 0.
    var emptyTitle: String = "Be the first"
    let emptyText: String
    /// When set, the header shows how full the event is ("2 of 15", or "Full"), so capacity needs no row of its own.
    var capacity: Int? = nil
    let identifierPrefix: String
    let onMore: () -> Void

    private var shown: [MediaReference] { Array(avatars.prefix(4)) }
    private var remaining: Int { max(0, total - shown.count) }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(title)
                    .font(DIPReferenceAssets.font("Figtree-Regular", size: 18))
                    .foregroundStyle(.black)
                if let capacity {
                    Spacer(minLength: 8)
                    Text(total >= capacity ? "Full" : "\(total) of \(capacity)")
                        .font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .body))
                        .foregroundStyle(.secondary)
                        .accessibilityLabel(total >= capacity ? "Full, \(capacity) places" : "\(total) of \(capacity) places taken")
                        .accessibilityIdentifier("\(identifierPrefix).capacity")
                }
            }
            .frame(height: 22)
            if total == 0 {
                DIPEmptyState(
                    screen: "\(identifierPrefix)-attendees", title: emptyTitle, message: emptyText)
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
/// When the page already has its own primary Join (the event page's bottom bar), pass `joinInRow: false`:
/// the slot then shows Leave once joined and Directions before, so there is one clear Join action.
struct DIPDetailActionRow: View {
    var showsParticipation = true
    var joinInRow = true
    var directionsURL: URL? = nil
    var directionsTitle = "Directions"
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
            if !joinInRow {
                // Directions sits beside Share, in both joined and unjoined states; Leave lives at the page bottom.
                if showsParticipation, let directionsURL {
                    Link(destination: directionsURL) {
                        label(directionsTitle, systemImage: "mappin.and.ellipse",
                              background: DIPTokens.Color.actionPrimary.swiftUIColor)
                    }
                    .buttonStyle(DIPPressFeedbackStyle())
                    .accessibilityLabel(directionsTitle)
                    .accessibilityIdentifier("\(identifierPrefix).directions")
                }
            } else if showsParticipation {
            Button(action: isParticipating ? onLeave : onJoin) {
                if isParticipating {
                    // Leaving is a plain text button; the icon circle is reserved for the affirmative actions.
                    textLabel(leaveTitle, background: DIPTokens.Color.navigationBackground.swiftUIColor)
                } else {
                    label(joinTitle, asset: "event_HeroiconsOutlineChatBubbleOvalLeft",
                          background: DIPTokens.Color.actionPrimary.swiftUIColor)
                }
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

    private func textLabel(_ title: String, background: Color) -> some View {
        Text(title)
            .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
            .foregroundStyle(.white)
            .lineLimit(1).minimumScaleFactor(0.8)
            .frame(maxWidth: .infinity).frame(height: 40)
            .padding(5).frame(height: 50)
            .background(background, in: Capsule())
            .contentShape(Capsule())
    }

    private func label(_ title: String, asset: String, background: Color) -> some View {
        label(title, background: background) { DIPReferenceAssets.image(asset).resizable() }
    }

    private func label(_ title: String, systemImage: String, background: Color) -> some View {
        label(title, background: background) {
            Image(systemName: systemImage).resizable().scaledToFit().foregroundStyle(DIPTokens.Color.actionPrimary.swiftUIColor)
        }
    }

    private func label<Icon: View>(_ title: String, background: Color, @ViewBuilder icon: () -> Icon) -> some View {
        HStack(spacing: 0) {
            Text(title)
                .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                .foregroundStyle(.white)
                .lineLimit(1).minimumScaleFactor(0.8)
                .frame(maxWidth: .infinity).frame(height: 29)
            icon().frame(width: 20, height: 20)
                .frame(width: 40, height: 40)
                .background(.white, in: Circle())
        }
        .padding(5).frame(height: 50)
        .background(background, in: Capsule())
        .contentShape(Capsule())
    }
}
