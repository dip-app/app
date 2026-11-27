import DIPDesignSystem
import SwiftUI

/// A quiet text action for secondary and destructive page actions (See what changed, Leave Activity, Sign out):
/// no fill, so it never competes with the page's one solid primary, and at least 44 pt tall.
/// Destructive actions use the error red (5.6:1 on white); standard ones use ink text with a purple glyph.
struct DIPTextActionRow: View {
    enum Role { case standard, destructive }

    let title: String
    var systemImage: String?
    var role: Role = .standard
    /// Centered for a page's last action (Leave, Sign out); leading when it sits in a column of content.
    var centered = false
    /// Trailing chevron: the action opens another view.
    var opensView = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if let systemImage {
                    Image(systemName: systemImage)
                        .font(.body.weight(.medium))
                        .foregroundStyle(role == .destructive ? DIPTokens.Color.textError.swiftUIColor : DIPTokens.Color.actionPrimary.swiftUIColor)
                        .accessibilityHidden(true)
                }
                Text(title)
                    .font(DIPReferenceAssets.font("Inter-Regular", size: 15, relativeTo: .body))
                    .foregroundStyle(role == .destructive ? DIPTokens.Color.textError.swiftUIColor : DIPTokens.Color.textPrimary.swiftUIColor)
                    .multilineTextAlignment(centered ? .center : .leading)
                    .fixedSize(horizontal: false, vertical: true)
                if opensView {
                    if !centered { Spacer(minLength: 0) }
                    Image(systemName: "chevron.right")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor.opacity(0.6))
                        .accessibilityHidden(true)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 44, alignment: centered ? .center : .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(DIPRowPressStyle())
    }
}
