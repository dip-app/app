/// Describes one abstract gift: box and ribbon colours come only from the brand tokens, the bow and
/// the box pattern vary so every reward reads as its own present. No SwiftUI dependency; unit tested.
public struct DIPGiftStyle: Equatable, Sendable {
    public enum Tone: String, CaseIterable, Sendable { case purple, pink, yellow, eventsPink, ink, white }
    public enum Bow: String, CaseIterable, Sendable { case loops, loopsWithTails, flat, pompom, tails }
    public enum Pattern: String, CaseIterable, Sendable { case none, dots, stripes }
    public enum Ribbon: String, CaseIterable, Sendable { case cross, vertical, band }

    public let box: Tone
    public let ribbonTone: Tone
    public let bow: Bow
    public let pattern: Pattern
    public let ribbon: Ribbon

    public init(box: Tone, ribbon ribbonTone: Tone, bow: Bow, pattern: Pattern = .none, ribbonLayout: Ribbon = .vertical) {
        self.box = box
        self.ribbonTone = ribbonTone
        self.bow = bow
        self.pattern = pattern
        self.ribbon = ribbonLayout
    }

    /// Six hand-picked presents; `forIndex` cycles through them so neighbours always differ.
    public static let collection: [DIPGiftStyle] = [
        DIPGiftStyle(box: .purple, ribbon: .yellow, bow: .loops, ribbonLayout: .vertical),
        DIPGiftStyle(box: .pink, ribbon: .white, bow: .loopsWithTails, ribbonLayout: .cross),
        DIPGiftStyle(box: .yellow, ribbon: .ink, bow: .flat, ribbonLayout: .vertical),
        DIPGiftStyle(box: .eventsPink, ribbon: .yellow, bow: .pompom, pattern: .dots, ribbonLayout: .band),
        DIPGiftStyle(box: .ink, ribbon: .pink, bow: .tails, pattern: .stripes, ribbonLayout: .cross),
        DIPGiftStyle(box: .white, ribbon: .purple, bow: .loops, pattern: .dots, ribbonLayout: .band),
    ]

    public static func forIndex(_ index: Int) -> DIPGiftStyle {
        collection[((index % collection.count) + collection.count) % collection.count]
    }
}

