#if canImport(SwiftUI)
    import SwiftUI

    public enum DIPEventImage {
        case image(Image)
        case loading, missing, failed
    }

    public struct DIPEventCard: View {
        private let content: DIPEventCardContent
        private let image: DIPEventImage
        private let attendees: [DIPAvatarIdentity]
        private let attendeeImage: (DIPAvatarIdentity) -> Image?
        private let action: () -> Void
        @ScaledMetric(relativeTo: .body) private var imageHeight = 150.0

        public init(
            content: DIPEventCardContent, image: DIPEventImage = .missing, attendees: [DIPAvatarIdentity] = [],
            attendeeImage: @escaping (DIPAvatarIdentity) -> Image? = { _ in nil }, action: @escaping () -> Void
        ) {
            self.content = content
            self.image = image
            self.attendees = attendees
            self.attendeeImage = attendeeImage
            self.action = action
        }
        public var body: some View {
            Button(action: action) {
                VStack(alignment: .leading, spacing: 0) {
                    imageSlot.overlay(alignment: .topLeading) {
                        if content.attendeeCount != nil {
                            DIPAvatarGroup(people: attendees, totalCount: content.attendeeCount, image: attendeeImage)
                                .padding(DIPTokens.Spacing.related)
                        }
                    }
                    VStack(alignment: .leading, spacing: DIPTokens.Spacing.related) {
                        Text(content.displayTitle).font(.title3.weight(.bold)).fixedSize(
                            horizontal: false, vertical: true)
                        Label(content.displayDate, systemImage: "calendar").font(.subheadline.weight(.medium))
                        Label(content.displayLocality, systemImage: "mappin.and.ellipse").font(.subheadline)
                        Label(content.attendanceText, systemImage: "person.2").font(.subheadline)
                        if !content.registrationText.isEmpty {
                            Label(
                                content.registrationText,
                                systemImage: content.registration == .joined ? "checkmark.circle.fill" : "info.circle"
                            )
                            .font(.subheadline.weight(.semibold))
                        }
                    }
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(DIPTokens.Spacing.related)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .foregroundStyle(DIPComponentTheme.ink).background(DIPComponentTheme.surface)
                .clipShape(RoundedRectangle(cornerRadius: DIPTokens.Radius.card))
                .overlay(
                    RoundedRectangle(cornerRadius: DIPTokens.Radius.card).stroke(DIPComponentTheme.muted, lineWidth: 1)
                )
                .contentShape(RoundedRectangle(cornerRadius: DIPTokens.Radius.card))
            }
            .buttonStyle(CardStyle())
            .accessibilityLabel(Text(content.accessibilityLabel))
            .accessibilityValue(Text(content.registrationText))
            .accessibilityHint("Opens event details")
        }
        private var imageSlot: some View {
            GeometryReader { geometry in
                ZStack {
                    DIPComponentTheme.muted
                    switch image {
                    case .image(let image): image.resizable().scaledToFill()
                    case .loading: ProgressView().tint(DIPComponentTheme.ink)
                    case .missing: Image(systemName: "photo").font(.largeTitle).foregroundStyle(DIPComponentTheme.ink)
                    case .failed:
                        Label("Image unavailable", systemImage: "photo.badge.exclamationmark").font(.caption)
                            .foregroundStyle(DIPComponentTheme.ink)
                    }
                }
                .frame(width: geometry.size.width, height: imageHeight).clipped()
            }
            .frame(height: imageHeight).accessibilityHidden(true)
        }
        private struct CardStyle: ButtonStyle {
            func makeBody(configuration: Configuration) -> some View {
                configuration.label.opacity(configuration.isPressed ? 0.8 : 1)
            }
        }
    }
#endif
