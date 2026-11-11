import DIPCore
import DIPDesignSystem
import SwiftUI

/// The designed Profile header: a brand-periwinkle card with soft shapes and the clover motif,
/// holding avatar, name, department and city, the About details (job title, availability,
/// travel radius) and the member's interests. All colours come from design tokens.
struct ProfileHeaderCard: View {
    let profile: DIPProfile
    let catalogReady: Bool
    let onEdit: () -> Void
    let onAddInterests: () -> Void
    @Environment(\.profileBadgeLink) private var badgeLink

    private var ink: Color { DIPTokens.Color.textPrimary.swiftUIColor }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top) {
                photo(size: 88)
                    .overlay(alignment: .topTrailing) {
                        // The app-assigned avatar (not the Google photo). The shell flies the same avatar
                        // between the header capsule and this badge; it is hidden during the flight.
                        DIPMedia(profile.avatar)
                            .frame(width: ProfileBadgeLink.badgeSize, height: ProfileBadgeLink.badgeSize)
                            .clipShape(Circle())
                            .overlay(Circle().strokeBorder(.white, lineWidth: 3))
                            // Measured on the badge itself (inside the offset below), so the frame already
                            // includes the nudge and is where the badge is actually drawn.
                            .onGeometryChange(for: CGRect.self) { $0.frame(in: .named(ProfileBadgeLink.pageSpace)) } action: {
                                badgeLink.report($0)
                            }
                            .offset(x: ProfileBadgeLink.badgeNudge.width, y: ProfileBadgeLink.badgeNudge.height)
                            .opacity(badgeLink.isHidden ? 0 : 1)
                            .accessibilityLabel("Assigned avatar")
                            .accessibilityIdentifier("profile.avatar.badge")
                    }
                Spacer(minLength: 12)
                editButton
            }
            identity
            if profile.hasAccountDetails { about }
            interests
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background { ProfileHeaderBackdrop() }
        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
        .accessibilityElement(children: .contain)
    }

    // MARK: Identity

    private var identity: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(profile.displayName.uppercased())
                .font(DIPReferenceAssets.font("FjallaOne-Regular", size: 38, relativeTo: .largeTitle))
                .foregroundStyle(DIPTokens.Color.headerTitle.swiftUIColor)
                .lineLimit(2).minimumScaleFactor(0.6)
                .accessibilityIdentifier("profile.name")
            if !subtitle.isEmpty {
                Text(subtitle)
                    .font(DIPReferenceAssets.font("Inter-Regular", size: 15))
                    .foregroundStyle(ink)
            }
        }
    }

    private var subtitle: String {
        [profile.department, profile.city].filter { !$0.isEmpty }.joined(separator: "  ·  ")
    }

    private func photo(size: CGFloat) -> some View {
        Group {
            if profile.photo == .asset("profile_Image") {
                DIPMedia(profile.photo).resizable()
                    .frame(width: size * 1.5096, height: size * 1.0138)
                    .offset(x: -size * 0.4574, y: -size * 0.0087)
                    .frame(width: size, height: size, alignment: .topLeading)
            } else {
                DIPMedia(profile.photo).resizable().scaledToFill()
                    .frame(width: size, height: size).clipped()
            }
        }
        .clipShape(Circle())
        .overlay(Circle().strokeBorder(.white, lineWidth: 3))
        .accessibilityLabel("\(profile.displayName)'s profile photo")
    }

    private var editButton: some View {
        Button(action: onEdit) {
            Label("Edit", systemImage: "pencil")
                .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                .foregroundStyle(ink)
                .padding(.horizontal, 16).frame(minHeight: 40)
                .background(.white, in: Capsule())
        }
        .buttonStyle(DIPPressFeedbackStyle())
        .accessibilityLabel("Edit profile")
        .accessibilityIdentifier("profile.edit")
    }

    // MARK: About

    private var about: some View {
        let free = DIPProfileScreen.availabilityLabels(profile.availability)
        return VStack(alignment: .leading, spacing: 14) {
            row("briefcase", profile.jobTitle.isEmpty ? nil : profile.jobTitle,
                placeholder: "Add your job title", id: "jobTitle")
            row("calendar", free.isEmpty ? nil : free.joined(separator: ", "),
                placeholder: "Add when you're free", id: "availability")
            row("figure.walk", profile.travelRadiusMiles.map { DIPProfileScreen.radiusPhrase($0) },
                placeholder: "Add how far you'll travel", id: "radius")
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.white, in: RoundedRectangle(cornerRadius: DIPTokens.Radius.card, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("profile.details")
    }

    /// Icon plus the value itself; no caption that only names the field. An unset value is
    /// an action (opens Edit): dimmer text with an accent plus button, so it reads as tappable.
    @ViewBuilder private func row(_ icon: String, _ value: String?, placeholder: String, id: String) -> some View {
        if let value {
            rowContent(icon, value, isPlaceholder: false, id: id)
        } else {
            Button(action: onEdit) { rowContent(icon, placeholder, isPlaceholder: true, id: id) }
                .buttonStyle(DIPPressFeedbackStyle())
        }
    }

    private func rowContent(_ icon: String, _ text: String, isPlaceholder: Bool, id: String) -> some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(ink)
                .frame(width: 32, height: 32)
                .background(DIPTokens.Color.actionPrimary.swiftUIColor.opacity(0.18), in: Circle())
                .accessibilityHidden(true)
            Text(text)
                .font(DIPReferenceAssets.font("Inter-Regular", size: 15, relativeTo: .body))
                .foregroundStyle(isPlaceholder ? ink.opacity(0.7) : ink)
                .fixedSize(horizontal: false, vertical: true)
            if isPlaceholder {
                Spacer(minLength: 8)
                Image(systemName: "plus")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(ink)
                    .frame(width: 26, height: 26)
                    .background(DIPTokens.Color.actionPrimary.swiftUIColor, in: Circle())
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("profile.details.\(id)")
    }

    // MARK: Interests

    private var interests: some View {
        let selected = DIPProfileScreen.headerInterests(profile, catalogReady: catalogReady)
        return VStack(alignment: .leading, spacing: 10) {
            ProfileFlowLayout(spacing: 8) {
                ForEach(selected) { interest in
                    Text(interest.name)
                        .font(DIPReferenceAssets.font("Inter-Regular", size: 13))
                        .foregroundStyle(ink)
                        .padding(.horizontal, 14).frame(height: 32)
                        .background(.white, in: Capsule())
                }
                Button(action: onAddInterests) {
                    Label(profile.interestTagIDs.isEmpty ? "Add interests" : "Add", systemImage: "plus")
                        .font(DIPReferenceAssets.font("Inter-Regular", size: 13))
                        .foregroundStyle(DIPTokens.Color.textInverse.swiftUIColor)
                        .padding(.horizontal, 14).frame(height: 32)
                        .background(DIPTokens.Color.navigationBackground.swiftUIColor, in: Capsule())
                }
                .buttonStyle(DIPPressFeedbackStyle())
                .disabled(!catalogReady)
                .opacity(catalogReady ? 1 : 0.6)
                .accessibilityIdentifier("profile.interests.add")
            }
        }
    }
}

/// Flat, non-photographic backdrop: brand periwinkle with solid, opaque tints (no transparency, so
/// no blended overlap regions). One large lighter disc sits top right; the clover echoing the logo is a
/// single path of unioned circles in one flat fill. Decorative only.
struct ProfileHeaderBackdrop: View {
    private static func tint(_ amount: Double, toward target: Double) -> Color {
        let base = DIPTokens.Color.actionPrimary
        func mix(_ value: Double) -> Double { value + (target - value) * amount }
        return Color(.sRGB, red: mix(base.red), green: mix(base.green), blue: mix(base.blue), opacity: 1)
    }
    private let lighter = tint(0.12, toward: 1)
    private let lightest = tint(0.26, toward: 1)

    var body: some View {
        ZStack(alignment: .topTrailing) {
            DIPTokens.Color.actionPrimary.swiftUIColor
            Circle().fill(lighter).frame(width: 260, height: 260).offset(x: 90, y: -110)
            clover.fill(lightest).frame(width: 96, height: 96).offset(x: -36, y: 84)
        }
        .accessibilityHidden(true)
    }

    /// Four petals as one path: filled once, so overlaps are a single flat silhouette.
    private var clover: Path {
        Path { path in
            let size: CGFloat = 96, petal: CGFloat = 36, center = size / 2
            let reach: CGFloat = 25
            for index in 0..<4 {
                let angle = Double(index) * .pi / 2 + .pi / 4
                let x = center + CGFloat(cos(angle)) * reach, y = center + CGFloat(sin(angle)) * reach
                path.addEllipse(in: CGRect(x: x - petal / 2, y: y - petal / 2, width: petal, height: petal))
            }
            path.addEllipse(in: CGRect(x: center - 13, y: center - 13, width: 26, height: 26))
        }
    }
}

/// Left-aligned wrapping row layout for pills.
struct ProfileFlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        arrange(width: proposal.width ?? .infinity, subviews: subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrange(width: bounds.width, subviews: subviews)
        for (index, origin) in result.origins.enumerated() {
            subviews[index].place(
                at: CGPoint(x: bounds.minX + origin.x, y: bounds.minY + origin.y), proposal: .unspecified)
        }
    }

    private func arrange(width: CGFloat, subviews: Subviews) -> (origins: [CGPoint], size: CGSize) {
        var origins: [CGPoint] = []
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, maxX: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width { x = 0; y += rowHeight + spacing; rowHeight = 0 }
            origins.append(CGPoint(x: x, y: y))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
            maxX = max(maxX, x - spacing)
        }
        return (origins, CGSize(width: maxX, height: y + rowHeight))
    }
}
