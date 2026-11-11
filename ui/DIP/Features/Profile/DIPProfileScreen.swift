import DIPAccounts
import DIPCore
import DIPDesignSystem
import SwiftUI

/// Renders repository-owned profile data. Only form drafts and presentation state are local.
struct DIPProfileScreen: View {
    let profile: DIPProfile
    let showsBottomBar: Bool
    let onSelectTab: (DIPHomeTab) -> Void
    /// (eventID, photoID): the album opens on that photo when the memory knows it.
    let onMemory: (String, String?) -> Void
    let onSave: (ProfileEdit) async throws -> Void
    let onSignOut: (() async -> Void)?
    let interestCatalogLoading: Bool
    let interestCatalogError: String?
    let onRetryInterestCatalog: (() -> Void)?
    /// "How DIP works": replays the onboarding tour. Nil hides the row.
    let onReplayTour: (() -> Void)?
    @State private var isSigningOut = false
    @Environment(\.presentBugReport) private var presentBugReport
    @AppStorage(ShakeGate.enabledKey) private var shakeToReport = true

    @State private var isEditing = false
    @State private var isChoosingInterests = false
    @State private var isChoosingDraftInterests = false
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var draftDepartment = ""
    @State private var draftCity = ""
    @State private var draftInterests: Set<String> = []
    @State private var draftJobTitle = ""
    @State private var draftAvailability: [String] = []
    @State private var draftRadius = 20
    @State private var isSaving = false
    @State private var saveError: String?

