import DIPCore
import DIPDesignSystem
import PhotosUI
import SwiftUI

#if canImport(UIKit)
    import UIKit
#endif

/// The entry sheet: explains the requirement, how to submit, the window and the reward first, then the form (progress,
/// note, optional photo), a review summary and one Send button. The draft survives a failure; Send is idempotent, so a
/// retry can never submit twice. Flat tinted surfaces, 44 pt targets, Figtree for buttons.
struct DIPChallengeSubmissionSheet: View {
    let model: ChallengeSubmissionModel
    @State private var pickerItem: PhotosPickerItem?
    @State private var showsPicker = false
    @State private var showsDiscard = false
    @FocusState private var focus: Field?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private enum Field { case progress, note }
    private var ink: Color { DIPTokens.Color.textPrimary.swiftUIColor }
    private var muted: Color { DIPTokens.Color.surfaceMuted.swiftUIColor }
    private var accent: Color { DIPTokens.Color.actionPrimary.swiftUIColor }
    private var issues: [DIPSubmissionIssue] { model.showsIssues ? model.issues : [] }

    var body: some View {
        @Bindable var model = model
        ScrollView {
            VStack(alignment: .leading, spacing: DIPTokens.Spacing.sectionGap) {
                header
                explain
                progressField($model.draft.progressText)
                noteField($model.draft.caption)
                photoSection
                review
            }
            .padding(.horizontal, DIPTokens.Spacing.contentInset)
            .padding(.top, 22).padding(.bottom, 24)
            .disabled(model.phase.isBusy)
        }
        .scrollIndicators(.hidden)
        .accessibilityIdentifier("submission.sheet")
        .scrollDismissesKeyboard(.interactively)
        .background(DIPTokens.Color.surfaceDefault.swiftUIColor)
        .safeAreaInset(edge: .bottom, spacing: 0) { bottomBar }
        .presentationDetents([.large])
        .presentationCornerRadius(DIPTokens.Radius.navigation)
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled(model.phase.isBusy || model.needsDiscardConfirmation)
        .preferredColorScheme(.light)
        .photosPicker(isPresented: $showsPicker, selection: $pickerItem, matching: .images)
        .onChange(of: pickerItem) { _, item in importPhoto(item) }
        .onChange(of: model.submittedCount) { _, _ in
            DIPHaptics.success()
            announce("Entry sent")
            dismiss()
        }
        .onChange(of: model.failure) { _, failure in
            guard let failure else { return }
            DIPHaptics.failure(); announce(failure.message)
        }
    }

    // MARK: Sections

    private var header: some View {
        HStack(spacing: DIPTokens.Spacing.related) {
            DIPHeader(title: model.submission == nil ? "Add your entry" : "Update your entry")
            Button {
                if model.needsDiscardConfirmation { showsDiscard = true } else { dismiss() }
            } label: {
                Image(systemName: "xmark").font(.system(size: 16, weight: .semibold)).foregroundStyle(ink)
                    .frame(width: 44, height: 44).background(muted, in: Circle()).contentShape(Circle())
            }
            .buttonStyle(DIPPressFeedbackStyle())
            .disabled(model.phase.isBusy)
            .accessibilityLabel("Close")
            .accessibilityIdentifier("submission.close")
            .confirmationDialog("Discard your changes?", isPresented: $showsDiscard, titleVisibility: .visible) {
                Button("Discard", role: .destructive) { dismiss() }
                Button("Keep editing", role: .cancel) {}
            }
        }
    }

