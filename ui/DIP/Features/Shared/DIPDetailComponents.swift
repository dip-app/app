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
    /// When set (and `calendarState` is not `.hidden`), the outlined pill becomes the stateful add-to-calendar pill
    /// (icon left, label right). `.hidden` keeps the informational pill.
    var calendarLabel: String?
    var calendarState: DIPCalendarPillState = .hidden
    var onCalendar: () -> Void = {}
    /// Keeps the calendar glyph on the informational (outlined) pill so the header does not jump between states.
    var showsCalendarIcon = false
    /// Duo: the 60 pt status-bar allowance shrinks (status is in the sensor column); open Duo detail root has no Back.
    @Environment(\.dipTopInset) private var topInset
    @Environment(\.dipDuoHidesBack) private var hidesBack
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        // Back and the date pill share a row normally; at accessibility sizes the pill sits under Back so a
        // large date label cannot push the row past the screen edge.
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 10)) : AnyLayout(HStackLayout())
        layout {
            if !hidesBack {
                Button(action: onBack) {
                    DIPReferenceAssets.image("event_BackButton").resizable()
                        .frame(width: 50, height: 50)
                }
                .buttonStyle(.plain).accessibilityLabel("Back")
                .accessibilityIdentifier("\(identifierPrefix).back")
            }
            if dynamicTypeSize.isAccessibilitySize { EmptyView() } else { Spacer(minLength: 10) }
            if let calendarLabel, calendarState != .hidden {
                Button(action: onCalendar) {
                    DIPCalendarPill(state: calendarState, label: calendarLabel)
                }
                .buttonStyle(DIPPressFeedbackStyle())
                .disabled(!calendarState.isEnabled)
                // The visible date first, then the action; the hint says whether it saves directly or opens the editor.
                .accessibilityLabel(calendarState.accessibilityLabel(date: calendarLabel))
                .accessibilityHint(calendarState.accessibilityHint)
                .accessibilityIdentifier("\(identifierPrefix).addToCalendar")
            } else {
                HStack(spacing: 8) {
                    if showsCalendarIcon {
                        DIPReferenceAssets.image("HeroiconsOutlineCalendar").renderingMode(.template)
                            .resizable().frame(width: 22, height: 22)
                            .foregroundStyle(DIPTokens.Color.actionPrimary.swiftUIColor).accessibilityHidden(true)
                    }
                    Text(timing)
                        .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                        .foregroundStyle(.black)
                        .multilineTextAlignment(.center)
                }
                .padding(.horizontal, widePill ? 28 : 0)
                .dipFixedFrame(width: widePill ? nil : 164, height: 50)
                .overlay(Capsule().strokeBorder(DIPTokens.Color.actionPrimary.swiftUIColor, lineWidth: 2))
            }
        }
        .padding(.horizontal, 20).padding(.top, topInset).padding(.bottom, 10)
    }
}

