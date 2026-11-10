#if canImport(SwiftUI)
    import SwiftUI
#endif

/// Values behind a designed empty state: a one-line title, at most one line of body copy and an
/// optional single action. Identifiers follow `empty.<screen>` so UI tests and analytics can find
/// every empty state the same way. This type has no SwiftUI dependency and is unit tested.
public struct DIPEmptyStateContent: Equatable, Sendable {
    public let screen: String
    public let title: String
    public let message: String?
    public let actionTitle: String?

    public init(screen: String, title: String, message: String? = nil, actionTitle: String? = nil) {
        self.screen = Self.slug(screen)
        self.title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let body = message?.trimmingCharacters(in: .whitespacesAndNewlines)
        self.message = body?.isEmpty == false ? body : nil
        let action = actionTitle?.trimmingCharacters(in: .whitespacesAndNewlines)
        self.actionTitle = action?.isEmpty == false ? action : nil
    }

    /// `empty.<screen>`, e.g. `empty.home-recents`.
    public var identifier: String { "empty.\(screen)" }
    /// The action button's identifier, `empty.<screen>.action`.
    public var actionIdentifier: String { "\(identifier).action" }
    /// Title and body read as one VoiceOver element.
    public var accessibilityLabel: String {
        [title, message].compactMap { $0 }.map { text in
            text.last.map { ".!?".contains($0) } == true ? text : text + "."
        }.joined(separator: " ")
    }

    /// Lowercase, hyphen-separated screen key; anything else collapses to a single hyphen.
    static func slug(_ value: String) -> String {
        let lowered = value.lowercased()
        var result = ""
        for scalar in lowered.unicodeScalars {
            if CharacterSet.alphanumerics.contains(scalar) && scalar.isASCII {
                result.unicodeScalars.append(scalar)
            } else if !result.isEmpty && !result.hasSuffix("-") {
                result.append("-")
            }
        }
        while result.hasSuffix("-") { result.removeLast() }
        return result.isEmpty ? "screen" : result
    }
}

