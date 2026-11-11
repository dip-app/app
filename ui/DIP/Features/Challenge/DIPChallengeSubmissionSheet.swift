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
    @State private var showsRemovePhoto = false
    @FocusState private var focus: Field?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private enum Field { case note }
    private var ink: Color { DIPTokens.Color.textPrimary.swiftUIColor }
    private var muted: Color { DIPTokens.Color.surfaceMuted.swiftUIColor }
    private var accent: Color { DIPTokens.Color.actionPrimary.swiftUIColor }
    private var issues: [DIPSubmissionIssue] { model.showsIssues ? model.issues : [] }

    var body: some View {
        @Bindable var model = model
        VStack(spacing: 0) {
            // Pinned: the title and Close stay reachable however far the form is scrolled.
            header
                .padding(.horizontal, DIPTokens.Spacing.contentInset).padding(.top, 22).padding(.bottom, 8)
                .background(DIPTokens.Color.surfaceDefault.swiftUIColor)
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: DIPTokens.Spacing.sectionGap) {
                        if let note = model.submission?.reviewNote, model.submission?.status == .rejected { organizerNote(note) }
                        explain
                        progressControl
                        noteField($model.draft.caption)
                        photoSection
                        statusBanner.id("banner")
                        review
                    }
                    .padding(.horizontal, DIPTokens.Spacing.contentInset)
                    .padding(.top, 12).padding(.bottom, 40)
                    .disabled(model.phase.isBusy)
                }
                .scrollIndicators(.hidden)
                .accessibilityIdentifier("submission.sheet")
                .scrollDismissesKeyboard(.interactively)
                // Progress and failures appear in the form, so bring them into view instead of behind the bar.
                .onChange(of: barMessage) { _, message in
                    guard message != nil else { return }
                    withAnimation(DIPMotion.navigation(reduceMotion: reduceMotion)) { proxy.scrollTo("banner", anchor: .center) }
                }
            }
        }
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
            DIPHaptics.failure(); announce(model.uploadFailed ? Self.uploadFailedMessage : failure.message)
        }
    }

    static let uploadFailedMessage = "Your photo didn’t upload. Try again, or send without it."

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

    /// The organizer's reason for sending the entry back, at the top of the resubmission form.
    private func organizerNote(_ note: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "exclamationmark.circle").foregroundStyle(DIPTokens.Color.eventsAccent.swiftUIColor)
                .frame(width: 24).padding(.top, 2).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text("Organizer note").font(DIPReferenceAssets.font("Figtree-Bold", size: 16, relativeTo: .headline))
                    .accessibilityAddTraits(.isHeader)
                Text(note).font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .body))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .foregroundStyle(ink)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DIPTokens.Color.eventsAccent.swiftUIColor.opacity(0.12), in: RoundedRectangle(cornerRadius: DIPTokens.Radius.card, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("submission.organizer-note")
    }

    /// Requirement, window and reward come before the form (testing finding: explain before submit).
    private var explain: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(model.challenge.title.uppercased())
                .font(DIPReferenceAssets.font("FjallaOne-Regular", size: 34, relativeTo: .largeTitle))
                .foregroundStyle(ink)
                .accessibilityAddTraits(.isHeader)
            Text(DIPSubmissionCopy.sheetIntro)
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

    /// Touch-friendly count: a big live readout, a stepped slider (haptic detent per step, the goal marks the end) and
    /// -/+ buttons for exact values. No keyboard. VoiceOver adjusts it like any slider; the buttons are labelled.
    private var progressControl: some View {
        VStack(alignment: .leading, spacing: 10) {
            label("How much did you do?", hint: "Goal: \(model.goalText)")
            VStack(spacing: 14) {
                VStack(spacing: 2) {
                    Text(DIPSubmissionDraft.format(model.progressValue))
                        .font(DIPReferenceAssets.font("FjallaOne-Regular", size: 56, relativeTo: .largeTitle))
                        .foregroundStyle(ink).minimumScaleFactor(0.5).lineLimit(1)
                        .contentTransition(.numericText())
                    Text(model.canIncrease ? unitText : "\(unitText) · goal reached").font(DIPReferenceAssets.font("Inter-Regular", size: 15, relativeTo: .body))
                        .foregroundStyle(ink.opacity(0.72)).multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(DIPSubmissionDraft.format(model.progressValue)) of \(model.goalText)")
                .accessibilityIdentifier("submission.progress.value")
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 12) { stepButton(-1); slider; stepButton(1) }
                    VStack(spacing: 10) { slider; HStack { stepButton(-1); Spacer(); stepButton(1) } }
                }
                if model.goal > model.step {
                    HStack {
                        Text(DIPSubmissionDraft.format(model.step))
                        Spacer()
                        Label("Goal \(DIPSubmissionDraft.format(model.goal))", systemImage: "flag.fill").labelStyle(.titleAndIcon)
                    }
                    .font(DIPReferenceAssets.font("Inter-Regular", size: 13, relativeTo: .footnote))
                    .foregroundStyle(ink.opacity(0.72))
                    .accessibilityHidden(true)
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity)
            .background(muted, in: RoundedRectangle(cornerRadius: DIPTokens.Radius.card, style: .continuous))
            .onChange(of: model.progressValue) { _, _ in DIPHaptics.select() }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("submission.progress")
    }

    @ViewBuilder private var slider: some View {
        if model.goal > model.step {
            Slider(value: Binding(get: { model.progressValue }, set: { model.progressValue = $0 }),
                   in: model.step...model.goal, step: model.step)
                .tint(accent)
                .frame(minHeight: DIPTokens.Spacing.minimumTouchTarget)
                .accessibilityLabel("How much did you do")
                .accessibilityValue("\(DIPSubmissionDraft.format(model.progressValue)) of \(model.goalText)")
                .accessibilityIdentifier("submission.progress.slider")
        }
    }

    private func stepButton(_ direction: Double) -> some View {
        let enabled = direction < 0 ? model.canDecrease : model.canIncrease
        return Button { model.nudge(direction) } label: {
            Image(systemName: direction < 0 ? "minus" : "plus").font(.system(size: 20, weight: .semibold))
                .foregroundStyle(ink.opacity(enabled ? 1 : 0.3))
                .frame(width: 48, height: 48).background(DIPTokens.Color.surfaceDefault.swiftUIColor, in: Circle())
                .overlay(Circle().strokeBorder(ink.opacity(enabled ? 0.12 : 0.06), lineWidth: 1))
                .contentShape(Circle())
        }
        .buttonStyle(DIPPressFeedbackStyle())
        .disabled(!enabled)
        .accessibilityLabel(direction < 0 ? "Decrease" : "Increase")
        .accessibilityValue(DIPSubmissionDraft.format(model.progressValue))
        .accessibilityIdentifier(direction < 0 ? "submission.progress.decrease" : "submission.progress.increase")
    }

    private var unitText: String { "of \(model.goalText)" }

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
                existingPhoto
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

    /// Resubmitting or editing: the actual submitted photo (large preview via the member's Storage read), with
    /// Replace and Remove; it stays attached unless one of those is used.
    private var existingPhoto: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Existing photo").font(DIPReferenceAssets.font("Figtree-Bold", size: 16, relativeTo: .headline)).foregroundStyle(ink)
                .accessibilityAddTraits(.isHeader)
            Group {
                switch model.evidence {
                case .loaded(let data):
                    if let image = Self.image(from: data) {
                        Image(uiImage: image).resizable().scaledToFill()
                            .frame(maxWidth: .infinity).aspectRatio(4 / 3, contentMode: .fill)
                            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                            .accessibilityLabel("Existing photo").accessibilityAddTraits(.isImage)
                    }
                case .failed:
                    VStack(spacing: 10) {
                        Text("Couldn’t load your photo.").font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .subheadline)).foregroundStyle(ink)
                        DIPButton("Try again", emphasis: .secondary) { DIPHaptics.select(); Task { await model.loadEvidence(force: true) } }
                            .accessibilityIdentifier("submission.existing.retry")
                    }
                    .frame(maxWidth: .infinity).padding(16)
                    .background(DIPTokens.Color.surfaceDefault.swiftUIColor, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                case .none, .loading:
                    DIPSkeleton(cornerRadius: 16).frame(maxWidth: .infinity).aspectRatio(4 / 3, contentMode: .fit)
                        .accessibilityLabel("Loading your photo")
                }
            }
            .accessibilityIdentifier("submission.existing.preview")
            HStack(spacing: 12) {
                DIPButton("Replace photo", emphasis: .secondary, isLoading: model.phase == .preparingPhoto) {
                    focus = nil; showsPicker = true
                }
                .accessibilityIdentifier("submission.existing.replace")
                Button { showsRemovePhoto = true } label: {
                    Image(systemName: "trash").font(.system(size: 17, weight: .semibold)).foregroundStyle(ink)
                        .frame(width: 48, height: 48).background(muted, in: Circle()).contentShape(Circle())
                }
                .buttonStyle(DIPPressFeedbackStyle())
                .accessibilityLabel("Remove photo")
                .accessibilityIdentifier("submission.photo.remove")
                .confirmationDialog("Remove this photo?", isPresented: $showsRemovePhoto, titleVisibility: .visible) {
                    Button("Remove photo", role: .destructive) { DIPHaptics.select(); pickerItem = nil; model.removePhoto() }
                    Button("Keep photo", role: .cancel) {}
                }
            }
            Text("It stays attached unless you replace or remove it.")
                .font(DIPReferenceAssets.font("Inter-Regular", size: 13, relativeTo: .footnote)).foregroundStyle(ink.opacity(0.72))
        }
        .padding(12)
        .background(muted.opacity(0.6), in: RoundedRectangle(cornerRadius: DIPTokens.Radius.card, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("submission.existing")
        .task { await model.loadEvidence() }
    }

    private func photoRow(_ image: Image?, title: String) -> some View {
        HStack(spacing: 14) {
            Group {
                if let image { image.resizable().scaledToFill() } else {
                    Image(systemName: "photo").font(.system(size: 22)).foregroundStyle(accent)
                }
            }
            .frame(width: 56, height: 56).background(muted).clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .accessibilityHidden(true)
            Text(title).font(DIPReferenceAssets.font("Inter-Regular", size: 15, relativeTo: .body)).foregroundStyle(ink)
            Spacer(minLength: 0)
            Button {
                showsRemovePhoto = true
            } label: {
                Image(systemName: "trash").font(.system(size: 17, weight: .semibold)).foregroundStyle(ink)
                    .frame(width: 44, height: 44).background(muted, in: Circle()).contentShape(Circle())
            }
            .buttonStyle(DIPPressFeedbackStyle())
            .accessibilityLabel("Remove photo")
            .accessibilityIdentifier("submission.photo.remove")
            .confirmationDialog("Remove this photo?", isPresented: $showsRemovePhoto, titleVisibility: .visible) {
                Button("Remove photo", role: .destructive) { DIPHaptics.select(); pickerItem = nil; model.removePhoto() }
                Button("Keep photo", role: .cancel) {}
            }
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

    /// The sheet's one action is the shared bottom-bar pill (same component as "Activity Chat"), like the report sheet.
    private var bottomBar: some View {
        DIPFloatingNavigation(selected: .home, action: model.sheetBarAction, showsTabs: false, onSelect: { _ in }, onAction: barTapped)
            .padding(.horizontal, DIPFloatingNavigation.horizontalInset)
            .padding(.top, 10).padding(.bottom, 10)
            .background(DIPTokens.Color.surfaceDefault.swiftUIColor)
            .animation(DIPMotion.navigation(reduceMotion: reduceMotion), value: model.sheetBarAction)
    }

    private func barTapped() {
        focus = nil
        guard !model.phase.isBusy else { return }
        Task { await model.send() }
    }

    /// Progress and failures live in the form (above Review), not on top of it: neutral while working, yellow only
    /// for failures, with the actions that fit (retry is the main button; remove the photo or send without it).
    @ViewBuilder private var statusBanner: some View {
        // Progress lives in the shared bar (one indicator); the form shows only failures, with their actions.
        if let message = barMessage, model.failure != nil {
            let failed = true
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: failed ? "exclamationmark.circle" : "arrow.up.circle").font(.system(size: 20)).accessibilityHidden(true)
                    Text(message).font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .subheadline))
                }
                if failed, model.uploadFailed, model.hasPhoto {
                    DIPButton("Send without photo", emphasis: .secondary) {
                        DIPHaptics.commit(); Task { await model.sendWithoutPhoto() }
                    }
                    .accessibilityIdentifier("submission.send-without-photo")
                }
            }
            .foregroundStyle(ink)
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background((failed ? DIPTokens.Color.notificationAccent.swiftUIColor.opacity(0.35) : accent.opacity(0.12)),
                        in: RoundedRectangle(cornerRadius: DIPTokens.Radius.card, style: .continuous))
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier(failed ? "submission.error" : "submission.progress.status")
        }
    }

    private var barMessage: String? {
        switch model.phase {
        case .preparingPhoto: "Getting your photo ready"
        case .uploading(let value): "Uploading photo \(Int((value * 100).rounded()))%"
        case .sending: "Sending your entry"
        case .failed(let failure): model.uploadFailed ? Self.uploadFailedMessage : failure.message
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
