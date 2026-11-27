#if canImport(SwiftUI)
    import SwiftUI

    /// The readability gradient under white text on a photo (event cards, memories): clear at the top, dark at the
    /// bottom edge. One definition so every photo card reads the same. Decorative.
    public struct DIPPhotoScrim: View {
        private let height: CGFloat
        public init(height: CGFloat = 90) { self.height = height }
        public var body: some View {
            LinearGradient(colors: [.clear, .black.opacity(0.6)], startPoint: .top, endPoint: .bottom)
                .frame(height: height)
                .frame(maxHeight: .infinity, alignment: .bottom)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
    }

    /// Fade between scrolled content and fixed chrome: content dissolves into the page background instead of being cut
    /// by a hard edge. Drawn as an overlay (no mask), so scrolling needs no offscreen pass. Decorative, no hit testing.
    public struct DIPEdgeFade: View {
        public enum Edge: Sendable { case top, bottom }
        private let edge: Edge
        private let length: CGFloat
        /// Fully opaque run at the outer end (for example the band behind a floating bar).
        private let solid: CGFloat
        private let color: Color

        public init(_ edge: Edge, length: CGFloat = DIPEdgeFade.topLength, solid: CGFloat = 0, color: Color = DIPTokens.Color.surfaceDefault.swiftUIColor) {
            self.edge = edge
            self.length = length
            self.solid = solid
            self.color = color
        }

        /// Top fade under a header or the status bar.
        public static let topLength: CGFloat = 16
        /// Visible fade above the floating bar; the band behind the bar itself is solid.
        public static let barFadeLength: CGFloat = 36

        public var body: some View {
            let total = length + solid
            let fadeEnd = total > 0 ? length / total : 1
            let stops: [Gradient.Stop] = [
                .init(color: color.opacity(0), location: 0),
                .init(color: color, location: fadeEnd),
                .init(color: color, location: 1),
            ]
            LinearGradient(stops: stops, startPoint: edge == .top ? .bottom : .top, endPoint: edge == .top ? .top : .bottom)
                .frame(height: total)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
    }

    /// Live updates stopped (offline or a failed listener) while the last content stays on screen: a compact ink pill
    /// that floats under the header (no layout shift) and retries when tapped.
    public struct DIPPausedPill: View {
        private let onRetry: () -> Void
        public init(onRetry: @escaping () -> Void) { self.onRetry = onRetry }
        public var body: some View {
            Button(action: onRetry) {
                HStack(spacing: 8) {
                    Image(systemName: "wifi.slash").font(.system(size: 13, weight: .semibold)).accessibilityHidden(true)
                    Text("Updates paused", bundle: .module, comment: "Pill shown when live updates stopped; the content on screen may be out of date")
                    Text("Retry", bundle: .module, comment: "Action inside the Updates paused pill")
                        .fontWeight(.semibold)
                        .foregroundStyle(DIPTokens.Color.notificationAccent.swiftUIColor)
                }
                .font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .footnote))
                .foregroundStyle(DIPTokens.Color.textInverse.swiftUIColor)
                .padding(.horizontal, 16)
                .frame(minHeight: CGFloat(DIPTokens.Spacing.minimumTouchTarget))
                .background(DIPTokens.Color.navigationBackground.swiftUIColor, in: Capsule())
                .shadow(color: .black.opacity(0.12), radius: 8, y: 3)
                .contentShape(Capsule())
            }
            .buttonStyle(DIPPressFeedbackStyle())
            .accessibilityElement(children: .combine)
            .accessibilityHint(Text("Reloads your activities", bundle: .module, comment: "VoiceOver hint of the Updates paused pill"))
            .accessibilityIdentifier("data.retry")
        }
    }

    extension DIPEdgeFade {
        /// The fade behind the floating navigation or action bar: content dissolves over `barFadeLength` above the
        /// bar and is fully covered from the bar's center down, so scrolled content never collides with the bar.
        /// Place it bottom-aligned, ignoring the safe area, under the bar.
        public static var floatingBar: DIPEdgeFade {
            DIPEdgeFade(
                .bottom, length: barFadeLength + DIPFloatingNavigation.height / 2,
                solid: DIPFloatingNavigation.barCenterInset)
        }
    }

    extension View {
        /// Apply to a page's vertical `ScrollView`: once content scrolls under the fixed header (or the status bar) its
        /// top edge dissolves into the background over a short fade instead of being cut. At rest nothing is faded, so
        /// the first section keeps its full contrast. iOS 17 keeps the plain edge (no scroll-geometry API).
        public func dipTopEdgeFade(_ length: CGFloat = DIPEdgeFade.topLength) -> some View {
            modifier(DIPTopEdgeFadeModifier(length: length))
        }
    }

    private struct DIPTopEdgeFadeModifier: ViewModifier {
        let length: CGFloat
        @State private var scrolled = false

        func body(content: Content) -> some View {
            if #available(iOS 18, macOS 15, *) {
                content
                    .onScrollGeometryChange(for: Bool.self) { geometry in
                        geometry.contentOffset.y + geometry.contentInsets.top > 1
                    } action: { _, isScrolled in
                        scrolled = isScrolled
                    }
                    .overlay(alignment: .top) {
                        DIPEdgeFade(.top, length: length)
                            .opacity(scrolled ? 1 : 0)
                            .animation(.linear(duration: 0.15), value: scrolled)
                    }
            } else {
                content
            }
        }
    }
#endif
