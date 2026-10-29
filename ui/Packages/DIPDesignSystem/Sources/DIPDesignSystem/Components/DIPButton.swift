#if canImport(SwiftUI)
    import SwiftUI

    public struct DIPButton: View {
        public enum Emphasis: Sendable { case primary, secondary, destructive }
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
                    Text(title).font(.body.weight(.semibold)).multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity, minHeight: DIPTokens.Spacing.minimumTouchTarget)
                .padding(.horizontal, DIPTokens.Spacing.contentInset)
                .padding(.vertical, DIPTokens.Spacing.compact)
                .contentShape(Capsule())
            }
            .buttonStyle(PillStyle(background: background, foreground: foreground))
            .disabled(!isEnabled || isLoading)
            .accessibilityLabel(Text(title))
            .accessibilityValue(Text(isLoading ? "In progress" : (!isEnabled ? "Unavailable" : "")))
        }
        private var background: Color {
            switch emphasis {
            case .primary: DIPComponentTheme.accent
            case .secondary: DIPComponentTheme.muted
            case .destructive: DIPComponentTheme.ink
            }
        }
        private var foreground: Color {
            emphasis == .destructive ? DIPComponentTheme.inverse : DIPComponentTheme.onAccent
        }

        private struct PillStyle: ButtonStyle {
            @Environment(\.isEnabled) private var isEnabled
            let background: Color
            let foreground: Color
            func makeBody(configuration: Configuration) -> some View {
                configuration.label.foregroundStyle(foreground)
                    .background(background, in: Capsule())
                    .opacity(isEnabled ? (configuration.isPressed ? 0.8 : 1) : 0.55)
            }
        }
    }
#endif
