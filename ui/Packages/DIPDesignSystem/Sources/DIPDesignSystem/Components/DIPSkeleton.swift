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

    /// Whole-page placeholders shaped like the page that is loading, built from `DIPSkeleton` (no spinner for page
    /// content). One VoiceOver element reads "Loading"; the shapes sit where the real header, cards and rows will be.
    public struct DIPPageSkeleton: View {
        public enum Kind: Sendable {
            /// A tab page (Home, My Events, Rewards): header pills, a hero card and a row of event cards.
            case tab
            /// An event or challenge page: Back and date pill, hero photo, title, text lines and people row.
            case detail
            /// A list (settings, invitations): rounded rows.
            case rows(count: Int)
            /// A photo grid (album).
            case grid
        }

        private let kind: Kind
        private let topInset: CGFloat
        private let horizontalInset: CGFloat
        private let label: Text
        /// Fast loads never flash a skeleton: the shapes fade in only after `DIPMotion.skeletonGrace`.
        @State private var shapesVisible = false
        @Environment(\.accessibilityReduceMotion) private var reduceMotion

        /// - Parameters:
        ///   - topInset: space above the first shape (the page's status-bar allowance).
        ///   - horizontalInset: side margins (0 when the host already pads its content).
        ///   - label: what VoiceOver says; defaults to "Loading".
        public init(_ kind: Kind, topInset: CGFloat = 0, horizontalInset: CGFloat = CGFloat(DIPTokens.Spacing.contentInset), label: Text? = nil) {
            self.kind = kind
            self.topInset = topInset
            self.horizontalInset = horizontalInset
            self.label = label ?? Text("Loading", bundle: .module, comment: "VoiceOver label of a page that is still loading")
        }

        public var body: some View {
            VStack(alignment: .leading, spacing: 0) {
                switch kind {
                case .tab: tab
                case .detail: detail
                case .rows(let count): rows(count)
                case .grid: grid
                }
                Spacer(minLength: 0)
            }
            .opacity(shapesVisible ? 1 : 0)
            .padding(.top, topInset)
            .padding(.horizontal, horizontalInset)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            // A delayed animation (not a sleeping task), so a busy main thread at launch cannot hold the shapes back.
            .onAppear {
                withAnimation(DIPMotion.reveal(reduceMotion: reduceMotion).delay(DIPMotion.skeletonGrace)) { shapesVisible = true }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(label)
            .accessibilityIdentifier("page.loading")
        }

        private var tab: some View {
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    DIPSkeleton(cornerRadius: -1).frame(width: 96, height: 42)
                    Spacer(minLength: 10)
                    DIPSkeleton(cornerRadius: -1).frame(width: 118, height: 50)
                }
                DIPSkeleton(cornerRadius: -1).frame(width: 170, height: 16).padding(.top, 33)
                DIPSkeleton().frame(height: 225).padding(.top, 12)
                DIPSkeleton(cornerRadius: -1).frame(width: 150, height: 16).padding(.top, 26)
                HStack(spacing: 10) {
                    DIPSkeleton().frame(height: 205)
                    DIPSkeleton().frame(height: 205)
                }
                .padding(.top, 12)
            }
        }

        private var detail: some View {
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    DIPSkeleton(cornerRadius: -1).frame(width: 50, height: 50)
                    Spacer(minLength: 10)
                    DIPSkeleton(cornerRadius: -1).frame(width: 124, height: 40)
                }
                DIPSkeleton().frame(height: 200).padding(.top, 12)
                DIPSkeleton(cornerRadius: 6).frame(width: 210, height: 34).padding(.top, 18)
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(0..<4, id: \.self) { line in
                        DIPSkeleton(cornerRadius: -1).frame(height: 12)
                            .frame(maxWidth: line == 3 ? 200 : .infinity, alignment: .leading)
                    }
                }
                .padding(.top, 16)
                HStack(spacing: 10) {
                    ForEach(0..<4, id: \.self) { _ in DIPSkeleton(cornerRadius: -1).frame(width: 40, height: 40) }
                    DIPSkeleton(cornerRadius: -1).frame(height: 32)
                }
                .padding(.top, 24)
            }
        }

        private func rows(_ count: Int) -> some View {
            VStack(spacing: 10) {
                ForEach(0..<max(1, count), id: \.self) { _ in
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 8) {
                            DIPSkeleton(cornerRadius: -1).frame(width: 150, height: 14)
                            DIPSkeleton(cornerRadius: -1).frame(maxWidth: .infinity).frame(height: 11)
                        }
                        DIPSkeleton(cornerRadius: -1).frame(width: 46, height: 28)
                    }
                    .padding(14)
                    .background(
                        DIPTokens.Color.actionPrimary.swiftUIColor.opacity(0.05),
                        in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                }
            }
        }

        private var grid: some View {
            VStack(spacing: 10) {
                HStack(spacing: 10) {
                    DIPSkeleton().frame(height: 220)
                    VStack(spacing: 10) {
                        DIPSkeleton().frame(height: 105)
                        DIPSkeleton().frame(height: 105)
                    }
                    .frame(width: 110)
                }
                HStack(spacing: 10) {
                    DIPSkeleton().frame(height: 110)
                    DIPSkeleton().frame(height: 110)
                    DIPSkeleton().frame(height: 110)
                }
                DIPSkeleton().frame(height: 160)
            }
        }
    }
#endif
