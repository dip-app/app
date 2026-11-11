#if canImport(SwiftUI)
    import SwiftUI

    public struct DIPButton: View {
        public enum Emphasis: Sendable { case primary, secondary, destructive }
        @Environment(\.isEnabled) private var inheritedEnabled
        private let title: String
        private let emphasis: Emphasis
        private let isLoading: Bool
        private let isEnabled: Bool
        private let action: () -> Void

        public init(
            _ title: String, emphasis: Emphasis = .primary, isLoading: Bool = false, isEnabled: Bool = true,
            action: @escaping () -> Void
        ) {
            self.title = title
            self.emphasis = emphasis
            self.isLoading = isLoading
            self.isEnabled = isEnabled
            self.action = action
        }
        public var body: some View {
            Button(role: emphasis == .destructive ? .destructive : nil, action: action) {
                HStack(spacing: DIPTokens.Spacing.related) {
                    if isLoading { ProgressView().tint(foreground).accessibilityHidden(true) }
                    Text(title).font(DIPReferenceAssets.font("Figtree-Regular", size: 18, relativeTo: .body)).multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity, minHeight: DIPTokens.Spacing.minimumTouchTarget)
                .padding(.horizontal, DIPTokens.Spacing.contentInset)
                .padding(.vertical, DIPTokens.Spacing.compact)
                .contentShape(Capsule())
                .foregroundStyle(foreground)
                .background(background, in: Capsule())
            }
            .buttonStyle(DIPPressFeedbackStyle())
            .opacity(effectiveEnabled ? 1 : 0.55)
            .disabled(!isEnabled || isLoading)
            .accessibilityLabel(Text(title))
            .accessibilityValue(Text(isLoading ? "In progress" : (!effectiveEnabled ? "Unavailable" : "")))
        }
        private var effectiveEnabled: Bool { inheritedEnabled && isEnabled && !isLoading }

        private var background: Color {
            switch emphasis {
            case .primary: DIPComponentTheme.accent
            case .secondary: DIPComponentTheme.muted
            case .destructive: DIPComponentTheme.ink
            }
        }
        private var foreground: Color {
            // White on the purple fill (owner rule), ink on the grey secondary fill, white on the ink destructive fill.
            switch emphasis {
            case .primary: DIPComponentTheme.onAccent
            case .secondary: DIPTokens.Color.textPrimary.swiftUIColor
            case .destructive: DIPComponentTheme.inverse
            }
        }

    }
#endif