/// The date pill in each calendar state. Solid fill = pressable, outline = informational; the icon and label change
/// with the state so color is never the only signal.
struct DIPCalendarPill: View {
    let state: DIPCalendarPillState
    let label: String
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        HStack(spacing: 8) {
            icon
            Text(state == .added ? String(localized: "calendar.pill.added", defaultValue: "Added", comment: "Date pill label once the activity is in the calendar") : label)
                .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                .lineLimit(dynamicTypeSize.isAccessibilitySize ? 2 : 1)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: !dynamicTypeSize.isAccessibilitySize, vertical: true)
        }
        .foregroundStyle(foreground)
        .padding(.horizontal, 18).dipFixedFrame(height: 50)
        .background(fill, in: Capsule())
        .overlay { if state == .added { Capsule().strokeBorder(DIPTokens.Color.actionPrimary.swiftUIColor, lineWidth: 2) } }
        .contentShape(Capsule())
    }

    @ViewBuilder private var icon: some View {
        switch state {
        case .conflict:
            Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 18, weight: .semibold))
                .frame(width: 22, height: 22).accessibilityHidden(true)
        case .busy:
            Image(systemName: "calendar.badge.clock").font(.system(size: 18, weight: .regular))
                .frame(width: 22, height: 22).accessibilityHidden(true)
        case .free(direct: true):
            Image(systemName: "calendar.badge.plus").font(.system(size: 18, weight: .regular))
                .frame(width: 22, height: 22).accessibilityHidden(true)
        case .adding:
            ProgressView().tint(.white).frame(width: 22, height: 22).accessibilityHidden(true)
        case .added:
            Image(systemName: "checkmark").font(.system(size: 15, weight: .bold))
                .frame(width: 22, height: 22).accessibilityHidden(true)
        case .free, .hidden:
            DIPReferenceAssets.image("HeroiconsOutlineCalendar").renderingMode(.template)
                .resizable().frame(width: 22, height: 22).accessibilityHidden(true)
        }
    }

    private var foreground: Color {
        switch state {
        case .conflict: DIPTokens.Color.textOnCalendarConflict.swiftUIColor
        case .busy: DIPTokens.Color.textOnCalendarBusy.swiftUIColor
        case .added: DIPTokens.Color.textPrimary.swiftUIColor
        default: .white
        }
    }

    private var fill: Color {
        switch state {
        case .conflict: DIPTokens.Color.calendarConflict.swiftUIColor
        case .busy: DIPTokens.Color.calendarBusy.swiftUIColor
        case .added: .white
        case .free, .adding: DIPTokens.Color.calendarFree.swiftUIColor
        case .hidden: .clear
        }
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
    var emptyTitle: String = String(localized: "detail.people.beTheFirst", defaultValue: "Be the first", comment: "Default empty-state title above the attendee list when nobody has joined")
    let emptyText: String
    /// When set, the header shows how full the event is ("2 of 15", or "Full"), so capacity needs no row of its own.
    var capacity: Int? = nil
    /// Right-hand note when there is no capacity ("12 went", "Cancelled").
    var trailingNote: String? = nil
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
                    .accessibilityAddTraits(.isHeader)
                if capacity == nil, let trailingNote {
                    Spacer(minLength: 8)
                    Text(trailingNote)
                        .font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .body))
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("\(identifierPrefix).attendeeNote")
                }
                if let capacity {
                    Spacer(minLength: 8)
                    Text(total >= capacity ? String(localized: "detail.capacity.full", defaultValue: "Full", comment: "Header note on the attendee row when the activity has no spots left") : String(localized: "detail.capacity.count", defaultValue: "\(total) of \(capacity)", comment: "Header note on the attendee row; first %lld = people going, second %lld = capacity"))
                        .font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .body))
                        .foregroundStyle(.secondary)
                        .accessibilityLabel(total >= capacity ? String(localized: "detail.capacity.full.accessibility", defaultValue: "Full, \(capacity) places", comment: "VoiceOver label of the capacity note when full; %lld = capacity") : String(localized: "detail.capacity.count.accessibility", defaultValue: "\(total) of \(capacity) places taken", comment: "VoiceOver label of the capacity note; first %lld = people going, second %lld = capacity"))
                        .accessibilityIdentifier("\(identifierPrefix).capacity")
                }
            }
            .dipFixedFrame(height: 22)
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
                        Text(remaining > 0 ? String(localized: "detail.people.more", defaultValue: "+ \(remaining) More", comment: "Pill under the attendee avatars; %lld = how many more attendees are not shown") : String(localized: "detail.people.seeAll", defaultValue: "See all", comment: "Pill under the attendee avatars when every attendee is shown"))
                            .font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .body))
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity, minHeight: 40)
                            .background(DIPTokens.Color.navigationBackground.swiftUIColor, in: Capsule())
                            .contentShape(Capsule())
                            // 40 pt pill, 44 pt hit area.
                            .dipHitSlop(vertical: 2)
                    }
                    .buttonStyle(DIPPressFeedbackStyle())
                    .accessibilityLabel(String(localized: "detail.people.viewAll.accessibility", defaultValue: "View all \(total) attendees", comment: "VoiceOver label of the attendee pill; %lld = number of attendees"))
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
    /// The coworker invite pill. When it is offered it takes the first slot of the pair; otherwise the slot falls back to
    /// Directions, so the page always shows exactly two pills (never a lone pill, never a disabled-looking Invite).
    struct InviteAction {
        /// Spoken label, e.g. "Invite a coworker to Puppy Yoga".
        var accessibilityLabel = String(localized: "detail.invite.accessibility", defaultValue: "Invite a coworker", comment: "Default VoiceOver label of the invite pill")
        let action: () -> Void
    }

    var invite: InviteAction? = nil
    var showsParticipation = true
    var joinInRow = true
    var directionsURL: URL? = nil
    var directionsTitle = String(localized: "detail.directions", defaultValue: "Directions", comment: "Pill that opens map directions to the activity")
    let isParticipating: Bool
    let canChange: Bool
    let joinTitle: String
    let leaveTitle: String
    let shareItem: String
    /// Public link to the page (`DIPShareLink`). When set it is the shared item (rich link preview) and `shareItem` is the message above it.
    var shareLink: URL? = nil
    let shareTitle: String
    let identifierPrefix: String
    let onJoin: () -> Void
    let onLeave: () -> Void

    private let shareColor = Color(red: 240 / 255, green: 84 / 255, blue: 165 / 255)

    var body: some View {
        HStack(spacing: 10) {
            if !joinInRow {
                if showsParticipation, let invite {
                    Button(action: invite.action) {
                        label(String(localized: "detail.invite.title", defaultValue: "Invite Others", comment: "Pill that opens the coworker picker to invite someone to the activity"), background: DIPTokens.Color.actionPrimary.swiftUIColor) {
                            Image(systemName: "person.badge.plus").resizable().scaledToFit()
                                .foregroundStyle(DIPTokens.Color.actionPrimary.swiftUIColor)
                        }
                    }
                    .buttonStyle(DIPPressFeedbackStyle())
                    .transition(.opacity)
                    .accessibilityLabel(invite.accessibilityLabel)
                    .accessibilityHint("Choose a coworker from your company to invite")
                    .accessibilityIdentifier("\(identifierPrefix).invite")
                } else if showsParticipation, let directionsURL {
                // Directions (when a page still passes one) sits beside Share; Leave lives at the page bottom.
                    Link(destination: directionsURL) {
                        label(directionsTitle, systemImage: "mappin.and.ellipse",
                              background: DIPTokens.Color.actionPrimary.swiftUIColor)
                    }
                    .buttonStyle(DIPPressFeedbackStyle())
                    .transition(.opacity)
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
            if let shareLink {
                ShareLink(item: shareLink, message: Text(shareItem)) {
                    label(shareTitle, asset: "event_HeroiconsMiniLink", background: shareColor)
                }
                .buttonStyle(DIPPressFeedbackStyle())
                .accessibilityLabel(shareTitle)
                .accessibilityIdentifier("\(identifierPrefix).share")
            } else {
            ShareLink(item: shareItem) {
                label(shareTitle, asset: "event_HeroiconsMiniLink", background: shareColor)
            }
            .buttonStyle(DIPPressFeedbackStyle())
            .accessibilityLabel(shareTitle)
            .accessibilityIdentifier("\(identifierPrefix).share")
            }
        }
        // Both first-slot pills have the same size, so a swap (e.g. the event fills up) cross-fades without moving anything.
        .animation(.easeInOut(duration: 0.2), value: invite != nil)
        .onChange(of: invite != nil) { _, available in
            // The first pill swaps in place; tell VoiceOver users, who cannot see the cross-fade.
            AccessibilityNotification.Announcement(available
                ? String(localized: "detail.invite.announce.available", defaultValue: "Invite Others is available", comment: "VoiceOver announcement when the invite pill appears")
                : String(localized: "detail.invite.announce.unavailable", defaultValue: "Invite Others is no longer available. Directions is shown instead.", comment: "VoiceOver announcement when the invite pill is replaced by Directions")).post()
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

    private func label<Icon: View>(_ title: String, background: Color, @ViewBuilder icon: @escaping () -> Icon) -> some View {
        DIPActionPill(title: title, color: background, style: .solid, whiteLabel: background == shareColor, icon: icon)
    }
}