    /// Requirement, window and reward come before the form (testing finding: explain before submit).
    private var explain: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(model.challenge.title.uppercased())
                .font(DIPReferenceAssets.font("FjallaOne-Regular", size: 34, relativeTo: .largeTitle))
                .foregroundStyle(ink)
                .accessibilityAddTraits(.isHeader)
            Text(DIPSubmissionCopy.explain)
                .font(DIPReferenceAssets.font("Inter-Regular", size: 16, relativeTo: .body))
                .foregroundStyle(ink)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("submission.explain")
            VStack(alignment: .leading, spacing: 8) {
                fact("target", "Goal", model.goalText)
                fact("calendar", "Window", model.challenge.timing)
                if let reward = model.challenge.rewardText { fact("gift", "Reward", reward) }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(accent.opacity(0.07), in: RoundedRectangle(cornerRadius: DIPTokens.Radius.card, style: .continuous))
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("submission.facts")
        }
    }

    private func fact(_ icon: String, _ label: String, _ value: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon).foregroundStyle(accent).frame(width: 24).accessibilityHidden(true)
            Text(value).font(DIPReferenceAssets.font("Inter-Regular", size: 15, relativeTo: .body)).foregroundStyle(ink)
            Spacer(minLength: 0)
        }
        .frame(minHeight: 28)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(label): \(value)")
    }

    private func progressField(_ text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            label("How much did you do?", hint: "Goal: \(model.goalText)")
            TextField("", text: text, prompt: Text("For example 3"))
                .keyboardType(.decimalPad)
                .font(DIPReferenceAssets.font("Inter-Regular", size: 16, relativeTo: .body))
                .foregroundStyle(ink)
                .focused($focus, equals: .progress)
                .padding(.horizontal, 16)
                .frame(minHeight: DIPTokens.Spacing.minimumTouchTarget + 8)
                .background(muted, in: RoundedRectangle(cornerRadius: DIPTokens.Radius.card, style: .continuous))
                .accessibilityLabel("How much did you do")
                .accessibilityHint("Goal: \(model.goalText)")
                .accessibilityIdentifier("submission.progress")
            issueText(issues.first { if case .captionTooLong = $0 { false } else { true } }, id: "submission.progress.issue")
        }
    }

    private func noteField(_ text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            label("Add a note", hint: "Optional")
            TextField("", text: text, prompt: Text("What did you do, and who joined you?"), axis: .vertical)
                .font(DIPReferenceAssets.font("Inter-Regular", size: 16, relativeTo: .body))
                .foregroundStyle(ink)
                .lineLimit(3...6)
                .focused($focus, equals: .note)
                .padding(16)
                .frame(maxWidth: .infinity, minHeight: 96, alignment: .topLeading)
                .background(muted, in: RoundedRectangle(cornerRadius: DIPTokens.Radius.card, style: .continuous))
                .accessibilityLabel("Note")
                .accessibilityHint("Optional. Up to \(DIPSubmissionPolicy.maxCaption) characters.")
                .accessibilityIdentifier("submission.note")
            if model.draft.captionCount > DIPSubmissionPolicy.maxCaption - 40 {
                Text("\(model.draft.captionCount) / \(DIPSubmissionPolicy.maxCaption)")
                    .font(DIPReferenceAssets.font("Inter-Regular", size: 13, relativeTo: .footnote))
                    .foregroundStyle(ink.opacity(model.draft.captionCount > DIPSubmissionPolicy.maxCaption ? 1 : 0.72))
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .accessibilityIdentifier("submission.note.counter")
            }
            issueText(issues.first { if case .captionTooLong = $0 { true } else { false } }, id: "submission.note.issue")
        }
    }

    private var photoSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            label("Add a photo", hint: "Optional")
            if let thumbnail = model.photo?.thumbnail, let image = Self.image(from: thumbnail) {
                photoRow(Image(uiImage: image), title: "Photo ready to send")
            } else if model.keepsExistingPhoto {
                photoRow(nil, title: "Your current photo stays attached")
            } else {
                DIPButton("Choose a photo", emphasis: .secondary, isLoading: model.phase == .preparingPhoto) {
                    focus = nil; showsPicker = true
                }
                .accessibilityHint(DIPSubmissionCopy.photoRules)
                .accessibilityIdentifier("submission.photo.choose")
            }
            Text(DIPSubmissionCopy.photoRules)
                .font(DIPReferenceAssets.font("Inter-Regular", size: 13, relativeTo: .footnote))
                .foregroundStyle(ink.opacity(0.72))
        }
    }

    private func photoRow(_ image: Image?, title: String) -> some View {
        HStack(spacing: 14) {
            Group {
                if let image { image.resizable().scaledToFill() } else {
                    Image(systemName: "photo").font(.system(size: 22)).foregroundStyle(accent)
                }
            }
            .frame(width: 72, height: 72).background(muted).clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .accessibilityHidden(true)
            Text(title).font(DIPReferenceAssets.font("Inter-Regular", size: 15, relativeTo: .body)).foregroundStyle(ink)
            Spacer(minLength: 0)
            Button {
                DIPHaptics.select(); pickerItem = nil; model.removePhoto()
            } label: {
                Image(systemName: "trash").font(.system(size: 17, weight: .semibold)).foregroundStyle(ink)
                    .frame(width: 44, height: 44).background(muted, in: Circle()).contentShape(Circle())
            }
            .buttonStyle(DIPPressFeedbackStyle())
            .accessibilityLabel("Remove photo")
            .accessibilityIdentifier("submission.photo.remove")
        }
        .padding(12)
        .background(muted.opacity(0.6), in: RoundedRectangle(cornerRadius: DIPTokens.Radius.card, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("submission.photo")
    }

    /// Review before sending: exactly what will be sent.
    private var review: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Review").font(DIPReferenceAssets.font("Figtree-Bold", size: 16, relativeTo: .headline)).accessibilityAddTraits(.isHeader)
            summaryRow("Progress", model.draft.progress.map { "\(DIPSubmissionDraft.format($0)) of \(model.goalText)" } ?? "Not entered")
            summaryRow("Note", model.draft.trimmedCaption.isEmpty ? "None" : model.draft.trimmedCaption)
            summaryRow("Photo", model.hasPhoto ? "Attached" : "None")
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(muted.opacity(0.6), in: RoundedRectangle(cornerRadius: DIPTokens.Radius.card, style: .continuous))
        .font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .subheadline))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("submission.review")
    }

    private func summaryRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(label).foregroundStyle(ink.opacity(0.72))
            Spacer(minLength: 8)
            Text(value).foregroundStyle(ink).multilineTextAlignment(.trailing).lineLimit(3)
        }
        .accessibilityElement(children: .combine)
    }

    // MARK: Bar

    private var bottomBar: some View {
        VStack(spacing: 10) {
            if let message = barMessage {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: model.failure == nil ? "arrow.up.circle" : "exclamationmark.circle").font(.system(size: 20)).accessibilityHidden(true)
                    Text(message).font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .subheadline))
                    if case .uploading(let value) = model.phase { ProgressView(value: value).tint(accent).frame(maxWidth: 80).accessibilityHidden(true) }
                }
                .foregroundStyle(ink)
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(DIPTokens.Color.notificationAccent.swiftUIColor.opacity(model.failure == nil ? 0.18 : 0.35),
                            in: RoundedRectangle(cornerRadius: DIPTokens.Radius.card, style: .continuous))
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier(model.failure == nil ? "submission.progress.status" : "submission.error")
            }
            DIPButton(sendTitle, isLoading: model.phase.isBusy, isEnabled: model.phase.isBusy || model.canSend || !model.showsIssues) {
                focus = nil
                // A valid press is a commit (the outcome is felt after); an invalid one is a failure tap.
                if model.canSend { DIPHaptics.commit() } else { DIPHaptics.failure() }
                Task { await model.send() }
            }
            .accessibilityIdentifier("submission.send")
        }
        .padding(.horizontal, DIPFloatingNavigation.horizontalInset)
        .padding(.top, 10).padding(.bottom, 10)
        .background(DIPTokens.Color.surfaceDefault.swiftUIColor)
        .animation(DIPMotion.navigation(reduceMotion: reduceMotion), value: barMessage)
    }

    private var sendTitle: String {
        if let failure = model.failure, failure.isRetryable { return "Try again" }
        return model.submission?.status == .rejected ? "Resubmit entry" : (model.submission == nil ? "Send entry" : "Save changes")
    }

    private var barMessage: String? {
        switch model.phase {
        case .preparingPhoto: "Getting your photo ready"
        case .uploading(let value): "Uploading photo \(Int((value * 100).rounded()))%"
        case .sending: "Sending your entry"
        case .failed(let failure): failure.message
        case .idle: nil
        }
    }

    // MARK: Helpers

    private func label(_ title: String, hint: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).font(DIPReferenceAssets.font("Figtree-Bold", size: 16, relativeTo: .headline)).foregroundStyle(ink)
            Text(hint).font(DIPReferenceAssets.font("Inter-Regular", size: 13, relativeTo: .footnote)).foregroundStyle(ink.opacity(0.72))
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private func issueText(_ issue: DIPSubmissionIssue?, id: String) -> some View {
        if let issue {
            Label(issue.message, systemImage: "exclamationmark.circle")
                .font(DIPReferenceAssets.font("Inter-Regular", size: 13, relativeTo: .footnote))
                .foregroundStyle(ink)
                .accessibilityIdentifier(id)
        }
    }

    private func importPhoto(_ item: PhotosPickerItem?) {
        guard let item else { return }
        Task {
            await model.pickPhoto { () async throws -> Data in
                guard let data = try await item.loadTransferable(type: Data.self) else { throw AlbumImageProcessing.Failure.unreadable }
                return data
            }
            pickerItem = nil
        }
    }

    private func announce(_ text: String) {
        #if canImport(UIKit)
            AccessibilityNotification.Announcement(text).post()
        #endif
    }

    private static func image(from data: Data) -> UIImage? {
        #if canImport(UIKit)
            UIImage(data: data)
        #else
            nil
        #endif
    }
}
