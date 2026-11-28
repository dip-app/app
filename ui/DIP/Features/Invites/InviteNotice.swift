import DIPDesignSystem
import SwiftUI

/// A short explanation under a control that could not do its job. The app does not use red for errors in
/// flows like this: a pink exclamation mark leads, the sentence is plain ink.
struct InviteNotice: View {
    let text: String
    var identifier: String?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: "exclamationmark.circle.fill")
                .foregroundStyle(DIPTokens.Color.eventsAccent.swiftUIColor).accessibilityHidden(true)
            Text(text).font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .footnote))
                .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(identifier ?? "invite.notice")
    }
}

/// The app's sheet header (invitations, invite, notifications, notification settings, activity chat): the outlined
/// title pill and the muted close circle used by the report and entry sheets. `accessory` sits just before close in the
/// same muted 44 pt circle style (the chat's notification bell).
struct InviteSheetHeader: View {
    let title: String
    var subtitle: String?
    let closeIdentifier: String
    var accessory: AnyView?
    let onClose: () -> Void

    /// The muted circle shared by close and any accessory.
    static func circle(systemName: String) -> some View {
        Image(systemName: systemName).font(.system(size: 16, weight: .semibold))
            .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor)
            .frame(width: 44, height: 44)
            .background(DIPTokens.Color.surfaceMuted.swiftUIColor, in: Circle()).contentShape(Circle())
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: DIPTokens.Spacing.related) {
                DIPHeader(title: title)
                if let accessory { accessory }
                Button(action: onClose) { Self.circle(systemName: "xmark") }
                .buttonStyle(DIPPressFeedbackStyle())
                .accessibilityLabel("Close").accessibilityIdentifier(closeIdentifier)
            }
            if let subtitle {
                Text(subtitle).font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .subheadline))
                    .foregroundStyle(.secondary).lineLimit(2)
                    // Aligned with the title pill's text edge (2 pt border + 20 pt inset).
                    .padding(.leading, 22)
            }
        }
        .padding(.horizontal, 20).padding(.top, 24).padding(.bottom, 14)
    }
}