#if canImport(SwiftUI)
    import SwiftUI

    extension DIPGiftStyle.Tone {
        /// Tile background tint for a gift: the box colour, except white boxes sit on brand purple.
        public var tileTint: Color { self == .white ? DIPGiftStyle.Tone.purple.color : color }

        public var color: Color {
            switch self {
            case .purple: DIPTokens.Color.actionPrimary.swiftUIColor
            case .pink: DIPTokens.Color.challengeAccent.swiftUIColor
            case .yellow: DIPTokens.Color.notificationAccent.swiftUIColor
            case .eventsPink: DIPTokens.Color.eventsAccent.swiftUIColor
            case .ink: DIPTokens.Color.textPrimary.swiftUIColor
            case .white: DIPTokens.Color.surfaceDefault.swiftUIColor
            }
        }
    }

    /// Flat vector present drawn on a 100 x 100 grid and scaled to `size`: rounded box, lid, ribbon
    /// and bow. `dimmed` greys the whole thing for locked rewards.
    public struct DIPGiftIllustration: View {
        private let style: DIPGiftStyle
        private let size: CGFloat
        private let dimmed: Bool

        public init(style: DIPGiftStyle, size: CGFloat = 96, dimmed: Bool = false) {
            self.style = style
            self.size = size
            self.dimmed = dimmed
        }

        public var body: some View {
            let unit = size / 100
            let ink = DIPTokens.Color.textPrimary.swiftUIColor
            let box = style.box.color
            let ribbon = style.ribbonTone.color
            ZStack(alignment: .topLeading) {
                // Ground shadow.
                Ellipse().fill(ink.opacity(0.08)).frame(width: 66 * unit, height: 7 * unit)
                    .offset(x: 17 * unit, y: 90 * unit)
                // Body.
                RoundedRectangle(cornerRadius: 9 * unit, style: .continuous).fill(box)
                    .frame(width: 72 * unit, height: 50 * unit)
                    .overlay(alignment: .topLeading) { pattern(unit: unit, ribbon: ribbon) }
                    .offset(x: 14 * unit, y: 40 * unit)
                outline(unit: unit, width: 72, height: 50, x: 14, y: 40, radius: 9)
                // Ribbon across the body.
                if style.ribbon != .band {
                    Rectangle().fill(ribbon).frame(width: 12 * unit, height: 50 * unit).offset(x: 44 * unit, y: 40 * unit)
                }
                if style.ribbon != .vertical {
                    Rectangle().fill(ribbon).frame(width: 72 * unit, height: 9 * unit).offset(x: 14 * unit, y: 62 * unit)
                }
                // Lid sits over the body, slightly wider and darker.
                RoundedRectangle(cornerRadius: 7 * unit, style: .continuous).fill(box)
                    .frame(width: 80 * unit, height: 18 * unit)
                    .overlay { RoundedRectangle(cornerRadius: 7 * unit, style: .continuous).fill(ink.opacity(0.12)) }
                    .offset(x: 10 * unit, y: 28 * unit)
                outline(unit: unit, width: 80, height: 18, x: 10, y: 28, radius: 7)
                Rectangle().fill(ribbon).frame(width: 12 * unit, height: 18 * unit).offset(x: 44 * unit, y: 28 * unit)
                bow(unit: unit, ribbon: ribbon)
            }
            .frame(width: size, height: size, alignment: .topLeading)
            .saturation(dimmed ? 0.15 : 1)
            .opacity(dimmed ? 0.7 : 1)
            .accessibilityHidden(true)
        }

        /// A thin ink edge keeps white and yellow presents crisp on light tiles.
        private func outline(unit: CGFloat, width: CGFloat, height: CGFloat, x: CGFloat, y: CGFloat, radius: CGFloat) -> some View {
            RoundedRectangle(cornerRadius: radius * unit, style: .continuous)
                .strokeBorder(DIPTokens.Color.textPrimary.swiftUIColor.opacity(style.box == .white ? 0.18 : 0.0), lineWidth: 1.5)
                .frame(width: width * unit, height: height * unit).offset(x: x * unit, y: y * unit)
        }

        @ViewBuilder private func pattern(unit: CGFloat, ribbon: Color) -> some View {
            let mark = style.box == .white || style.box == .yellow || style.box == .ink
                ? ribbon.opacity(style.box == .ink ? 0.5 : 0.35) : Color.white.opacity(0.35)
            switch style.pattern {
            case .none: EmptyView()
            case .dots:
                ZStack(alignment: .topLeading) {
                    ForEach(0..<8, id: \.self) { index in
                        let column = CGFloat(index % 4), row = CGFloat(index / 4)
                        Circle().fill(mark).frame(width: 6 * unit, height: 6 * unit)
                            .offset(x: (9 + column * 17 + (row == 1 ? 8 : 0)) * unit, y: (20 + row * 17) * unit)
                    }
                }
                .frame(width: 72 * unit, height: 50 * unit, alignment: .topLeading)
                .clipShape(RoundedRectangle(cornerRadius: 9 * unit, style: .continuous))
            case .stripes:
                HStack(spacing: 6 * unit) {
                    ForEach(0..<6, id: \.self) { _ in Rectangle().fill(mark).frame(width: 3 * unit) }
                }
                .padding(.leading, 6 * unit)
                .frame(width: 72 * unit, height: 50 * unit, alignment: .topLeading)
                .clipShape(RoundedRectangle(cornerRadius: 9 * unit, style: .continuous))
            }
        }

        @ViewBuilder private func bow(unit: CGFloat, ribbon: Color) -> some View {
            let ink = DIPTokens.Color.textPrimary.swiftUIColor
            let shade = ink.opacity(0.14)
            // Anchor: centre of the lid's top edge (50, 28).
            switch style.bow {
            case .loops, .loopsWithTails:
                if style.bow == .loopsWithTails {
                    tail(unit: unit, color: ribbon, angle: 18, x: 49, y: 22)
                    tail(unit: unit, color: ribbon, angle: -18, x: 51, y: 22)
                }
                loop(unit: unit, color: ribbon, shade: shade, angle: -28, x: 34, y: 12)
                loop(unit: unit, color: ribbon, shade: shade, angle: 28, x: 52, y: 12)
                Circle().fill(ribbon).frame(width: 10 * unit, height: 10 * unit)
                    .overlay { Circle().fill(shade) }.offset(x: 45 * unit, y: 19 * unit)
            case .flat:
                RoundedRectangle(cornerRadius: 3 * unit, style: .continuous).fill(ribbon)
                    .frame(width: 18 * unit, height: 18 * unit).rotationEffect(.degrees(45))
                    .offset(x: 41 * unit, y: 10 * unit)
                RoundedRectangle(cornerRadius: 2 * unit, style: .continuous).fill(ribbon.opacity(0.55))
                    .frame(width: 8 * unit, height: 8 * unit).rotationEffect(.degrees(45))
                    .offset(x: 46 * unit, y: 15 * unit)
            case .pompom:
                ForEach(0..<5, id: \.self) { index in
                    let points: [(CGFloat, CGFloat)] = [(40, 14), (53, 14), (46.5, 7), (36, 21), (57, 21)]
                    Circle().fill(ribbon).frame(width: 12 * unit, height: 12 * unit)
                        .overlay { Circle().stroke(shade, lineWidth: 1 * unit) }
                        .offset(x: (points[index].0 - 1) * unit, y: points[index].1 * unit - 4 * unit)
                }
            case .tails:
                tail(unit: unit, color: ribbon, angle: 26, x: 48, y: 14)
                tail(unit: unit, color: ribbon, angle: -26, x: 52, y: 14)
                Circle().fill(ribbon).frame(width: 12 * unit, height: 12 * unit)
                    .overlay { Circle().fill(shade) }.offset(x: 44 * unit, y: 17 * unit)
            }
        }

        private func loop(unit: CGFloat, color: Color, shade: Color, angle: Double, x: CGFloat, y: CGFloat) -> some View {
            ZStack {
                Ellipse().fill(color)
                Ellipse().stroke(shade, lineWidth: 1.5 * unit)
                Ellipse().fill(shade).frame(width: 7 * unit, height: 4 * unit)
            }
            .frame(width: 18 * unit, height: 16 * unit)
            .rotationEffect(.degrees(angle))
            .offset(x: x * unit, y: y * unit)
        }

        private func tail(unit: CGFloat, color: Color, angle: Double, x: CGFloat, y: CGFloat) -> some View {
            RoundedRectangle(cornerRadius: 2 * unit, style: .continuous).fill(color)
                .frame(width: 7 * unit, height: 20 * unit)
                .overlay { RoundedRectangle(cornerRadius: 2 * unit, style: .continuous).stroke(DIPTokens.Color.textPrimary.swiftUIColor.opacity(0.14), lineWidth: 1 * unit) }
                .rotationEffect(.degrees(angle), anchor: .top)
                .offset(x: (x - 3.5) * unit, y: y * unit)
        }
    }

    #Preview("Gift collection") {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 3), spacing: 16) {
            ForEach(0..<DIPGiftStyle.collection.count, id: \.self) { DIPGiftIllustration(style: .forIndex($0)) }
        }.padding()
    }
#endif
