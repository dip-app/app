#if canImport(SwiftUI)
    import SwiftUI

    extension DIPMotion {
        /// Touch-down and release of a pressed surface: quick to respond, settles without a visible bounce.
        /// Reduce Motion keeps only the tint change, on a short linear fade.
        public static func press(reduceMotion: Bool = false) -> Animation {
            reduceMotion ? .linear(duration: 0.1) : .spring(response: 0.26, dampingFraction: 0.86)
        }
    }

    /// Press feedback for photo and hero cards (event cards, the weekly challenge, memories): the card settles in by
    /// 1.5 % and darkens slightly, so the photo and its white title stay readable (the plain style faded the whole card
    /// toward transparent). Under Reduce Motion it only darkens.
    public struct DIPCardPressStyle: ButtonStyle {
        private let cornerRadius: CGFloat
        public init(cornerRadius: CGFloat = CGFloat(DIPTokens.Radius.card)) { self.cornerRadius = cornerRadius }
        public func makeBody(configuration: Configuration) -> some View {
            PressedCard(configuration: configuration, cornerRadius: cornerRadius)
        }

        private struct PressedCard: View {
            let configuration: ButtonStyleConfiguration
            let cornerRadius: CGFloat
            @Environment(\.accessibilityReduceMotion) private var reduceMotion
            var body: some View {
                let pressed = configuration.isPressed
                configuration.label
                    .overlay {
                        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                            .fill(.black.opacity(pressed ? 0.12 : 0))
                            .allowsHitTesting(false)
                    }
                    .scaleEffect(pressed && !reduceMotion ? 0.985 : 1)
                    .animation(DIPMotion.press(reduceMotion: reduceMotion), value: pressed)
            }
        }
    }

    /// Press feedback for list rows (participants, settings rows): a soft ink highlight behind the content, no scale,
    /// so a row never moves under the finger.
    public struct DIPRowPressStyle: ButtonStyle {
        private let cornerRadius: CGFloat
        public init(cornerRadius: CGFloat = 12) { self.cornerRadius = cornerRadius }
        public func makeBody(configuration: Configuration) -> some View {
            configuration.label
                .background {
                    RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                        .fill(DIPTokens.Color.textPrimary.swiftUIColor.opacity(configuration.isPressed ? 0.06 : 0))
                        .padding(.horizontal, -8)
                }
                .animation(.linear(duration: 0.1), value: configuration.isPressed)
        }
    }

    /// Press feedback for round icon buttons (Back, Close, the header bell and avatar, rail items): the icon shrinks
    /// slightly and springs back; under Reduce Motion it dims instead.
    public struct DIPIconPressStyle: ButtonStyle {
        public init() {}
        public func makeBody(configuration: Configuration) -> some View {
            PressedIcon(configuration: configuration)
        }

        private struct PressedIcon: View {
            let configuration: ButtonStyleConfiguration
            @Environment(\.accessibilityReduceMotion) private var reduceMotion
            var body: some View {
                let pressed = configuration.isPressed
                configuration.label
                    .scaleEffect(pressed && !reduceMotion ? 0.9 : 1)
                    .opacity(pressed && reduceMotion ? 0.7 : 1)
                    .animation(DIPMotion.press(reduceMotion: reduceMotion), value: pressed)
            }
        }
    }
#endif
