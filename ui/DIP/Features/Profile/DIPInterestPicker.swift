import DIPCore
import DIPDesignSystem
import SwiftUI

/// Catalog-backed selection with two hosts:
/// - Sheet (Profile): owns its draft, Save/Cancel toolbar, inline retry and dismisses after saving.
/// - Embedded (onboarding): the host owns the selection, the save, the only retry control and
///   the catalog state. No NavigationStack, no toolbar, no inline retry and never dismisses.
/// Both render the same search field, count, rows, empty state and 10-item rule.
struct DIPInterestPicker: View {
    static let maximumSelection = InterestSelectionRules.maximumSelection

    /// Host-supplied state for the embedded picker.
    struct EmbeddedState: Equatable {
        enum Catalog: Equatable {
            case ready
            /// Six placeholder rows with a shimmer band.
            case loading
            /// No picker; the message explains where interests can be added later.
            case failed(String)
        }
        var isSaving: Bool
        /// Shown as a non-interactive label above the rows. The host's bar is the retry.
        var errorMessage: String?
        var catalog: Catalog
        init(isSaving: Bool = false, errorMessage: String? = nil, catalog: Catalog = .ready) {
            self.isSaving = isSaving; self.errorMessage = errorMessage; self.catalog = catalog
        }
    }

    let options: [DIPInterest]
    private let onSave: (([String]) async throws -> Void)?
    private let embedded: EmbeddedState?
    private let externalSelection: Binding<Set<String>>?
    @State private var ownedSelection: Set<String>
    @State private var query = ""
    @State private var isSaving = false
    @State private var saveError: String?
    @FocusState private var searchFocused: Bool
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    /// Sheet use (Profile): unchanged behaviour.
    init(options: [DIPInterest], selection: Set<String>, onSave: @escaping ([String]) async throws -> Void) {
        self.options = InterestSelectionRules.unique(options)
        _ownedSelection = State(initialValue: selection)
        self.onSave = onSave
        embedded = nil
        externalSelection = nil
    }

    /// Embedded use (onboarding). The host saves and retries; this view only edits `selection`.
    init(options: [DIPInterest], selection: Binding<Set<String>>, embedded: EmbeddedState) {
        self.options = InterestSelectionRules.unique(options)
        _ownedSelection = State(initialValue: [])
        onSave = nil
        self.embedded = embedded
        externalSelection = selection
    }

    var body: some View {
        if let embedded, let externalSelection {
            embeddedBody(embedded, selection: externalSelection)
        } else {
            sheetBody
        }
    }

    private var filtered: [DIPInterest] { InterestSelectionRules.filtered(options, query: query) }

    // MARK: Sheet

    private var sheetBody: some View {
        NavigationStack {
            List {
                Section {
                    InterestSearchField(query: $query, focused: $searchFocused)
                }
                Section {
                    InterestCountLabel(count: ownedSelection.count, compact: false)
                    if !dynamicTypeSize.isAccessibilitySize {
                        Text("Choose the things you enjoy. You can change these anytime.")
                            .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                            .foregroundStyle(.secondary)
                    }
                }
                if filtered.isEmpty {
                    InterestEmptyState(query: query)
                } else {
                    Section("Interests") {
                        InterestRows(options: filtered, selection: $ownedSelection, isSaving: isSaving) {
                            saveError = nil
                        }
                    }
                }
            }
            .disabled(isSaving)
            .safeAreaInset(edge: .top, spacing: 0) {
                if let saveError {
                    VStack(alignment: .leading, spacing: 8) {
                        InterestSaveErrorLabel(message: saveError)
                        Button("Try again") { Task { await save() } }
                            .disabled(isSaving)
                            .accessibilityIdentifier("profile.interests.retry")
                    }
                    .padding(16).frame(maxWidth: .infinity, alignment: .leading)
                    .background(DIPTokens.Color.surfaceDefault.swiftUIColor)
                }
            }
            .navigationTitle("Your interests")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(isSaving)
                        .accessibilityIdentifier("profile.interests.cancel")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Saving…" : "Save") { Task { await save() } }
                        .disabled(isSaving)
                        .accessibilityIdentifier("profile.interests.save")
                }
            }
            .interactiveDismissDisabled(isSaving)
        }
        .tint(DIPTokens.Color.navigationBackground.swiftUIColor)
        .preferredColorScheme(.light)
    }

    @MainActor private func save() async {
        guard let onSave, !isSaving, ownedSelection.count <= Self.maximumSelection else { return }
        searchFocused = false
        isSaving = true
        saveError = nil
        defer { isSaving = false }
        do {
            try await onSave(InterestSelectionRules.ordered(ownedSelection, options: options))
            dismiss()
        } catch {
            saveError = "Couldn’t save your interests. Your choices are kept. Try again."
        }
    }

    // MARK: Embedded

    @ViewBuilder
    private func embeddedBody(_ state: EmbeddedState, selection: Binding<Set<String>>) -> some View {
        switch state.catalog {
        case .loading:
            InterestLoadingRows()
        case .failed(let message):
            Text(message)
                .font(DIPReferenceAssets.font("Inter-Regular", size: 16, relativeTo: .body))
                .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityIdentifier("profile.interests.catalogFailed")
        case .ready:
            VStack(alignment: .leading, spacing: 8) {
                if let message = state.errorMessage {
                    InterestSaveErrorLabel(message: message)
                }
                InterestSearchField(query: $query, focused: $searchFocused)
                    .padding(.horizontal, 12)
                    .background(DIPTokens.Color.surfaceMuted.swiftUIColor, in: Capsule())
                InterestCountLabel(count: selection.wrappedValue.count, compact: true)
                    .padding(.top, 4)
                List {
                    if filtered.isEmpty {
                        InterestEmptyState(query: query)
                            .listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 0, trailing: 4))
                    } else {
                        InterestRows(options: filtered, selection: selection, isSaving: state.isSaving) {}
                            .listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 0, trailing: 4))
                            .listRowBackground(Color.clear)
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
                .scrollDismissesKeyboard(.immediately)
                .disabled(state.isSaving)
            }
            .onChange(of: state.isSaving) { _, saving in if saving { searchFocused = false } }
        }
    }
}

