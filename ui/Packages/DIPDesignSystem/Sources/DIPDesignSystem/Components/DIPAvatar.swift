#if canImport(SwiftUI)
    import SwiftUI

    /// The feature supplies an already-loaded Image; this component never performs network requests.
    public struct DIPAvatar: View {
        private let person: DIPAvatarIdentity
        private let image: Image?
        private let size: CGFloat
        private let isDecorative: Bool
        public init(person: DIPAvatarIdentity, image: Image? = nil, size: CGFloat = 40, isDecorative: Bool = false) {
            self.person = person
            self.image = image
            self.size = max(16, size)
            self.isDecorative = isDecorative
        }
        public var body: some View {
            ZStack {
                Circle().fill(DIPComponentTheme.muted)
                if let image {
                    image.resizable().scaledToFill()
                } else if person.initials.isEmpty {
                    Image(systemName: "person.fill").font(.system(size: size * 0.45)).foregroundStyle(
                        DIPComponentTheme.ink)
                } else {
                    Text(person.initials).font(.system(size: size * 0.35, weight: .semibold)).foregroundStyle(
                        DIPComponentTheme.ink)
                }
            }
            .frame(width: size, height: size).clipShape(Circle())
            .accessibilityElement(children: .ignore).accessibilityLabel(Text(person.displayName))
            .accessibilityHidden(isDecorative)
        }
    }

    public struct DIPAvatarGroup: View {
        private let summary: DIPAvatarGroupSummary
        private let image: (DIPAvatarIdentity) -> Image?
        public init(
            people: [DIPAvatarIdentity], totalCount: Int? = nil, maximumVisible: Int = 3,
            image: @escaping (DIPAvatarIdentity) -> Image? = { _ in nil }
        ) {
            self.summary = DIPAvatarGroupSummary(people: people, totalCount: totalCount, maximumVisible: maximumVisible)
            self.image = image
        }
        public var body: some View {
            HStack(spacing: -DIPTokens.Spacing.compact) {
                ForEach(summary.visiblePeople) { person in
                    DIPAvatar(person: person, image: image(person), size: 28, isDecorative: true)
                        .overlay(Circle().stroke(DIPComponentTheme.surface, lineWidth: 2))
                }
                if summary.overflowCount > 0 {
                    Text("+\(summary.overflowCount)").font(.caption.weight(.semibold))
                        .padding(.horizontal, DIPTokens.Spacing.related)
                        .frame(minHeight: 28).background(DIPComponentTheme.surface, in: Capsule())
                        .foregroundStyle(DIPComponentTheme.ink)
                }
                if summary.totalCount == 0 { Text("No attendees yet").font(.caption) }
            }
            .accessibilityElement(children: .ignore).accessibilityLabel(Text(summary.accessibilityLabel))
        }
    }
#endif