    init(
        profile: DIPProfile,
        showsBottomBar: Bool = true,
        onSelectTab: @escaping (DIPHomeTab) -> Void,
        onMemory: @escaping (String, String?) -> Void,
        onSave: @escaping (ProfileEdit) async throws -> Void,
        onSignOut: (() async -> Void)? = nil,
        interestCatalogLoading: Bool = false, interestCatalogError: String? = nil,
        onRetryInterestCatalog: (() -> Void)? = nil,
        onReplayTour: (() -> Void)? = nil
    ) {
        self.onReplayTour = onReplayTour
        self.interestCatalogLoading = interestCatalogLoading
        self.interestCatalogError = interestCatalogError
        self.onRetryInterestCatalog = onRetryInterestCatalog
        self.onSignOut = onSignOut
        self.profile = profile
        self.showsBottomBar = showsBottomBar
        self.onSelectTab = onSelectTab
        self.onMemory = onMemory
        self.onSave = onSave
    }

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .top) {
                Color.white
                ScrollView {
                    VStack(alignment: .leading, spacing: 28) {
                        ProfileHeaderCard(
                            profile: profile, catalogReady: catalogReady,
                            onEdit: beginEditing, onAddInterests: { isChoosingInterests = true })
                        catalogStatus
                        memories
                        if let onReplayTour {
                            Button(action: onReplayTour) {
                                HStack(spacing: 12) {
                                    Image(systemName: "sparkles").accessibilityHidden(true)
                                    Text("How DIP works")
                                        .font(DIPReferenceAssets.font("Figtree-Regular", size: 18, relativeTo: .body))
                                    Spacer(minLength: 0)
                                    Image(systemName: "chevron.right").font(.footnote.weight(.semibold))
                                        .accessibilityHidden(true)
                                }
                                .foregroundStyle(.black)
                                .padding(.horizontal, 18)
                                .frame(minHeight: 56)
                                .background(DIPTokens.Color.surfaceMuted.swiftUIColor, in: Capsule())
                                .contentShape(Capsule())
                            }
                            .buttonStyle(DIPPressFeedbackStyle())
                            .accessibilityIdentifier("profile.howDIPWorks")
                        }
                        if let presentBugReport {
                            reportProblem(presentBugReport)
                        }
                        if let onSignOut {
                            DIPButton(isSigningOut ? "Signing out…" : "Sign out", emphasis: .secondary,
                                isLoading: isSigningOut) {
                                guard !isSigningOut else { return }
                                DIPHaptics.commit()
                                isSigningOut = true
                                Task { await onSignOut(); isSigningOut = false }
                            }
                            .accessibilityIdentifier("profile.signout")
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 60)
                    .padding(.bottom, 150)
                }
                .scrollIndicators(.hidden)
                .padding(.bottom, 22)
                LinearGradient(
                    stops: [
                        .init(color: .white, location: 0.35),
                        .init(color: .white.opacity(0.88), location: 0.54221),
                        .init(color: .white.opacity(0), location: 1),
                    ],
                    startPoint: .top, endPoint: .bottom
                )
                .frame(height: 60)
                .allowsHitTesting(false)
                if showsBottomBar {
                    DIPFloatingNavigation(selected: .profile, onSelect: onSelectTab)
                        .padding(.horizontal, 20)
                        .position(x: geometry.size.width / 2, y: geometry.size.height - 61)
                }
            }
            .clipped()
            .coordinateSpace(name: ProfileBadgeLink.pageSpace)
        }
        .ignoresSafeArea()
        .preferredColorScheme(.light)
        .accessibilityElement(children: .contain)
        .sheet(isPresented: $isEditing) { editForm.environment(\.dynamicTypeSize, dynamicTypeSize) }
        .sheet(isPresented: $isChoosingInterests) {
            DIPInterestPicker(options: interestOptions, selection: Set(profile.interestTagIDs)) { interests in
                try await onSave(.init(department: profile.department, city: profile.city, interestTagIDs: interests))
            }
            .environment(\.dynamicTypeSize, dynamicTypeSize)
        }
    }

    /// "Report a problem" is the accessible, non-shake path to the same sheet; the toggle turns the shake off.
    private func reportProblem(_ present: @escaping @MainActor (BugReportSource) -> Void) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("HELP US FIX THINGS")
                .font(DIPReferenceAssets.font("FjallaOne-Regular", size: 24, relativeTo: .title2))
                .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor)
                .accessibilityAddTraits(.isHeader)
            Toggle(isOn: $shakeToReport) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Shake to report a problem")
                        .font(DIPReferenceAssets.font("Figtree-Regular", size: 18, relativeTo: .body))
                    Text("Shake your phone anywhere in DIP to tell us what went wrong.")
                        .font(DIPReferenceAssets.font("Inter-Regular", size: 13, relativeTo: .footnote))
                        .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor.opacity(0.72))
                }
            }
            .tint(DIPTokens.Color.actionPrimary.swiftUIColor)
            .padding(16)
            .background(DIPTokens.Color.surfaceMuted.swiftUIColor,
                        in: RoundedRectangle(cornerRadius: DIPTokens.Radius.card, style: .continuous))
            .accessibilityIdentifier("profile.shakeToReport")
            DIPButton("Report a problem", emphasis: .secondary) { present(.profile) }
                .accessibilityIdentifier("profile.reportProblem")
        }
    }

    @ViewBuilder private var catalogStatus: some View {
        if interestCatalogLoading {
            ProgressView("Loading interests…").accessibilityIdentifier("profile.interests.loading")
        }
        if let interestCatalogError {
            VStack(alignment: .leading, spacing: 8) {
                Text(interestCatalogError)
                    .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                Button("Retry interests") { onRetryInterestCatalog?() }
                    .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                    .accessibilityIdentifier("profile.interests.catalog.retry")
            }
        }
    }

    private var catalogReady: Bool { !interestCatalogLoading && interestCatalogError == nil }

    private var memories: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                Text("FAVORITE MEMORIES")
                    .font(DIPReferenceAssets.font("FjallaOne-Regular", size: 24, relativeTo: .title2))
                    .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 8)
            }
            if profile.favoriteMemories.isEmpty {
                DIPEmptyState(
                    screen: "profile-memories", title: "No favorite memories yet",
                    message: "Favorite a photo from a past event and it will show up here.")
            } else {
                LazyVGrid(
                    columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)],
                    spacing: 12
                ) {
                    ForEach(Array(profile.favoriteMemories.enumerated()), id: \.element.id) { index, memory in
                        memoryTile(memory, index: index)
                    }
                }
            }
        }
    }

    private func memoryTile(_ memory: DIPFavoriteMemory, index: Int) -> some View {
        Button { onMemory(memory.eventID, memory.photoID) } label: {
            Color.clear.aspectRatio(1, contentMode: .fit)
                .overlay { DIPMedia(memory.image).resizable().scaledToFill() }
                .clipShape(RoundedRectangle(cornerRadius: DIPTokens.Radius.card, style: .continuous))
                .overlay(alignment: .bottomLeading) {
                    Text(memory.dateLabel)
                        .font(DIPReferenceAssets.font("Figtree-Regular", size: 13))
                        .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor)
                        .padding(.horizontal, 12).padding(.vertical, 6)
                        .background(.white, in: Capsule())
                        .padding(10)
                }
                .contentShape(RoundedRectangle(cornerRadius: DIPTokens.Radius.card, style: .continuous))
        }
        .buttonStyle(DIPPressFeedbackStyle())
        .accessibilityLabel("Favorite memory, \(memory.dateLabel)")
        .accessibilityIdentifier("profile.memory.\(index)")
        .id(memory.id)
    }

    /// Header pills. Stored interest ids are named from the catalog, so until it has loaded
    /// (or after it failed) no pills are shown, rather than labelling every saved interest
    /// "Unavailable interest" as if it had been removed. The stored ids are untouched.
    nonisolated static func headerInterests(_ profile: DIPProfile, catalogReady: Bool) -> [DIPInterest] {
        catalogReady ? profile.selectedInterests : []
    }

    /// Labels for known availability ids, in option order. Unknown stored ids are kept on
    /// save but not shown, since there is no label for them.
    nonisolated static func availabilityLabels(_ ids: [String]) -> [String] {
        AvailabilityOption.all.filter { ids.contains($0.id) }.map(\.label)
    }

    /// Saved order: known options in option order, then unknown stored ids unchanged.
    nonisolated static func orderedAvailability(_ ids: [String]) -> [String] {
        let known = AvailabilityOption.all.map(\.id)
        return known.filter { ids.contains($0) } + ids.filter { !known.contains($0) }
    }

    nonisolated static let standardRadii = [5, 10, 20, 50, 100]

    /// Standard choices plus the stored value, so an unusual saved radius is never lost.
    nonisolated static func radiusChoices(including current: Int) -> [Int] {
        Array(Set(standardRadii + [current])).sorted()
    }

    /// Icon-row wording on the profile: "Events within 20 miles".
    nonisolated static func radiusPhrase(_ miles: Int) -> String {
        miles == 1 ? "Events within 1 mile" : "Events within \(miles) miles"
    }

    nonisolated static func radiusLabel(_ miles: Int) -> String {
        miles == 1 ? "Within 1 mile" : "Within \(miles) miles"
    }

    private var interestOptions: [DIPInterest] {
        let known = Set(profile.interestCatalog.map(\.id))
        let missing = profile.interestTagIDs.filter { !known.contains($0) }.map {
            DIPInterest(id: $0, name: "Unavailable interest", sortOrder: Int.max)
        }
        return profile.interestCatalog.sorted {
            $0.sortOrder == $1.sortOrder ? $0.id < $1.id : $0.sortOrder < $1.sortOrder
        } + missing
    }

    private func beginEditing() {
        draftDepartment = profile.department
        draftCity = profile.city
        draftInterests = Set(profile.interestTagIDs)
        draftJobTitle = profile.jobTitle
        draftAvailability = profile.availability
        draftRadius = profile.travelRadiusMiles ?? 20
        saveError = nil
        isEditing = true
    }

    private func labeledField(_ title: String, text: Binding<String>, id: String) -> some View {
        LabeledContent(title) {
            TextField(title, text: text)
                .multilineTextAlignment(.trailing)
                .accessibilityIdentifier(id)
        }
    }

    private var editForm: some View {
        NavigationStack {
            Form {
                Section("Profile") {
                    LabeledContent("Name") {
                        Text(profile.displayName).accessibilityIdentifier("profile.edit.name")
                    }
                    // Visible labels: a filled field otherwise loses its placeholder, and
                    // "Cool cat" vs "SWE" can't be told apart.
                    if profile.hasAccountDetails {
                        labeledField("Job title", text: $draftJobTitle, id: "profile.edit.jobTitle")
                            .textContentType(.jobTitle)
                    }
                    labeledField("Department", text: $draftDepartment, id: "profile.edit.department")
                    labeledField("City", text: $draftCity, id: "profile.edit.city")
                        .textContentType(.addressCity)
                }
                Section("Interests") {
                    DraftInterestsRow(selection: $draftInterests) { isChoosingDraftInterests = true }
                        .accessibilityIdentifier("profile.edit.interests")
                        .disabled(interestCatalogLoading || interestCatalogError != nil)
                }
                if profile.hasAccountDetails {
                    Section("When you're free") {
                        ForEach(AvailabilityOption.all) { option in
                            Toggle(option.label, isOn: Binding(
                                get: { draftAvailability.contains(option.id) },
                                set: { isOn in
                                    if isOn, !draftAvailability.contains(option.id),
                                       draftAvailability.count < EditableProfile.maximumListCount {
                                        draftAvailability.append(option.id)
                                    } else if !isOn {
                                        draftAvailability.removeAll { $0 == option.id }
                                    }
                                }))
                            .accessibilityIdentifier("profile.edit.availability.\(option.id)")
                        }
                    }
                    Section("How far you'll travel") {
                        Picker("Travel radius", selection: $draftRadius) {
                            ForEach(Self.radiusChoices(including: draftRadius), id: \.self) { miles in
                                Text(Self.radiusLabel(miles)).tag(miles)
                            }
                        }
                        .accessibilityIdentifier("profile.edit.radius")
                    }
                }
                if let saveError {
                    Section {
                        Text(saveError)
                            .foregroundStyle(.red)
                            .accessibilityIdentifier("profile.edit.error")
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(DIPTokens.Color.actionPrimary.swiftUIColor.opacity(0.08))
            .tint(DIPTokens.Color.actionPrimary.swiftUIColor)
            .disabled(isSaving)
            .navigationTitle("Edit profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { isEditing = false }
                        .disabled(isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Saving…" : "Save") {
                        Task { await saveProfile() }
                    }
                    .disabled(isSaving)
                    .accessibilityIdentifier("profile.edit.save")
                }
            }
            .interactiveDismissDisabled(isSaving)
        }
        .sheet(isPresented: $isChoosingDraftInterests) {
            DIPInterestPicker(options: interestOptions, selection: draftInterests) { interests in
                draftInterests = Set(interests)
            }
            .environment(\.dynamicTypeSize, dynamicTypeSize)
        }
    }

    @MainActor
    private func saveProfile() async {
        guard !isSaving else { return }
        let edit = ProfileEdit(
            department: draftDepartment.trimmingCharacters(in: .whitespacesAndNewlines),
            city: draftCity.trimmingCharacters(in: .whitespacesAndNewlines),
            interestTagIDs: interestOptions.map(\.id).filter { draftInterests.contains($0) },
            // Fixture profiles have no account details; nil leaves them untouched.
            jobTitle: profile.hasAccountDetails ? draftJobTitle.trimmingCharacters(in: .whitespacesAndNewlines) : nil,
            availability: profile.hasAccountDetails ? Self.orderedAvailability(draftAvailability) : nil,
            travelRadiusMiles: profile.hasAccountDetails ? draftRadius : nil)
        isSaving = true
        saveError = nil
        DIPHaptics.commit()
        defer { isSaving = false }
        do {
            try await onSave(edit)
            DIPHaptics.success()
            isEditing = false
        } catch {
            DIPHaptics.failure()
            saveError = "Your profile could not be saved. Try again."
        }
    }
}

/// The sheet's interest count reads the draft through a binding. Read directly from the
/// presenting view's state, the sheet kept showing the value from before Edit was tapped
/// ("0 selected" while the profile had interests); saving was unaffected.
private struct DraftInterestsRow: View {
    @Binding var selection: Set<String>
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            LabeledContent("Choose interests", value: "\(selection.count) selected")
        }
    }
}
