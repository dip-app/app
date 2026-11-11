import DIPCore
import DIPDesignSystem
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// "Your entry" on the weekly-theme page: the member's submission status (informational pill), what happens next,
/// the entry's numbers and a large preview of the submitted photo (tap for full screen). It exists only once there is an
/// entry (or while it loads or fails to load): with no entry the page shows nothing here, just the single Add entry
/// action in the shared bottom bar. The action itself is never in this card.
struct DIPChallengeSubmissionSection: View {
    let model: ChallengeSubmissionModel
    @State private var showsViewer = false

    private var accent: Color { DIPTokens.Color.actionPrimary.swiftUIColor }
    private var ink: Color { DIPTokens.Color.textPrimary.swiftUIColor }

    @ViewBuilder var body: some View {
        switch model.load {
        case .loading:
            card {
                DIPSkeleton(cornerRadius: DIPTokens.Radius.card).frame(height: 96).accessibilityLabel("Loading your entry")
                    .accessibilityIdentifier("submission.loading")
            }
        case .failed(let message):
            card {
                DIPEmptyState(screen: "submission-load", title: message, message: "Check your connection and try again.",
                              actionTitle: "Try again", action: { DIPHaptics.select(); model.retryLoad() })
            }
        case .ready:
            if let entry = model.state.submission { card { content(entry) } }
        }
    }

    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(DIPSubmissionCopy.sectionTitle)
                .font(DIPReferenceAssets.font("Figtree-Bold", size: 16, relativeTo: .headline))
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("submission.title")
            content()
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(accent.opacity(0.07), in: RoundedRectangle(cornerRadius: 20))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("submission.section")
    }

    @ViewBuilder private func content(_ entry: DIPSubmission) -> some View {
        let state = model.state
        statusPill(state)
        if case .rejected(_, let canResubmit) = state, let note = entry.reviewNote {
            organizerNote(note)
            Text(canResubmit ? "Update your entry and send it again." : "This theme has ended.")
                .font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .body)).foregroundStyle(ink)
                .accessibilityIdentifier("submission.detail")
        } else {
            Text(state.detail)
                .font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .body))
                .foregroundStyle(ink)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("submission.detail")
        }
        VStack(alignment: .leading, spacing: 6) {
            row("Progress", "\(DIPSubmissionDraft.format(entry.progress)) of \(model.goalText)")
            if !entry.caption.isEmpty { row("Note", entry.caption) }
        }
        .font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .subheadline))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("submission.summary")
        if entry.hasPhoto { photoPreview }
    }

    /// The organizer's reason, in the same pink note card as the resubmit sheet.
    private func organizerNote(_ note: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "exclamationmark.circle").foregroundStyle(DIPTokens.Color.eventsAccent.swiftUIColor)
                .frame(width: 24).padding(.top, 2).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text("Organizer note").font(DIPReferenceAssets.font("Figtree-Bold", size: 16, relativeTo: .headline)).accessibilityAddTraits(.isHeader)
                Text(note).font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .body)).fixedSize(horizontal: false, vertical: true)
            }
            .foregroundStyle(ink)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DIPTokens.Color.eventsAccent.swiftUIColor.opacity(0.12), in: RoundedRectangle(cornerRadius: DIPTokens.Radius.card, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("submission.organizer-note")
    }

    // MARK: Photo

    /// Full content width, 4:3, rounded; skeleton while loading, a retry when the read failed.
    @ViewBuilder private var photoPreview: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Photo").font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .subheadline)).foregroundStyle(ink.opacity(0.72))
            Group {
                switch model.evidence {
                case .loaded(let data):
                    #if canImport(UIKit)
                    if let image = UIImage(data: data) {
                        Button { showsViewer = true } label: {
                            Image(uiImage: image).resizable().scaledToFill()
                                .frame(maxWidth: .infinity).aspectRatio(4 / 3, contentMode: .fill)
                                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                                .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                                .overlay(alignment: .bottomTrailing) {
                                    // Visible cue that the photo opens full screen.
                                    Image(systemName: "arrow.up.left.and.arrow.down.right").font(.system(size: 14, weight: .semibold))
                                        .foregroundStyle(ink).frame(width: 36, height: 36)
                                        .background(.white.opacity(0.9), in: Circle()).padding(10).accessibilityHidden(true)
                                }
                        }
                        .buttonStyle(DIPPressFeedbackStyle())
                        .accessibilityLabel("Your photo")
                        .accessibilityHint("Opens it full screen")
                        .accessibilityAddTraits(.isImage)
                        .accessibilityIdentifier("submission.photo.preview")
                        .fullScreenCover(isPresented: $showsViewer) { DIPChallengePhotoViewer(image: image) }
                    }
                    #endif
                case .failed:
                    VStack(spacing: 10) {
                        Text("Couldn’t load your photo.").font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .subheadline)).foregroundStyle(ink)
                        DIPButton("Try again", emphasis: .secondary) { DIPHaptics.select(); Task { await model.loadEvidence(force: true) } }
                            .accessibilityIdentifier("submission.photo.retry")
                    }
                    .frame(maxWidth: .infinity).padding(16)
                    .background(DIPTokens.Color.surfaceDefault.swiftUIColor, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                case .none, .loading:
                    DIPSkeleton(cornerRadius: 16).frame(maxWidth: .infinity).aspectRatio(4 / 3, contentMode: .fit)
                        .accessibilityLabel("Loading your photo")
                        .accessibilityIdentifier("submission.photo.loading")
                }
            }
        }
        .task(id: model.submission?.storagePath) { await model.loadEvidence() }
    }

    // MARK: Pieces

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
            Image(systemName: icon(state)).font(.system(size: 15, weight: .semibold))
                .foregroundStyle(tint == neutral ? ink.opacity(0.6) : (state.isApproved ? ink : tint))
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

#if canImport(UIKit)
/// Full-screen view of the member's own photo: black background, fit to screen, one 44 pt Close.
struct DIPChallengePhotoViewer: View {
    let image: UIImage
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()
            Image(uiImage: image).resizable().scaledToFit().frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityLabel("Your photo")
                .accessibilityAddTraits(.isImage)
                .accessibilityIdentifier("submission.photo.viewer")
            Button { dismiss() } label: {
                Image(systemName: "xmark").font(.system(size: 16, weight: .semibold)).foregroundStyle(.white)
                    .frame(width: 44, height: 44).background(.white.opacity(0.2), in: Circle()).contentShape(Circle())
            }
            .buttonStyle(DIPPressFeedbackStyle())
            .padding(16)
            .accessibilityLabel("Close")
            .accessibilityIdentifier("submission.photo.viewer.close")
        }
        .preferredColorScheme(.dark)
    }
}
#endif
