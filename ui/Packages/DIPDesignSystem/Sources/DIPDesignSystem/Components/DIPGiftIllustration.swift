/// A solid gift-box card with one small bow. Replaces the raffle ticket's notched shape on the Rewards
/// page while keeping its flat, solid colour treatment. Colours come from the Rewards frame palette.
public struct DIPGiftStyle: Equatable, Sendable {
    public enum Tone: String, CaseIterable, Sendable { case yellow, orange, blue, periwinkle, ink, white }
    public enum Placement: String, CaseIterable, Sendable { case topCenter, topLeft, topRight }

    public let box: Tone
    public let bowTone: Tone
    public let placement: Placement

    public init(box: Tone, bow bowTone: Tone, placement: Placement) {
        self.box = box
        self.bowTone = bowTone
        self.placement = placement
    }

    /// Text on the box: ink on the light yellow and blue boxes, white on orange (contrast).
    public var usesDarkText: Bool { box == .yellow || box == .blue }

    /// The "% off" tab is always ink with white text, so it reads on every box colour.
    public var tagTone: Tone { .ink }

    /// One bow construction for every card; only colour and placement vary.
    public static let raffle = DIPGiftStyle(box: .yellow, bow: .orange, placement: .topCenter)
    public static let orangeBox = DIPGiftStyle(box: .orange, bow: .yellow, placement: .topLeft)
    public static let blueBox = DIPGiftStyle(box: .blue, bow: .periwinkle, placement: .topRight)
}

