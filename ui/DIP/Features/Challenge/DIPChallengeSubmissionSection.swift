import DIPCore
import DIPDesignSystem
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

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
                              actionTitle: "Try again", action: { DIPHaptics.select(); model.retryLoad() })
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
        statusPill(state)
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
            if entry.hasPhoto { photoRow }
        }
        .font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .subheadline))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("submission.summary")
    }

    private var photoRow: some View {
        HStack(alignment: .center, spacing: 12) {
            Text("Photo").foregroundStyle(ink.opacity(0.72))
            Spacer(minLength: 8)
            #if canImport(UIKit)
            if let data = model.evidenceImage, let image = UIImage(data: data) {
                Image(uiImage: image).resizable().scaledToFill().frame(width: 56, height: 56)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .accessibilityHidden(true)
            } else {
                Text("Attached").foregroundStyle(ink)
            }
            #else
            Text("Attached").foregroundStyle(ink)
            #endif
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Photo: attached")
        .accessibilityIdentifier("submission.photo")
        .task(id: model.submission?.storagePath) { await model.loadEvidence() }
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

    /// Informational outline pill (never pressable): hugs its content and is tinted per status, with no icon circle
    /// that could read as a button. Ink text keeps the contrast on every tint.
    private func statusPill(_ state: DIPSubmissionState) -> some View {
        let tint = pillColor(state)
        return HStack(spacing: 8) {
            Image(systemName: icon(state)).font(.system(size: 15, weight: .semibold)).foregroundStyle(tint == neutral ? ink.opacity(0.6) : (state.isApproved ? ink : tint))
                .accessibilityHidden(true)
            Text(state.statusLabel).font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .subheadline)).foregroundStyle(ink)
        }
        .padding(.horizontal, 14).frame(minHeight: 36)
        .background(tint.opacity(0.14), in: Capsule())
        .overlay(Capsule().strokeBorder(tint, lineWidth: 2))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Entry status: \(state.statusLabel)")
        .accessibilityIdentifier("submission.status")
    }

    private var neutral: Color { ink.opacity(0.35) }

    private func pillColor(_ state: DIPSubmissionState) -> Color {
        switch state {
        case .approved: DIPTokens.Color.notificationAccent.swiftUIColor
        case .rejected: DIPTokens.Color.eventsAccent.swiftUIColor
        case .pending: accent
        case .notStarted, .upcoming, .missed: neutral
        }
    }
}

private extension DIPSubmissionState {
    var isApproved: Bool { if case .approved = self { true } else { false } }
}