// MARK: Shared subviews (one implementation for both hosts)

private struct InterestSearchField: View {
    @Binding var query: String
    var focused: FocusState<Bool>.Binding

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary).accessibilityHidden(true)
            TextField("Search interests", text: $query)
                .font(DIPReferenceAssets.font("Inter-Regular", size: 16))
                .textInputAutocapitalization(.never).autocorrectionDisabled()
                .focused(focused)
                .submitLabel(.search)
                .accessibilityIdentifier("profile.interests.search")
        }
        .frame(minHeight: 44)
    }
}

private struct InterestCountLabel: View {
    let count: Int
    /// The embedded picker uses a caption; the sheet keeps its headline.
    let compact: Bool

    var body: some View {
        Text("\(count) of \(DIPInterestPicker.maximumSelection) selected")
            .font(compact
                ? DIPReferenceAssets.font("Inter-Regular", size: 13, relativeTo: .footnote)
                : DIPReferenceAssets.font("Figtree-Regular", size: 18, relativeTo: .headline))
            .foregroundStyle(compact ? AnyShapeStyle(DIPTokens.Color.textPrimary.swiftUIColor.opacity(0.7))
                : AnyShapeStyle(.primary))
            .accessibilityIdentifier("profile.interests.count")
    }
}

private struct InterestEmptyState: View {
    let query: String

    var body: some View {
        let blank = query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        VStack(alignment: .leading, spacing: 8) {
            Text(blank ? "No interests yet" : "No matching interests")
                .font(DIPReferenceAssets.font("Figtree-Regular", size: 20, relativeTo: .headline))
            Text(blank ? "Your company's interests will appear here." : "Try a different search.")
                .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 8)
        .accessibilityIdentifier("profile.interests.empty")
    }
}

private struct InterestSaveErrorLabel: View {
    let message: String

    var body: some View {
        Label(message, systemImage: "exclamationmark.circle")
            .font(.footnote).foregroundStyle(.red)
            .accessibilityIdentifier("profile.interests.error")
    }
}

private struct InterestRows: View {
    let options: [DIPInterest]
    @Binding var selection: Set<String>
    let isSaving: Bool
    let onToggle: () -> Void

    var body: some View {
        ForEach(options) { interest in
            let isSelected = selection.contains(interest.id)
            let atMaximum = !InterestSelectionRules.canSelect(interest.id, in: selection)
            Button {
                DIPHaptics.select()
                selection = InterestSelectionRules.toggling(interest.id, in: selection)
                onToggle()
            } label: {
                HStack(spacing: 12) {
                    Text(interest.name)
                        .font(DIPReferenceAssets.font("Inter-Regular", size: 16))
                        .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor)
                    Spacer(minLength: 12)
                    Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                        .font(.title3)
                        .foregroundStyle(isSelected ? DIPTokens.Color.actionPrimary.swiftUIColor : .secondary)
                        .accessibilityHidden(true)
                }
                .frame(minHeight: 44).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(isSaving || atMaximum)
            .accessibilityLabel(interest.name)
            .accessibilityValue(isSelected ? "Selected" : "Not selected")
            .accessibilityAddTraits(isSelected ? .isSelected : [])
            .accessibilityHint(atMaximum ? "Remove an interest to select another" : "Toggle interest")
            .accessibilityIdentifier("profile.interests.option.\(interest.id)")
        }
    }
}

/// Six muted 44 pt rows with a moving highlight band while the catalog loads.
/// The band is static under Reduce Motion.
private struct InterestLoadingRows: View {
    static let rowCount = 6
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var phase: CGFloat = -1

    var body: some View {
        VStack(spacing: 8) {
            ForEach(0..<Self.rowCount, id: \.self) { _ in
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(DIPTokens.Color.surfaceMuted.swiftUIColor)
                    .frame(height: 44)
            }
        }
        .overlay {
            GeometryReader { geometry in
                LinearGradient(colors: [.white.opacity(0), .white.opacity(0.6), .white.opacity(0)],
                               startPoint: .leading, endPoint: .trailing)
                    .frame(width: geometry.size.width * 0.45)
                    .offset(x: phase * geometry.size.width)
            }
            .mask {
                VStack(spacing: 8) {
                    ForEach(0..<Self.rowCount, id: \.self) { _ in
                        RoundedRectangle(cornerRadius: 10, style: .continuous).frame(height: 44)
                    }
                }
            }
            .opacity(reduceMotion ? 0 : 1)
            .allowsHitTesting(false)
        }
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.linear(duration: 1.4).repeatForever(autoreverses: false)) { phase = 1.1 }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading interests")
        .accessibilityIdentifier("profile.interests.loading")
    }
}
