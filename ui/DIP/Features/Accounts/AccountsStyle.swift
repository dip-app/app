import DIPDesignSystem
import SwiftUI

// Feature-local styling built only from shared semantic tokens. Replace with
// DIPButton / DIPStateView once the UI-foundations components (packet 01) merge.

extension Color {
    init(token: RGBColor) {
        self.init(red: token.red, green: token.green, blue: token.blue)
    }
}

struct AccountsPrimaryButton: View {
    let title: String
    let isWorking: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                Text(title)
                    .font(.headline)
                    .opacity(isWorking ? 0 : 1)
                if isWorking {
                    ProgressView()
                        .tint(Color(token: DIPTokens.Color.textInverse))
                        .accessibilityLabel("Working")
                }
            }
            .frame(maxWidth: .infinity, minHeight: DIPTokens.Spacing.minimumTouchTarget)
        }
        .foregroundStyle(Color(token: DIPTokens.Color.textInverse))
        .background(Color(token: DIPTokens.Color.navigationBackground), in: RoundedRectangle(cornerRadius: DIPTokens.Radius.pill))
        .disabled(isWorking)
        .accessibilityLabel(title)
    }
}

struct AccountsSecondaryButton: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(title, action: action)
            .font(.body.weight(.semibold))
            .foregroundStyle(Color(token: DIPTokens.Color.textPrimary))
            .frame(maxWidth: .infinity, minHeight: DIPTokens.Spacing.minimumTouchTarget)
    }
}

/// Inline error or notice under a form. Pass nil to show nothing.
struct AccountsMessageText: View {
    let message: String?
    var isError = true

    var body: some View {
        if let message {
            Label(message, systemImage: isError ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                .font(.callout)
                .foregroundStyle(isError ? Color.red : Color(token: DIPTokens.Color.textPrimary))
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityElement(children: .combine)
        }
    }
}

struct AccountsTextField: View {
    let title: String
    @Binding var text: String
    var isSecure = false

    var body: some View {
        VStack(alignment: .leading, spacing: DIPTokens.Spacing.compact) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color(token: DIPTokens.Color.textPrimary))
            Group {
                if isSecure {
                    SecureField(title, text: $text)
                } else {
                    TextField(title, text: $text)
                }
            }
            .padding(.horizontal, DIPTokens.Spacing.related)
            .frame(minHeight: DIPTokens.Spacing.minimumTouchTarget)
            .background(Color(token: DIPTokens.Color.surfaceMuted), in: RoundedRectangle(cornerRadius: DIPTokens.Spacing.related))
            .accessibilityLabel(title)
        }
    }
}

struct AccountsScreen<Content: View>: View {
    let title: String
    let subtitle: String
    @ViewBuilder let content: () -> Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DIPTokens.Spacing.sectionGap) {
                VStack(alignment: .leading, spacing: DIPTokens.Spacing.related) {
                    Text(title)
                        .font(.largeTitle.bold())
                        .foregroundStyle(Color(token: DIPTokens.Color.textPrimary))
                        .accessibilityAddTraits(.isHeader)
                    Text(subtitle)
                        .font(.body)
                        .foregroundStyle(Color(token: DIPTokens.Color.textPrimary).opacity(0.75))
                }
                content()
            }
            .padding(DIPTokens.Spacing.contentInset)
        }
        .background(Color(token: DIPTokens.Color.surfaceDefault))
        .scrollDismissesKeyboard(.interactively)
    }
}
