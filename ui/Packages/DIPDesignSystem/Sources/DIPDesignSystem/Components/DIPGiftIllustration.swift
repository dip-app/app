/// A solid gift-box card with one small bow. Replaces the raffle ticket's notched shape on the Rewards
/// page while keeping its flat, solid colour treatment. Colours come only from the Rewards frame palette.
public struct DIPGiftStyle: Equatable, Sendable {
    public enum Tone: String, CaseIterable, Sendable { case yellow, orange, blue, ink, white }
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

    /// Fill for the corner tag (opposite the bow): yellow on orange, ink elsewhere; the tag's text flips to match.
    public var tagTone: Tone { box == .orange ? .yellow : .ink }
    public var tagUsesDarkText: Bool { tagTone == .yellow }

    /// One bow construction for every card; only colour and placement vary.
    public static let raffle = DIPGiftStyle(box: .yellow, bow: .orange, placement: .topCenter)
    public static let orangeBox = DIPGiftStyle(box: .orange, bow: .yellow, placement: .topLeft)
    public static let blueBox = DIPGiftStyle(box: .blue, bow: .ink, placement: .topRight)
}

#if canImport(SwiftUI)
    import SwiftUI

    extension DIPGiftStyle.Tone {
        public var color: Color {
            switch self {
            case .yellow: DIPTokens.Color.rewardYellowCard.swiftUIColor
            case .orange: DIPTokens.Color.rewardOrangeCard.swiftUIColor
            case .blue: DIPTokens.Color.rewardBlueCard.swiftUIColor
            case .ink: DIPTokens.Color.textPrimary.swiftUIColor
            case .white: DIPTokens.Color.surfaceDefault.swiftUIColor
            }
        }
    }

    /// The one small bow: two teardrop loops, two short angled tails and a small knot, one stroke treatment.
    public struct DIPGiftBow: View {
        let color: Color
        public init(color: Color) { self.color = color }

        public var body: some View {
            let edge = Color.white.opacity(0.35)
            ZStack {
                ForEach([-1.0, 1.0], id: \.self) { side in
                    RoundedRectangle(cornerRadius: 2, style: .continuous).fill(color)
                        .frame(width: 6, height: 13).rotationEffect(.degrees(side * 24), anchor: .top)
                        .offset(x: side * -2, y: 7)
                    Ellipse().fill(color).overlay { Ellipse().stroke(edge, lineWidth: 1) }
                        .frame(width: 22, height: 15).rotationEffect(.degrees(side * 26))
                        .offset(x: side * 11, y: -3)
                }
                Circle().fill(color).overlay { Circle().stroke(edge, lineWidth: 1) }.frame(width: 9, height: 9)
            }
            .frame(width: 46, height: 30)
            .accessibilityHidden(true)
        }
    }

    /// Gift-box card background: solid colour in the card radius, a slightly darker lid band across the
    /// top, and one small bow that overhangs the top edge. Content is laid over it by the caller.
    public struct DIPGiftBoxCard<Content: View>: View {
        private let style: DIPGiftStyle
        private let content: Content
        private let tag: String?
        private let lidHeight: CGFloat = 30

        /// - tag: short label (e.g. "20% off") set into the lid band at the corner opposite the bow.
        public init(style: DIPGiftStyle, tag: String? = nil, @ViewBuilder content: () -> Content) {
            self.style = style
            self.tag = tag
            self.content = content()
        }

        public var body: some View {
            let shape = RoundedRectangle(cornerRadius: DIPTokens.Radius.card, style: .continuous)
            content
                .frame(maxWidth: .infinity, alignment: .leading)
                .background {
                    shape.fill(style.box.color)
                        .overlay(alignment: .top) {
                            Rectangle().fill(DIPTokens.Color.textPrimary.swiftUIColor.opacity(0.12))
                                .frame(height: lidHeight)
                        }
                        .clipShape(shape)
                }
                .overlay(alignment: tagAlignment) { tagView }
                .overlay(alignment: bowAlignment) {
                    DIPGiftBow(color: style.bowTone.color)
                        .scaleEffect(1.2)
                        .rotationEffect(.degrees(style.placement == .topLeft ? -14 : style.placement == .topRight ? 14 : 0))
                        .offset(x: style.placement == .topLeft ? 26 : style.placement == .topRight ? -26 : 0, y: -20)
                }
        }

        private var tagAlignment: Alignment { style.placement == .topLeft ? .topTrailing : .topLeading }

        @ViewBuilder private var tagView: some View {
            if let tag {
                let radius = DIPTokens.Radius.card
                let onRight = style.placement == .topLeft
                Text(tag)
                    .font(DIPReferenceAssets.font("Figtree-Bold", size: 15, relativeTo: .subheadline))
                    .foregroundStyle(style.tagUsesDarkText
                        ? DIPTokens.Color.textPrimary.swiftUIColor : DIPTokens.Color.textInverse.swiftUIColor)
                    .padding(.horizontal, 16).frame(height: lidHeight)
                    .background(
                        style.tagTone.color,
                        in: UnevenRoundedRectangle(
                            topLeadingRadius: onRight ? 0 : radius, bottomLeadingRadius: onRight ? 14 : 0,
                            bottomTrailingRadius: onRight ? 0 : 14, topTrailingRadius: onRight ? radius : 0,
                            style: .continuous))
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

    #Preview("Gift boxes") {
        VStack(spacing: 28) {
            ForEach([DIPGiftStyle.raffle, .orangeBox, .blueBox], id: \.box) { style in
                DIPGiftBoxCard(style: style) { Color.clear.frame(height: 150) }
            }
        }.padding()
    }
#endif
