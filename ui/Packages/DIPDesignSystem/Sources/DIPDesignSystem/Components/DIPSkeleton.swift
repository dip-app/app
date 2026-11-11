#if canImport(SwiftUI)
    import SwiftUI

    /// A flat placeholder shape for content that is loading: the muted surface token, sized by the caller to the
    /// footprint of the real content so nothing moves when it arrives. Pulses gently; no loop under Reduce Motion.
    /// Decorative: the host labels the loading region once for VoiceOver.
    public struct DIPSkeleton: View {
        private let cornerRadius: CGFloat
        @Environment(\.accessibilityReduceMotion) private var reduceMotion
        @State private var dimmed = false

        /// A negative radius draws a capsule.
        public init(cornerRadius: CGFloat = 20) { self.cornerRadius = cornerRadius }

        public var body: some View {
            Group {
                if cornerRadius < 0 { Capsule().fill(DIPTokens.Color.surfaceMuted.swiftUIColor) }
                else { RoundedRectangle(cornerRadius: cornerRadius).fill(DIPTokens.Color.surfaceMuted.swiftUIColor) }
            }
            .opacity(dimmed ? 0.55 : 1)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) { dimmed = true }
            }
            .onChange(of: reduceMotion) { _, reduced in if reduced { dimmed = false } }
            .accessibilityHidden(true)
        }
    }
#endif