#if canImport(SwiftUI)
    /// A designed, reusable empty state: a small Crew-face illustration, a one-line title, one line
    /// of body copy and an optional single action.
    ///
    /// - `.card` sits in its own rounded, tinted surface (Home sections, full-page empties).
    /// - `.compact` is a borderless row for an empty slot inside a populated page (Who's Attending).
    ///
    /// Accessibility: the illustration is decorative; title and body are one VoiceOver element; the
    /// optional action is a separate button directly after it. The only motion is a single short
    /// entrance (fade and slight scale of the faces) that is skipped under Reduce Motion; nothing loops.
    public struct DIPEmptyState: View {
        public enum Style: Sendable { case card, compact }

        private let content: DIPEmptyStateContent
        private let style: Style
        private let faces: Int
        private let action: (() -> Void)?

        @Environment(\.accessibilityReduceMotion) private var reduceMotion
        @Environment(\.dynamicTypeSize) private var dynamicTypeSize
        @State private var appeared = false

        /// - Parameters:
        ///   - screen: key used for the `empty.<screen>` identifier.
        ///   - faces: how many Crew faces to draw (0 hides the illustration, max 4).
        ///   - actionTitle/action: shown only when both are supplied.
        public init(
            screen: String, title: String, message: String? = nil, style: Style = .card, faces: Int = 3,
            actionTitle: String? = nil, action: (() -> Void)? = nil
        ) {
            let content = DIPEmptyStateContent(
                screen: screen, title: title, message: message, actionTitle: action == nil ? nil : actionTitle)
            self.content = content
            self.style = style
            self.faces = max(0, min(4, faces))
            self.action = content.actionTitle == nil ? nil : action
        }

        public var body: some View {
            Group {
                switch style {
                case .card: card
                case .compact: compact
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier(content.identifier)
            .onAppear {
                guard !appeared else { return }
                if reduceMotion { appeared = true } else {
                    withAnimation(.easeOut(duration: DIPMotion.navigationDuration)) { appeared = true }
                }
            }
        }

        private var card: some View {
            VStack(spacing: 12) {
                illustration(size: 40)
                text(alignment: .center)
                actionButton
            }
            .padding(.horizontal, 20).padding(.vertical, 18)
            .frame(maxWidth: .infinity)
            .background(
                DIPTokens.Color.actionPrimary.swiftUIColor.opacity(0.08),
                in: RoundedRectangle(cornerRadius: DIPTokens.Radius.card, style: .continuous))
        }

        @ViewBuilder private var compact: some View {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 10) {
                    illustration(size: 34)
                    text(alignment: .leading)
                    actionButton
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                HStack(alignment: .center, spacing: 14) {
                    illustration(size: 34)
                    VStack(alignment: .leading, spacing: 8) {
                        text(alignment: .leading)
                        actionButton
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }

        @ViewBuilder private func illustration(size: CGFloat) -> some View {
            if faces > 0 {
                DIPCrewFaces(count: faces, size: size)
                    .opacity(appeared ? 1 : 0)
                    .scaleEffect(appeared || reduceMotion ? 1 : 0.92)
            }
        }

        private func text(alignment: TextAlignment) -> some View {
            VStack(alignment: alignment == .center ? .center : .leading, spacing: 4) {
                Text(content.title)
                    .font(DIPReferenceAssets.font("Figtree-Bold", size: 17, relativeTo: .headline))
                    .foregroundStyle(DIPComponentTheme.ink)
                if let message = content.message {
                    Text(message)
                        .font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .subheadline))
                        .foregroundStyle(DIPComponentTheme.ink.opacity(0.72))
                }
            }
            .multilineTextAlignment(alignment)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(content.accessibilityLabel)
            .accessibilityAddTraits(.isStaticText)
            .accessibilityIdentifier("\(content.identifier).message")
        }

        @ViewBuilder private var actionButton: some View {
            if let title = content.actionTitle, let action {
                Button(action: action) {
                    Text(title)
                        .font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .body))
                        .foregroundStyle(DIPComponentTheme.inverse)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 20).padding(.vertical, 10)
                        .frame(minHeight: DIPTokens.Spacing.minimumTouchTarget)
                        .background(DIPTokens.Color.navigationBackground.swiftUIColor, in: Capsule())
                        .contentShape(Capsule())
                }
                .buttonStyle(DIPPressFeedbackStyle())
                .accessibilityIdentifier(content.actionIdentifier)
            }
        }
    }

    /// Overlapping Crew faces drawn from token colours only (no bundled artwork), in the same style as
    /// the onboarding characters: a coloured figure with a simple face on a dark disc. Decorative.
    public struct DIPCrewFaces: View {
        private let count: Int
        private let size: CGFloat
        @ScaledMetric(relativeTo: .headline) private var scale: CGFloat = 1

        public init(count: Int = 3, size: CGFloat = 40) {
            self.count = max(1, min(DIPCrewFace.crew.count, count))
            self.size = size
        }

        public var body: some View {
            let faceSize = size * min(scale, 1.6)
            HStack(spacing: -faceSize * 0.22) {
                ForEach(0..<count, id: \.self) { index in
                    DIPCrewFace.crew[index].frame(width: faceSize, height: faceSize)
                        .overlay(Circle().strokeBorder(DIPComponentTheme.surface, lineWidth: max(1.5, faceSize * 0.05)))
                        .zIndex(Double(count - index))
                }
            }
            .accessibilityHidden(true)
        }
    }

    /// One Crew character.
    public struct DIPCrewFace: View, Sendable {
        public enum Mood: Sendable { case happy, calm, wink }
        public enum Figure: Sendable { case round, square, pill }

        let fill: Color
        let figure: Figure
        let mood: Mood

        public init(fill: Color, figure: Figure = .round, mood: Mood = .happy) {
            self.fill = fill
            self.figure = figure
            self.mood = mood
        }

        /// The default cast, in display order.
        public static let crew: [DIPCrewFace] = [
            .init(fill: DIPTokens.Color.actionPrimary.swiftUIColor, figure: .round, mood: .happy),
            .init(fill: DIPTokens.Color.notificationAccent.swiftUIColor, figure: .square, mood: .wink),
            .init(fill: DIPTokens.Color.eventsAccent.swiftUIColor, figure: .pill, mood: .happy),
            .init(fill: DIPTokens.Color.surfaceMuted.swiftUIColor, figure: .round, mood: .calm),
        ]

        public var body: some View {
            GeometryReader { geometry in
                let size = min(geometry.size.width, geometry.size.height)
                ZStack {
                    Circle().fill(DIPComponentTheme.ink)
                    ZStack {
                        shape.fill(fill)
                        CrewFeatures(mood: mood)
                            .stroke(DIPComponentTheme.ink, style: StrokeStyle(
                                lineWidth: max(1.2, size * 0.045), lineCap: .round, lineJoin: .round))
                            .padding(size * 0.14)
                            .offset(y: -size * 0.04)
                    }
                    .frame(width: size * 0.82, height: size * 0.82)
                    .offset(y: size * 0.16)
                }
                .frame(width: size, height: size)
                .clipShape(Circle())
            }
            .aspectRatio(1, contentMode: .fit)
            .accessibilityHidden(true)
        }

        private var shape: AnyShape {
            switch figure {
            case .round: AnyShape(Circle())
            case .square: AnyShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            case .pill: AnyShape(Capsule())
            }
        }
    }

    private struct CrewFeatures: Shape {
        let mood: DIPCrewFace.Mood

        func path(in rect: CGRect) -> Path {
            var path = Path()
            let w = rect.width, h = rect.height
            let eyeY = rect.minY + h * 0.38
            let left = CGPoint(x: rect.minX + w * 0.32, y: eyeY)
            let right = CGPoint(x: rect.minX + w * 0.68, y: eyeY)
            let eye = h * 0.09
            path.move(to: CGPoint(x: left.x, y: left.y - eye / 2))
            path.addLine(to: CGPoint(x: left.x, y: left.y + eye / 2))
            if mood == .wink {
                path.move(to: CGPoint(x: right.x - eye / 1.5, y: right.y))
                path.addLine(to: CGPoint(x: right.x + eye / 1.5, y: right.y))
            } else {
                path.move(to: CGPoint(x: right.x, y: right.y - eye / 2))
                path.addLine(to: CGPoint(x: right.x, y: right.y + eye / 2))
            }
            let mouthY = rect.minY + h * 0.66
            path.move(to: CGPoint(x: rect.minX + w * 0.36, y: mouthY))
            let end = CGPoint(x: rect.minX + w * 0.64, y: mouthY)
            switch mood {
            case .happy, .wink: path.addQuadCurve(to: end, control: CGPoint(x: rect.midX, y: mouthY + h * 0.16))
            case .calm: path.addLine(to: end)
            }
            return path
        }
    }

    #Preview("Empty states") {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                DIPEmptyState(
                    screen: "home-events", title: "Nothing planned yet",
                    message: "Check back soon, or look back at past events.",
                    actionTitle: "Browse past events", action: {})
                DIPEmptyState(
                    screen: "home-recents", title: "Events you’ve attended will show up here",
                    message: "Join one this week and your coworkers will appear here.")
                DIPEmptyState(
                    screen: "attending", title: "Be the first to join",
                    message: "Tap Join the Activity and coworkers will see you here.", style: .compact)
            }
            .padding(20)
        }
    }

    #Preview("Empty states, accessibility text") {
        VStack(spacing: 24) {
            DIPEmptyState(
                screen: "album", title: "No photos yet", message: "Be the first to add one from this event.",
                actionTitle: "Add photos", action: {})
            DIPEmptyState(screen: "attending", title: "Be the first to join", style: .compact)
        }
        .padding(20)
        .environment(\.dynamicTypeSize, .accessibility3)
    }
#endif