#if canImport(SwiftUI)
    import SwiftUI

    extension DIPGiftStyle.Tone {
        public var color: Color {
            switch self {
            case .yellow: DIPTokens.Color.rewardYellowCard.swiftUIColor
            case .orange: DIPTokens.Color.rewardOrangeCard.swiftUIColor
            case .blue: DIPTokens.Color.rewardBlueCard.swiftUIColor
            case .periwinkle: DIPTokens.Color.actionPrimary.swiftUIColor
            case .ink: DIPTokens.Color.textPrimary.swiftUIColor
            case .white: DIPTokens.Color.surfaceDefault.swiftUIColor
            }
        }

        /// Lid band: the box colour about 10% darker.
        var lidColor: Color {
            switch self {
            case .yellow: Color(red: 235 / 255, green: 178 / 255, blue: 48 / 255)
            case .orange: Color(red: 226 / 255, green: 68 / 255, blue: 0)
            case .blue: Color(red: 98 / 255, green: 182 / 255, blue: 245 / 255)
            default: color
            }
        }

        /// Thin shadow strip under the lid: the box colour about 18% darker.
        var lidShadowColor: Color {
            switch self {
            case .yellow: Color(red: 205 / 255, green: 157 / 255, blue: 42 / 255)
            case .orange: Color(red: 207 / 255, green: 63 / 255, blue: 0)
            case .blue: Color(red: 86 / 255, green: 160 / 255, blue: 215 / 255)
            default: color
            }
        }
    }

    /// Geometry of the one small bow on a 54 x 34 pt grid with the knot centre at (27, 20): two teardrop
    /// loops tilted 22 degrees, a rounded knot, and two short tapered tails behind. Each part is its own
    /// shape so overlaps never cancel; the loop holes are cut out in `DIPGiftBow`.
    struct DIPGiftBowShape: Shape {
        enum Part { case tails, leftLoop, rightLoop, knot, leftHole, rightHole }
        static let size = CGSize(width: 54, height: 34)
        static let knot = CGPoint(x: 27, y: 20)
        let part: Part

        private func about(_ angle: Double) -> CGAffineTransform {
            let k = Self.knot
            return CGAffineTransform(translationX: k.x, y: k.y).rotated(by: angle * .pi / 180).translatedBy(x: -k.x, y: -k.y)
        }
        private var mirror: CGAffineTransform {
            CGAffineTransform(translationX: 2 * Self.knot.x, y: 0).scaledBy(x: -1, y: 1)
        }

        func path(in rect: CGRect) -> Path {
            let k = Self.knot
            var path = Path()
            switch part {
            case .tails:
                for angle in [18.0, -18.0] {
                    var tail = Path()
                    tail.move(to: CGPoint(x: k.x - 3.5, y: k.y))
                    tail.addLine(to: CGPoint(x: k.x + 3.5, y: k.y))
                    tail.addLine(to: CGPoint(x: k.x + 2.5, y: k.y + 14))
                    tail.addLine(to: CGPoint(x: k.x, y: k.y + 11))
                    tail.addLine(to: CGPoint(x: k.x - 2.5, y: k.y + 14))
                    tail.closeSubpath()
                    path.addPath(tail.applying(about(angle)))
                }
            case .leftLoop, .rightLoop:
                path.move(to: k)
                path.addCurve(to: CGPoint(x: k.x - 26, y: k.y), control1: CGPoint(x: k.x - 8, y: k.y - 12), control2: CGPoint(x: k.x - 26, y: k.y - 10))
                path.addCurve(to: k, control1: CGPoint(x: k.x - 26, y: k.y + 9), control2: CGPoint(x: k.x - 8, y: k.y + 10))
                path.closeSubpath()
                path = path.applying(about(22))
                if part == .rightLoop { path = path.applying(mirror) }
            case .leftHole, .rightHole:
                path.addEllipse(in: CGRect(x: k.x - 21, y: k.y - 3, width: 10, height: 6))
                path = path.applying(about(22))
                if part == .rightHole { path = path.applying(mirror) }
            case .knot:
                path.addRoundedRect(in: CGRect(x: k.x - 4.5, y: k.y - 4.5, width: 9, height: 9), cornerSize: CGSize(width: 3, height: 3))
            }
            return path.applying(CGAffineTransform(scaleX: rect.width / Self.size.width, y: rect.height / Self.size.height))
        }
    }

    public struct DIPGiftBow: View {
        let color: Color
        public init(color: Color) { self.color = color }

        private func silhouette(_ fill: Color) -> some View {
            ZStack {
                DIPGiftBowShape(part: .tails).fill(fill)
                DIPGiftBowShape(part: .leftLoop).fill(fill)
                DIPGiftBowShape(part: .rightLoop).fill(fill)
                DIPGiftBowShape(part: .knot).fill(fill)
            }
        }

        public var body: some View {
            let size = DIPGiftBowShape.size
            let kneeY = DIPGiftBowShape.knot.y
            ZStack {
                silhouette(color)
                // Darker lower half.
                DIPTokens.Color.textPrimary.swiftUIColor.opacity(0.14)
                    .mask(alignment: .bottom) { Rectangle().frame(height: size.height - kneeY) }
                    .mask { silhouette(.black) }
                // Light top edge on the loops.
                ZStack {
                    DIPGiftBowShape(part: .leftLoop).stroke(Color.white.opacity(0.30), lineWidth: 1.5)
                    DIPGiftBowShape(part: .rightLoop).stroke(Color.white.opacity(0.30), lineWidth: 1.5)
                }
                .mask(alignment: .top) { Rectangle().frame(height: kneeY - 8) }
                // Holes.
                DIPGiftBowShape(part: .leftHole).fill(.black).blendMode(.destinationOut)
                DIPGiftBowShape(part: .rightHole).fill(.black).blendMode(.destinationOut)
            }
            .compositingGroup()
            .frame(width: size.width, height: size.height)
            .accessibilityHidden(true)
        }
    }

    /// Gift-box card background: solid colour in a 24 pt continuous radius, a distinct darker lid band
    /// with a shadow strip and a light top edge, a soft drop shadow, one small bow seated on the lid's
    /// top edge, and an optional "% off" tab set into the lid at the corner opposite the bow.
    public struct DIPGiftBoxCard<Content: View>: View {
        private let style: DIPGiftStyle
        private let content: Content
        private let tag: String?
        public static var cornerRadius: CGFloat { 24 }
        public static var lidHeight: CGFloat { 34 }

        /// - tag: short label (e.g. "20% off") set into the lid band at the corner opposite the bow.
        public init(style: DIPGiftStyle, tag: String? = nil, @ViewBuilder content: () -> Content) {
            self.style = style
            self.tag = tag
            self.content = content()
        }

        public var body: some View {
            let shape = RoundedRectangle(cornerRadius: Self.cornerRadius, style: .continuous)
            content
                .frame(maxWidth: .infinity, alignment: .leading)
                .background {
                    ZStack(alignment: .top) {
                        style.box.color
                        style.box.lidShadowColor.frame(height: Self.lidHeight + 3).frame(maxHeight: .infinity, alignment: .top)
                        style.box.lidColor.frame(height: Self.lidHeight).frame(maxHeight: .infinity, alignment: .top)
                        Color.white.opacity(0.35).frame(height: 2).frame(maxHeight: .infinity, alignment: .top)
                    }
                    .clipShape(shape)
                    .shadow(color: DIPTokens.Color.textPrimary.swiftUIColor.opacity(0.10), radius: 16, y: 8)
                }
                .overlay(alignment: tagAlignment) { tagView }
                .overlay(alignment: bowAlignment) {
                    DIPGiftBow(color: style.bowTone.color)
                        .offset(x: bowInset, y: -20)
                }
        }

        private var tagAlignment: Alignment { style.placement == .topLeft ? .topTrailing : .topLeading }
        private var bowInset: CGFloat { style.placement == .topLeft ? 13 : style.placement == .topRight ? -13 : 0 }

        @ViewBuilder private var tagView: some View {
            if let tag {
                let onRight = style.placement == .topLeft
                let outer = Self.cornerRadius
                Text(tag)
                    .font(DIPReferenceAssets.font("Figtree-Bold", size: 14, relativeTo: .subheadline))
                    .tracking(0.2)
                    .foregroundStyle(DIPTokens.Color.textInverse.swiftUIColor)
                    .padding(.horizontal, 14).frame(height: Self.lidHeight)
                    .background(
                        style.tagTone.color,
                        in: UnevenRoundedRectangle(
                            topLeadingRadius: onRight ? 0 : outer, bottomLeadingRadius: onRight ? 14 : 0,
                            bottomTrailingRadius: onRight ? 0 : 14, topTrailingRadius: onRight ? outer : 0,
                            style: .continuous))
                    .overlay { DIPGiftTagInnerEdge(onRight: onRight).stroke(Color.white.opacity(0.5), lineWidth: 2) }
            }
        }

        private var bowAlignment: Alignment {
            switch style.placement {
            case .topCenter: .top
            case .topLeft: .topLeading
            case .topRight: .topTrailing
            }
        }
    }

    /// The tab's two inner edges (the side facing the card and its bottom), so the white separator
    /// never draws along the card's outer edge.
    private struct DIPGiftTagInnerEdge: Shape {
        let onRight: Bool
        func path(in rect: CGRect) -> Path {
            var path = Path()
            let r: CGFloat = 14
            if onRight {
                path.move(to: CGPoint(x: rect.minX, y: rect.minY))
                path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY - r))
                path.addQuadCurve(to: CGPoint(x: rect.minX + r, y: rect.maxY), control: CGPoint(x: rect.minX, y: rect.maxY))
                path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
            } else {
                path.move(to: CGPoint(x: rect.maxX, y: rect.minY))
                path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - r))
                path.addQuadCurve(to: CGPoint(x: rect.maxX - r, y: rect.maxY), control: CGPoint(x: rect.maxX, y: rect.maxY))
                path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
            }
            return path
        }
    }

    #Preview("Gift boxes") {
        VStack(spacing: 40) {
            ForEach([DIPGiftStyle.raffle, .orangeBox, .blueBox], id: \.box) { style in
                DIPGiftBoxCard(style: style, tag: style == .raffle ? nil : "20% off") { Color.clear.frame(height: 150) }
            }
        }.padding()
    }
#endif
