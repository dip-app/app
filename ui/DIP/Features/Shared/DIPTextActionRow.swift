import DIPDesignSystem
import SwiftUI

/// The app's one text action style, for secondary and destructive actions (See what changed, Leave Activity, Sign out,
/// Read more, Mark all as read): no fill, so it never competes with the page's one solid primary, and at least 44 pt
/// tall. Inter semibold ink text with an optional purple glyph; destructive actions use the error red (5.6:1 on white).
/// `inline` hugs its text (Read more under a paragraph, Mark all as read on a header) instead of spanning the row.
struct DIPTextActionRow: View {
    enum Role { case standard, destructive }

    let title: String
    var systemImage: String?
    var role: Role = .standard
    /// Centered for a page's last action (Leave, Sign out); leading when it sits in a column of content.
    var centered = false
    /// Trailing chevron: the action opens another view.
    var opensView = false
    /// Hugs the text instead of spanning the row.
    var inline = false
    let action: () -> Void

    static let font = DIPReferenceAssets.font("Inter-Regular", size: 15, relativeTo: .body).weight(.semibold)

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
                    .font(Self.font)
                    .foregroundStyle(role == .destructive ? DIPTokens.Color.textError.swiftUIColor : DIPTokens.Color.textPrimary.swiftUIColor)
                    .multilineTextAlignment(centered ? .center : .leading)
                    .fixedSize(horizontal: false, vertical: true)
                if opensView {
                    if !centered && !inline { Spacer(minLength: 0) }
                    Image(systemName: "chevron.right")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor.opacity(0.6))
                        .accessibilityHidden(true)
                }
            }
            .frame(maxWidth: inline ? nil : .infinity, minHeight: 44, alignment: centered ? .center : .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(DIPRowPressStyle(cornerRadius: inline ? 8 : 12))
    }
}
