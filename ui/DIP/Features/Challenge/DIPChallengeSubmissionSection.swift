import DIPCore
import DIPDesignSystem
import SwiftUI

/// "Your entry" on the weekly-theme page: the member's submission status (informational outline pill), what happens
/// next, and the one pressable action (solid button) when an action is possible. Loading, offline and error states use
/// the shared skeleton and empty-state patterns. Points appear only after the server approved the entry.
struct DIPChallengeSubmissionSection: View {
    let model: ChallengeSubmissionModel
    let onAction: () -> Void

    private var accent: Color { DIPTokens.Color.actionPrimary.swiftUIColor }
    private var ink: Color { DIPTokens.Color.textPrimary.swiftUIColor }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(DIPSubmissionCopy.sectionTitle)
                .font(DIPReferenceAssets.font("Figtree-Bold", size: 16, relativeTo: .headline))
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("submission.title")
            switch model.load {
            case .loading: DIPSkeleton(cornerRadius: DIPTokens.Radius.card).frame(height: 96).accessibilityLabel("Loading your entry")
                .accessibilityIdentifier("submission.loading")
            case .failed(let message):
                DIPEmptyState(screen: "submission-load", title: message, message: "Check your connection and try again.",
                              style: .compact, faces: 1, actionTitle: "Try again", action: { DIPHaptics.select(); model.retryLoad() })
            case .ready: content
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(accent.opacity(0.07), in: RoundedRectangle(cornerRadius: 20))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("submission.section")
    }

    @ViewBuilder private var content: some View {
        let state = model.state
        DIPActionPill(title: state.statusLabel, color: pillColor(state), style: .outline, iconLeading: true) {
            Image(systemName: icon(state)).resizable().scaledToFit().accessibilityHidden(true)
        }
        .frame(maxWidth: 260)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Entry status: \(state.statusLabel)")
        .accessibilityIdentifier("submission.status")
        Text(state.detail)
            .font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .body))
            .foregroundStyle(ink)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier("submission.detail")
        if let entry = state.submission { summary(entry) }
        if let title = state.actionTitle {
            DIPButton(title) { onAction() }
                .accessibilityIdentifier("submission.action")
        }
    }

    private func summary(_ entry: DIPSubmission) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            row("Progress", "\(DIPSubmissionDraft.format(entry.progress)) of \(model.goalText)")
            if !entry.caption.isEmpty { row("Note", entry.caption) }
            if entry.hasPhoto { row("Photo", "Attached") }
        }
        .font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .subheadline))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("submission.summary")
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(label).foregroundStyle(ink.opacity(0.72))
            Spacer(minLength: 8)
            Text(value).foregroundStyle(ink).multilineTextAlignment(.trailing)
        }
        .accessibilityElement(children: .combine)
    }

    private func icon(_ state: DIPSubmissionState) -> String {
        switch state {
        case .approved: "checkmark.circle"
        case .rejected: "exclamationmark.circle"
        case .pending: "clock"
        case .upcoming, .missed: "calendar"
        case .notStarted: "square.and.pencil"
        }
    }

    private func pillColor(_ state: DIPSubmissionState) -> Color { accent }
}
