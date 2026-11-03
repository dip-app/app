import DIPCore
import DIPDesignSystem
import SwiftUI

/// Catalog-backed selection. The parent supplies a repository command or stages an edit draft.
struct DIPInterestPicker: View {
    static let maximumSelection = 10
    let options: [DIPInterest]
    let onSave: ([String]) async throws -> Void
    @State private var selection: Set<String>
    @State private var query = ""
    @State private var isSaving = false
    @State private var saveError: String?
    @FocusState private var searchFocused: Bool
    @Environment(\.dismiss) private var dismiss

    init(options: [DIPInterest], selection: Set<String>, onSave: @escaping ([String]) async throws -> Void) {
        var seen = Set<String>()
        self.options = options.filter { seen.insert($0.id).inserted }
        _selection = State(initialValue: selection)
        self.onSave = onSave
    }

    private var filtered: [DIPInterest] {
        let search = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return options.filter { search.isEmpty || $0.name.localizedStandardContains(search) }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack(spacing: 10) {
                        Image(systemName: "magnifyingglass").foregroundStyle(.secondary).accessibilityHidden(true)
                        TextField("Search interests", text: $query)
                            .font(DIPReferenceAssets.font("Inter-Regular", size: 16))
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                            .focused($searchFocused)
                            .submitLabel(.search)
                            .accessibilityIdentifier("profile.interests.search")
                    }
                    .frame(minHeight: 44)
                }
                Section {
                    Text("\(selection.count) of \(Self.maximumSelection) selected")
                        .font(DIPReferenceAssets.font("Figtree-Regular", size: 18, relativeTo: .headline))
                        .accessibilityIdentifier("profile.interests.count")
                    Text("Choose the things you enjoy. You can change these anytime.")
                        .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                        .foregroundStyle(.secondary)
                }
                if filtered.isEmpty {
                    Group {
                        if query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                            ContentUnavailableView("No interests yet", systemImage: "tag",
                                description: Text("Your company's interests will appear here."))
                        } else { ContentUnavailableView.search(text: query) }
                    }
                    .accessibilityIdentifier("profile.interests.empty")
                } else {
                    Section("Interests") {
                        ForEach(filtered) { interest in
                            Button {
                                if selection.contains(interest.id) { selection.remove(interest.id) }
                                else if selection.count < Self.maximumSelection { selection.insert(interest.id) }
                                saveError = nil
                            } label: {
                                HStack(spacing: 12) {
                                    Text(interest.name)
                                        .font(DIPReferenceAssets.font("Inter-Regular", size: 16))
                                        .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor)
                                    Spacer(minLength: 12)
                                    Image(systemName: selection.contains(interest.id) ? "checkmark.circle.fill" : "circle")
                                        .font(.title3)
                                        .foregroundStyle(selection.contains(interest.id)
                                            ? DIPTokens.Color.actionPrimary.swiftUIColor : .secondary)
                                        .accessibilityHidden(true)
                                }
                                .frame(minHeight: 44).contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .disabled(isSaving || (!selection.contains(interest.id) && selection.count >= Self.maximumSelection))
                            .accessibilityLabel(interest.name)
                            .accessibilityValue(selection.contains(interest.id) ? "Selected" : "Not selected")
                            .accessibilityAddTraits(selection.contains(interest.id) ? .isSelected : [])
                            .accessibilityHint(selection.count >= Self.maximumSelection && !selection.contains(interest.id)
                                ? "Remove an interest to select another" : "Toggle interest")
                            .accessibilityIdentifier("profile.interests.option.\(interest.id)")
                        }
                    }
                }

            }
            .disabled(isSaving)
            .safeAreaInset(edge: .top, spacing: 0) {
                if let saveError {
                    VStack(alignment: .leading, spacing: 8) {
                        Label(saveError, systemImage: "exclamationmark.circle")
                            .font(.footnote).foregroundStyle(.red)
                            .accessibilityIdentifier("profile.interests.error")
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
        guard !isSaving, selection.count <= Self.maximumSelection else { return }
        searchFocused = false
        isSaving = true
        saveError = nil
        defer { isSaving = false }
        do {
            try await onSave(options.map(\.id).filter(selection.contains))
            dismiss()
        } catch {
            saveError = "Couldn’t save your interests. Your choices are kept. Try again."
        }
    }
}
