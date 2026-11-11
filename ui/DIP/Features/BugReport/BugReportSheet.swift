import DIPCore
import DIPDesignSystem
import SwiftUI

#if canImport(UIKit)
    import UIKit
#endif

/// The "Report a problem" sheet (spec: shake-report-spec.md §2). Calm, fast, anonymous by design: the member sees
/// the screenshot and every field that will be sent before pressing Send.
struct BugReportSheet: View {
    @State private var model: BugReportFormModel
    @State private var showsDiscard = false
    @State private var detailsExpanded = false
    @State private var crewUp = false
    @State private var showsMarkup = false
    @FocusState private var descriptionFocused: Bool
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    init(model: BugReportFormModel) { _model = State(initialValue: model) }

    private var ink: Color { DIPTokens.Color.textPrimary.swiftUIColor }
    private var muted: Color { DIPTokens.Color.surfaceMuted.swiftUIColor }
    private var accent: Color { DIPTokens.Color.actionPrimary.swiftUIColor }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DIPTokens.Spacing.sectionGap) {
                header
                intro
                categories
                description
                screenshot
                included
                Text("We never attach your name or email. Reports go to the DIP team only. Blur or remove anything private before sending.")
                    .font(DIPReferenceAssets.font("Inter-Regular", size: 13, relativeTo: .footnote))
                    .foregroundStyle(ink.opacity(0.72))
                    .accessibilityIdentifier("report.privacy")
            }
            .padding(.horizontal, DIPTokens.Spacing.contentInset)
            .padding(.top, 22)
            .padding(.bottom, 24)
            .disabled(model.isSending || model.isFinished)
            .opacity(model.isSending ? 0.6 : 1)
        }
        .scrollIndicators(.hidden)
        .accessibilityIdentifier("report.sheet")
        .scrollDismissesKeyboard(.interactively)
        .background(DIPTokens.Color.surfaceDefault.swiftUIColor)
        .safeAreaInset(edge: .bottom, spacing: 0) { bottomBar }
        .presentationDetents([.large])
        .presentationCornerRadius(DIPTokens.Radius.navigation)
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled(model.isSending || model.needsDiscardConfirmation)
        .preferredColorScheme(.light)
        .onChange(of: model.phase) { _, phase in handle(phase) }
    }

    // MARK: Sections

    private var header: some View {
        HStack(spacing: DIPTokens.Spacing.related) {
            DIPHeader(title: "Report a problem")
            Button {
                if model.needsDiscardConfirmation { showsDiscard = true } else { dismiss() }
            } label: {
                Image(systemName: "xmark").font(.system(size: 16, weight: .semibold)).foregroundStyle(ink)
                    .frame(width: 44, height: 44).background(muted, in: Circle()).contentShape(Circle())
            }
            .buttonStyle(DIPPressFeedbackStyle())
            .disabled(model.isSending)
            .accessibilityLabel("Close")
            .accessibilityIdentifier("report.close.button")
            .confirmationDialog("Discard this report?", isPresented: $showsDiscard, titleVisibility: .visible) {
                Button("Discard", role: .destructive) { dismiss() }
                Button("Keep editing", role: .cancel) {}
            }
        }
    }

    private var intro: some View {
        VStack(alignment: .leading, spacing: DIPTokens.Spacing.related) {
            Text("SOMETHING NOT RIGHT?")
                .font(DIPReferenceAssets.font("FjallaOne-Regular", size: 34, relativeTo: .largeTitle))
                .foregroundStyle(ink)
                .accessibilityAddTraits(.isHeader)
            Text("Tell us what happened. A screenshot and a few app details help us fix it faster.")
                .font(DIPReferenceAssets.font("Inter-Regular", size: 16, relativeTo: .body))
                .foregroundStyle(ink)
        }
    }

    private var categories: some View {
        ReportChipFlow(spacing: 8, lineSpacing: 8) {
            ForEach(BugReportCategory.selectable, id: \.self) { category in
                let selected = model.draft.category == category
                Button {
                    DIPHaptics.select()
                    withAnimation(.easeOut(duration: 0.2)) { model.select(category) }
                } label: {
                    HStack(spacing: 6) {
                        if selected { Image(systemName: "checkmark").font(.system(size: 13, weight: .bold)) }
                        Text(category.title)
                            .font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .subheadline))
                    }
                    .foregroundStyle(ink)
                    .padding(.horizontal, 12)
                    .frame(minHeight: DIPTokens.Spacing.minimumTouchTarget)
                    .background(selected ? accent : muted, in: Capsule())
                    .overlay(Capsule().strokeBorder(ink.opacity(selected ? 0 : 0.12), lineWidth: 1))
                    .contentShape(Capsule())
                }
                .buttonStyle(DIPPressFeedbackStyle())
                .accessibilityLabel("\(category.title), category")
                .accessibilityAddTraits(selected ? [.isSelected, .isButton] : .isButton)
                .accessibilityIdentifier("report.category.\(category.rawValue)")
            }
        }
    }

    private var description: some View {
        VStack(alignment: .trailing, spacing: 6) {
            TextField(
                "", text: Binding(get: { model.draft.text }, set: { model.setText($0) }),
                prompt: Text("What were you trying to do, and what happened instead?"), axis: .vertical
            )
            .font(DIPReferenceAssets.font("Inter-Regular", size: 16, relativeTo: .body))
            .foregroundStyle(ink)
            .lineLimit(4...8)
            .focused($descriptionFocused)
            .padding(16)
            .frame(maxWidth: .infinity, minHeight: 120, alignment: .topLeading)
            .background(muted, in: RoundedRectangle(cornerRadius: DIPTokens.Radius.card, style: .continuous))
            .accessibilityLabel("Description")
            .accessibilityHint("Optional. Up to 1,000 characters.")
            .accessibilityIdentifier("report.description")
            if model.draft.showsCounter || model.trimmedNotice {
                Text(model.trimmedNotice ? "Trimmed to 1,000 characters"
                     : "\(model.draft.characterCount) / \(BugReportDraft.maximumCharacters)")
                    .font(DIPReferenceAssets.font("Inter-Regular", size: 13, relativeTo: .footnote))
                    .foregroundStyle(ink.opacity(model.draft.isNearLimit ? 1 : 0.72))
                    .accessibilityIdentifier("report.counter")
            }
        }
    }

    @ViewBuilder private var screenshot: some View {
        if let data = model.screenshotToSend, let image = Self.image(from: data) {
            let included = model.draft.includesScreenshot
            HStack(alignment: .top, spacing: 14) {
                Image(uiImage: image).resizable().scaledToFill()
                    .frame(width: 96, height: 208).clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(muted, lineWidth: 1))
                    .opacity(included ? 1 : 0.3)
                    .accessibilityElement()
                    .accessibilityLabel("Screenshot of \(Self.screenName(model.session.screen))")
                    .accessibilityValue(included ? "Included" : "Not included")
                    .accessibilityIdentifier("report.thumbnail")
                VStack(alignment: .leading, spacing: DIPTokens.Spacing.related) {
                    Toggle("Include screenshot", isOn: $model.draft.includesScreenshot)
                        .font(DIPReferenceAssets.font("Figtree-Regular", size: 17, relativeTo: .body))
                        .tint(accent)
                        .accessibilityIdentifier("report.screenshot.toggle")
                    Text(included ? "This is the screen you were on. It stays on your phone until you send."
                         : "Screenshot won’t be sent.")
                        .font(DIPReferenceAssets.font("Inter-Regular", size: 13, relativeTo: .footnote))
                        .foregroundStyle(ink.opacity(0.72))
                    if included, let original = model.session.screenshot {
                        DIPButton(model.annotatedScreenshot == nil ? "Mark up" : "Edit markup", emphasis: .secondary) {
                            showsMarkup = true
                        }
                        .accessibilityHint("Draw on the screenshot before sending")
                        .accessibilityIdentifier("report.markup")
                        .fullScreenCover(isPresented: $showsMarkup) {
                            ScreenshotMarkupEditor(screenshot: original, markup: model.markup) { result in
                                guard let result else { return }
                                model.applyMarkup(result, rendered: ScreenshotMarkupRenderer.render(base: original, markup: result))
                                announce(result.isEmpty ? "Markup removed" : "Markup added to the screenshot")
                            }
                        }
                    }
                    if included, model.session.screen == .album || model.session.screen == .participants {
                        Text("This screen shows coworkers’ photos. Remove the screenshot if needed.")
                            .font(DIPReferenceAssets.font("Inter-Regular", size: 13, relativeTo: .footnote))
                            .foregroundStyle(ink)
                            .accessibilityIdentifier("report.screenshot.warning")
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(16)
            .background(muted, in: RoundedRectangle(cornerRadius: DIPTokens.Radius.card, style: .continuous))
        } else {
            DIPEmptyState(
                screen: "report-screenshot", title: "No screenshot",
                message: "We couldn’t capture this screen. You can still send your report.",
                style: .compact, faces: 1)
        }
    }

    private var included: some View {
        VStack(alignment: .leading, spacing: DIPTokens.Spacing.related) {
            Toggle("Include app details", isOn: $model.draft.includesDiagnostics)
                .font(DIPReferenceAssets.font("Figtree-Regular", size: 17, relativeTo: .body))
                .tint(accent)
                .accessibilityIdentifier("report.diagnostics.toggle")
            Button {
                withAnimation(DIPMotion.navigation(reduceMotion: reduceMotion)) { detailsExpanded.toggle() }
            } label: {
                HStack {
                    Text("What’s included")
                        .font(DIPReferenceAssets.font("Figtree-Regular", size: 17, relativeTo: .body)).foregroundStyle(ink)
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(ink)
                        .rotationEffect(.degrees(detailsExpanded ? 90 : 0)).accessibilityHidden(true)
                }
                .frame(minHeight: DIPTokens.Spacing.minimumTouchTarget)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(.isButton)
            .accessibilityValue(detailsExpanded ? "Expanded" : "Collapsed")
            .accessibilityIdentifier("report.included")
            if detailsExpanded {
                VStack(alignment: .leading, spacing: 8) {
                    if model.draft.includesDiagnostics {
                        ForEach(detailRows, id: \.0) { row in
                            HStack(alignment: .firstTextBaseline) {
                                Text(row.0).foregroundStyle(ink.opacity(0.72))
                                Spacer(minLength: 12)
                                Text(row.1).foregroundStyle(ink).multilineTextAlignment(.trailing)
                            }
                            .accessibilityElement(children: .combine)
                        }
                    } else {
                        Text("No app details will be sent.").foregroundStyle(ink.opacity(0.72))
                    }
                    Text("Not included: your name, email, photos, or anything you typed elsewhere.")
                        .foregroundStyle(ink).padding(.top, 4)
                }
                .font(DIPReferenceAssets.font("Inter-Regular", size: 15, relativeTo: .subheadline))
                .transition(.opacity)
            }
        }
        .padding(16)
        .background(muted, in: RoundedRectangle(cornerRadius: DIPTokens.Radius.card, style: .continuous))
    }

    private var detailRows: [(String, String)] {
        let d = model.diagnostics
        return [
            ("App", "\(d.appVersion) (\(d.appBuild))"), ("iOS", d.osVersion.replacingOccurrences(of: "iOS ", with: "")),
            ("Device", d.deviceModel), ("Language", d.locale), ("Screen", Self.screenName(d.screen)),
            ("Install", "Random id, not your account"),
        ].filter { !$0.1.contains("unknown") }
    }

    // MARK: Bar

    private var bottomBar: some View {
        VStack(spacing: 10) {
            if model.phase == .editing, !model.draft.canSend {
                Text("Pick a type or add a few words to send.")
                    .font(DIPReferenceAssets.font("Inter-Regular", size: 13, relativeTo: .footnote))
                    .foregroundStyle(ink.opacity(0.72))
                    .accessibilityIdentifier("report.hint")
            }
            if let message = model.failureMessage {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "exclamationmark.circle").font(.system(size: 20)).accessibilityHidden(true)
                    Text(message).font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .subheadline))
                }
                .foregroundStyle(ink)
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(DIPTokens.Color.notificationAccent.swiftUIColor.opacity(0.35),
                            in: RoundedRectangle(cornerRadius: DIPTokens.Radius.card, style: .continuous))
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("report.error")
                .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
            }
            ZStack(alignment: .top) {
                if model.phase == .sent, !reduceMotion {
                    DIPCrewFace(fill: accent, figure: .round, mood: .wink)
                        .frame(width: 40, height: 40)
                        .offset(y: crewUp ? -30 : -6)
                        .animation(.spring(response: 0.36, dampingFraction: 0.62), value: crewUp)
                        .onAppear { crewUp = true }
                        .accessibilityHidden(true)
                }
                DIPFloatingNavigation(
                    selected: .home, action: model.barAction, showsTabs: false, onSelect: { _ in },
                    onAction: barTapped)
            }
        }
        .padding(.horizontal, DIPFloatingNavigation.horizontalInset)
        .padding(.top, 10)
        .padding(.bottom, 10)
        .background(DIPTokens.Color.surfaceDefault.swiftUIColor)
        .animation(DIPMotion.navigation(reduceMotion: reduceMotion), value: model.failureMessage)
    }

    private func barTapped() {
        switch model.phase {
        case .editing, .failed(.offline), .failed(.failed), .failed(.rejected):
            descriptionFocused = false
            Task { await model.send() }
        case .failed(.rateLimited): dismiss()
        case .sending, .sent, .queued: break
        }
    }

    private func handle(_ phase: BugReportFormModel.Phase) {
        switch phase {
        case .sent:
            DIPHaptics.success()
            announce("Report sent. Thank you")
            dismissAfter(1.6)
        case .queued:
            DIPHaptics.success()
            announce("Saved. It will send when you’re online")
            dismissAfter(2.0)
        case .failed:
            DIPHaptics.failure()
            if let message = model.failureMessage { announce(message) }
        case .sending: announce("Sending report")
        case .editing: break
        }
    }

    private func dismissAfter(_ seconds: Double) {
        Task {
            try? await Task.sleep(for: .seconds(seconds))
            dismiss()
        }
    }

    private func announce(_ text: String) {
        #if canImport(UIKit)
            AccessibilityNotification.Announcement(text).post()
        #endif
    }

    // MARK: Helpers

    static func image(from data: Data) -> UIImage? { UIImage(data: data) }

    static func screenName(_ screen: BugReportScreen) -> String {
        switch screen {
        case .home: "Home"
        case .rewards: "Rewards"
        case .myEvents: "My Events"
        case .profile: "Profile"
        case .event: "Event page"
        case .participants: "Attendees"
        case .album: "Album"
        case .challenge: "Weekly theme"
        case .other: "DIP"
        }
    }
}

/// Wraps chips onto as many lines as needed, leading-aligned.
private struct ReportChipFlow: Layout {
    var spacing: CGFloat
    var lineSpacing: CGFloat

    private func rows(_ subviews: Subviews, width: CGFloat) -> [[(Int, CGSize)]] {
        var result: [[(Int, CGSize)]] = [[]]
        var x: CGFloat = 0
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.init(width: width, height: nil))
            if x > 0, x + size.width > width { result.append([]); x = 0 }
            result[result.count - 1].append((index, size))
            x += size.width + spacing
        }
        return result
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let all = rows(subviews, width: proposal.width ?? .infinity)
        let height = all.reduce(0) { $0 + ($1.map(\.1.height).max() ?? 0) } + lineSpacing * CGFloat(max(0, all.count - 1))
        return CGSize(width: proposal.width ?? 0, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in rows(subviews, width: bounds.width) {
            var x = bounds.minX
            for (index, size) in row {
                subviews[index].place(at: CGPoint(x: x, y: y), proposal: .init(size))
                x += size.width + spacing
            }
            y += (row.map(\.1.height).max() ?? 0) + lineSpacing
        }
    }
}
