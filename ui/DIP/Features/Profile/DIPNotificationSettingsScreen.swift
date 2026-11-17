import DIPCore
import DIPDesignSystem
import DIPPresentation
import SwiftUI

/// Profile > Notifications: the iOS permission state, one switch per push category, and a card explaining that each
/// activity's bell (in its chat) overrides chat, change and reminder alerts. Presented as a sheet, like the other
/// Profile destinations, so it also works in the open iPhone Duo layout (`dipDuoSheetSizing`).
struct DIPNotificationSettingsScreen: View {
    let model: DIPNotificationSettingsModel
    let onClose: () -> Void
    @Environment(\.scenePhase) private var scenePhase
    @ScaledMetric(relativeTo: .body) private var iconWidth: CGFloat = 28

    var body: some View {
        VStack(spacing: 0) {
            InviteSheetHeader(title: "Notifications", closeIdentifier: "notificationSettings.close", onClose: onClose)
            ScrollView {
                VStack(alignment: .leading, spacing: 20) { content }
                    .padding(.horizontal, 20).padding(.top, 4).padding(.bottom, 40)
            }
            .scrollIndicators(.hidden)
        }
        .background(.white)
        .preferredColorScheme(.light)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .task { await model.load() }
        // A permission changed in iOS Settings shows up when the member comes back.
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await model.refreshPermission() } }
        }
        .onChange(of: model.saveError) { _, error in
            guard let error else { return }
            DIPHaptics.failure()
            AccessibilityNotification.Announcement(error).post()
        }
        .accessibilityIdentifier("notificationSettings.screen")
    }

    @ViewBuilder private var content: some View {
        switch model.phase {
        case .loading:
            ProgressView("Loading settings…")
                .frame(maxWidth: .infinity).padding(.top, 40)
                .accessibilityIdentifier("notificationSettings.loading")
        case .failed(let message):
            DIPEmptyState(screen: "notification-settings-error", title: "Couldn’t load settings", message: message, faces: 3,
                          actionTitle: "Try again", action: { DIPHaptics.select(); Task { await model.load() } })
        case .ready:
            master
            if let error = model.saveError { saveError(error) }
            ForEach(DIPNotificationSettingsModel.Section.allCases, id: \.self) { section in
                switches(section)
            }
            perActivityCard
        }
    }

    // MARK: Permission row

    private var master: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: model.canReceivePush ? "bell.badge" : "bell.slash")
                    .font(.system(size: 20, weight: .regular))
                    .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor)
                    .frame(width: iconWidth).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(model.masterTitle)
                        .font(DIPReferenceAssets.font("Figtree-Regular", size: 18, relativeTo: .body))
                        .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor)
                        .accessibilityAddTraits(.isHeader)
                    if let detail = model.masterDetail {
                        Text(detail)
                            .font(DIPReferenceAssets.font("Inter-Regular", size: 13, relativeTo: .footnote))
                            .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor.opacity(0.8))
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }
            if let title = model.masterActionTitle {
                DIPButton(title) {
                    DIPHaptics.select()
                    Task { await model.performMasterAction() }
                }
                .accessibilityIdentifier("notificationSettings.master.action")
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DIPTokens.Color.surfaceMuted.swiftUIColor,
                    in: RoundedRectangle(cornerRadius: DIPTokens.Radius.card, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("notificationSettings.master")
    }

    // MARK: Switches

    private func switches(_ section: DIPNotificationSettingsModel.Section) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(section.title.uppercased())
                .font(DIPReferenceAssets.font("FjallaOne-Regular", size: 24, relativeTo: .title2))
                .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor)
                .accessibilityAddTraits(.isHeader)
            if !model.canReceivePush {
                Text(DIPNotificationSettingsModel.disabledFootnote)
                    .font(DIPReferenceAssets.font("Inter-Regular", size: 13, relativeTo: .footnote))
                    .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor.opacity(0.8))
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("notificationSettings.footnote")
            }
            ForEach(model.rows(in: section)) { row in toggleRow(row, enabled: model.areSwitchesEnabled) }
        }
    }

    private func toggleRow(_ row: DIPNotificationSettingsModel.Row, enabled: Bool) -> some View {
        Toggle(isOn: Binding(
            get: { row.isOn },
            set: { value in DIPHaptics.select(); Task { await model.toggle(row.category, to: value) } })
        ) {
            VStack(alignment: .leading, spacing: 2) {
                Text(row.title)
                    .font(DIPReferenceAssets.font("Figtree-Regular", size: 18, relativeTo: .body))
                    .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor)
                Text(row.summary)
                    .font(DIPReferenceAssets.font("Inter-Regular", size: 13, relativeTo: .footnote))
                    .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor.opacity(0.8))
            }
        }
        .tint(DIPTokens.Color.actionPrimary.swiftUIColor)
        .disabled(!enabled)
        .padding(16)
        .background(DIPTokens.Color.surfaceMuted.swiftUIColor,
                    in: RoundedRectangle(cornerRadius: DIPTokens.Radius.card, style: .continuous))
        .opacity(enabled ? 1 : 0.5)
        .accessibilityHint(enabled ? "" : "Turn on push notifications first")
        .accessibilityIdentifier("notificationSettings.toggle.\(row.category.rawValue)")
    }

    // MARK: Cards

    private func saveError(_ text: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            InviteNotice(text: text, identifier: "notificationSettings.error")
            HStack(spacing: 16) {
                Button("Try again") { DIPHaptics.select(); Task { await model.retryFailedChange() } }
                    .accessibilityIdentifier("notificationSettings.error.retry")
                Button("Dismiss") { model.dismissSaveError() }
                    .accessibilityIdentifier("notificationSettings.error.dismiss")
            }
            .font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .footnote))
            .tint(DIPTokens.Color.actionPrimary.swiftUIColor)
        }
    }

    /// Tinted info card (locked decision: tinted, not outlined).
    private var perActivityCard: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "bell").font(.system(size: 20, weight: .regular))
                .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor)
                .frame(width: iconWidth).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(DIPNotificationSettingsModel.perActivityTitle)
                    .font(DIPReferenceAssets.font("Figtree-Regular", size: 18, relativeTo: .headline))
                    .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor)
                    .accessibilityAddTraits(.isHeader)
                Text(DIPNotificationSettingsModel.perActivityMessage)
                    .font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .subheadline))
                    .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor.opacity(0.8))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DIPTokens.Color.actionPrimary.swiftUIColor.opacity(0.08),
                    in: RoundedRectangle(cornerRadius: DIPTokens.Radius.card, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("notificationSettings.perActivity")
    }
}
