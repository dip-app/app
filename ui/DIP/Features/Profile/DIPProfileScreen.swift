import DIPAccounts
import DIPCore
import DIPDesignSystem
import SwiftUI

/// Renders repository-owned profile data. Only form drafts and presentation state are local.
struct DIPProfileScreen: View {
    let profile: DIPProfile
    let showsBottomBar: Bool
    let onSelectTab: (DIPHomeTab) -> Void
    let onMemory: (String) -> Void
    let onSave: (ProfileEdit) async throws -> Void
    let onSignOut: (() async -> Void)?
    let interestCatalogLoading: Bool
    let interestCatalogError: String?
    let onRetryInterestCatalog: (() -> Void)?
    @State private var isSigningOut = false

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
        onMemory: @escaping (String) -> Void,
        onSave: @escaping (ProfileEdit) async throws -> Void,
        onSignOut: (() async -> Void)? = nil,
        interestCatalogLoading: Bool = false, interestCatalogError: String? = nil,
        onRetryInterestCatalog: (() -> Void)? = nil
    ) {
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
                    VStack(alignment: .leading, spacing: 22) {
                        if dynamicTypeSize.isAccessibilitySize { accessibleHeader }
                        else { profileHeader(width: geometry.size.width - 40) }
                        if interestCatalogLoading {
                            ProgressView("Loading interests…").accessibilityIdentifier("profile.interests.loading")
                        }
                        if let interestCatalogError {
                            VStack(alignment: .leading, spacing: 8) {
                                Text(interestCatalogError).font(.footnote)
                                Button("Retry interests") { onRetryInterestCatalog?() }
                                    .accessibilityIdentifier("profile.interests.catalog.retry")
                            }
                        }
                        interestsEntry
                        accountDetails
                        memories(width: geometry.size.width - 40)
                        if let onSignOut {
                            DIPButton(isSigningOut ? "Signing out…" : "Sign out", emphasis: .destructive,
                                isLoading: isSigningOut) {
                                guard !isSigningOut else { return }
                                isSigningOut = true
                                Task { await onSignOut(); isSigningOut = false }
                            }
                            .accessibilityIdentifier("profile.signout")
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 60)
                    .padding(.bottom, 122)
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

    @ViewBuilder private var interestsEntry: some View {
        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 12) {
                interestsHeading
                addInterestsButton.frame(maxWidth: .infinity)
            }
        } else {
            HStack(spacing: 16) {
                interestsHeading
                Spacer(minLength: 0)
                addInterestsButton
            }
        }
    }

    private var interestsHeading: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Interests")
                .font(DIPReferenceAssets.font("Figtree-Regular", size: 18, relativeTo: .headline))
            Text(profile.interests.isEmpty ? "Add something you enjoy" : "\(profile.interests.count) selected")
                .font(DIPReferenceAssets.font("Inter-Regular", size: 13, relativeTo: .caption))
                .foregroundStyle(.secondary)
        }
    }

    private var addInterestsButton: some View {
        Button { isChoosingInterests = true } label: {
            Label("Add interests", systemImage: "plus")
                .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor)
                .frame(maxWidth: dynamicTypeSize.isAccessibilitySize ? .infinity : nil)
                .padding(.horizontal, 16).frame(minHeight: 44)
                .padding(.vertical, dynamicTypeSize.isAccessibilitySize ? 8 : 0)
                .background(DIPTokens.Color.surfaceMuted.swiftUIColor, in: Capsule())
        }
        .buttonStyle(DIPPressFeedbackStyle())
        .accessibilityIdentifier("profile.interests.add")
        .disabled(interestCatalogLoading || interestCatalogError != nil)
    }

    private var accessibleHeader: some View {
        VStack(alignment: .leading, spacing: 16) {
            profilePhoto(size: 80)
            Text(profile.displayName)
                .font(DIPReferenceAssets.font("FjallaOne-Regular", size: 32, relativeTo: .largeTitle))
                .accessibilityIdentifier("profile.name")
            Text(profile.department)
            Text(profile.city)
            DIPButton("Edit profile", emphasis: .secondary, action: beginEditing)
                .accessibilityIdentifier("profile.edit")
        }
        .font(DIPReferenceAssets.font("Inter-Regular", size: 16))
        .foregroundStyle(.white).padding(20).frame(maxWidth: .infinity, alignment: .leading)
        .background(DIPTokens.Color.navigationBackground.swiftUIColor, in: RoundedRectangle(cornerRadius: 20))
    }

    private func profileHeader(width: CGFloat) -> some View {
        ZStack(alignment: .topLeading) {
            DIPReferenceAssets.image("profile_Rectangle962").resizable()
                .frame(width: width, height: 292)
            DIPReferenceAssets.image("profile_Vector50").resizable()
                .frame(width: width * 0.9958, height: 258)
                .offset(x: width * 0.0042, y: 34)
            profilePhoto(size: width * 0.3212)
                .offset(x: width * 0.338, y: 18)
            VStack(alignment: .trailing, spacing: -3) {
                Text(profile.displayName.uppercased())
                    .font(DIPReferenceAssets.font("FjallaOne-Regular", size: 40, relativeTo: .largeTitle))
                    .lineLimit(1).minimumScaleFactor(0.55)
                    .frame(width: min(216, width * 0.6034), height: 50)
                    .accessibilityIdentifier("profile.name")
                Text(profile.department)
                    .lineLimit(1).minimumScaleFactor(0.8)
                    .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                    .frame(height: 22)
                Text(profile.city)
                    .lineLimit(1).minimumScaleFactor(0.8)
                    .font(DIPReferenceAssets.font("Inter-Italic", size: 14))
                    .frame(width: 214, height: 22, alignment: .trailing)
            }
            .foregroundStyle(.white)
            .frame(width: width * 0.6034, alignment: .trailing)
            .offset(x: width * 0.3575, y: 148)
            ScrollView(.horizontal) {
            HStack(spacing: 10.435) {
                ForEach(Self.headerInterests(profile, catalogReady: catalogReady)) { interest in
                    Text(interest.name)
                        .font(DIPReferenceAssets.font("Inter-Light", size: 12))
                        .foregroundStyle(.black)
                        .frame(height: 22)
                        .padding(.horizontal, 13.043)
                        .frame(height: 30)
                        .background(.white, in: Capsule())
                }
            }
            }
            .scrollIndicators(.hidden)
            .frame(width: width * 0.9226, height: 30)
            .offset(x: width * 0.0387, y: 250)
            Button(action: beginEditing) {
                ZStack(alignment: .topLeading) {
                    DIPReferenceAssets.image("profile_Ellipse394").resizable()
                        .frame(width: width * 0.1033, height: width * 0.1033 * 35 / 36)
                        .offset(x: width * 0.8854 - (width - 44), y: 4)
                    DIPReferenceAssets.image("profile_Vector").resizable()
                        .frame(width: width * 0.067 * 0.7857, height: width * 0.067 * 0.7858)
                        .offset(x: width * (0.9049 + 0.067 * 0.1158) - (width - 44), y: 10 + width * 0.067 * 0.0984)
                }
                .frame(width: 44, height: 44, alignment: .topLeading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .offset(x: width - 44)
            .accessibilityLabel("Edit profile")
            .accessibilityIdentifier("profile.edit")
            DIPMedia(profile.avatar).resizable()
                .frame(width: width * 0.1117, height: 292 * 0.137)
                .offset(x: width * 0.5894, y: 292 * 0.0582)
                .accessibilityHidden(true)
        }
        .frame(width: width, height: 292, alignment: .topLeading)
        .clipShape(RoundedRectangle(cornerRadius: 20))
        .accessibilityElement(children: .contain)
    }

    private func profilePhoto(size: CGFloat) -> some View {
        Group {
            if profile.photo == .asset("profile_Image") {
                DIPMedia(profile.photo).resizable()
                    .frame(width: size * 1.5096, height: size * 1.0138)
                    .offset(x: -size * 0.4574, y: -size * 0.0087)
                    .frame(width: size, height: size, alignment: .topLeading)
            } else {
                DIPMedia(profile.photo).resizable().scaledToFill()
                    .frame(width: size, height: size).clipped()
            }
        }
            .clipShape(Circle())
            .overlay(Circle().strokeBorder(.white, lineWidth: 2))
            .accessibilityLabel("\(profile.displayName)'s profile photo")
    }

    private func memories(width: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Favorite Memories")
                .font(DIPReferenceAssets.font("Figtree-Regular", size: 18))
                .foregroundStyle(.black)
                .frame(height: 22, alignment: .leading)
            if profile.favoriteMemories.isEmpty {
                Text("No favorite memories yet")
                    .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                    .foregroundStyle(.secondary)
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(0..<((profile.favoriteMemories.count + 1) / 2), id: \.self) { row in
                        memoryRow(row, width: width)
                    }
                }
            }
        }
    }

    private func memoryRow(_ row: Int, width: CGFloat) -> some View {
        let scale = width / 362
        let left = row * 2
        let wideLeft = row.isMultiple(of: 2) == false
        return HStack(spacing: 10) {
            memory(
                index: left, width: (wideLeft ? 222 : 131) * scale, height: (row == 0 ? 126 : 125) * scale,
                rightInset: row == 2 ? 12 : 13,
                bottomInset: row == 0 ? 12 : (wideLeft ? 10.5 : 10))
            if left + 1 < profile.favoriteMemories.count {
                memory(
                    index: left + 1, width: (wideLeft ? 131 : 222) * scale, height: (wideLeft ? 126 : 125) * scale,
                    rightInset: wideLeft ? 12 : 10, bottomInset: wideLeft ? 11 : (row == 0 ? 10.5 : 10)
                )
                .frame(width: (row == 2 ? 230 : (wideLeft ? 131 : 222)) * scale, alignment: .leading)
            }
        }
        .frame(width: width, alignment: .leading)
    }

    private func memory(
        index: Int, width: CGFloat, height: CGFloat, rightInset: CGFloat, bottomInset: CGFloat
    ) -> some View {
        let memory = profile.favoriteMemories[index]
        return Button {
            onMemory(memory.eventID)
        } label: {
            DIPMedia(memory.image).resizable().scaledToFill()
                .frame(width: width, height: height)
                .clipShape(RoundedRectangle(cornerRadius: 20))
                .overlay(alignment: .bottomTrailing) {
                    Text(memory.dateLabel)
                        .font(DIPReferenceAssets.font("Figtree-Regular", size: 13.435))
                        .foregroundStyle(.black)
                        .frame(height: 13.435)
                        .padding(.horizontal, 17).padding(.vertical, 8)
                        .background(.white, in: Capsule())
                        .padding(.trailing, rightInset).padding(.bottom, bottomInset)
                }
                .contentShape(RoundedRectangle(cornerRadius: 20))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Favorite memory, \(memory.dateLabel)")
        .accessibilityIdentifier("profile.memory.\(index)")
        .id(memory.id)
    }

    private var catalogReady: Bool { !interestCatalogLoading && interestCatalogError == nil }

    /// Header pills. Stored interest ids are named from the catalog, so until it has loaded
    /// (or after it failed) no pills are shown, rather than labelling every saved interest
    /// "Unavailable interest" as if it had been removed. The stored ids are untouched.
    nonisolated static func headerInterests(_ profile: DIPProfile, catalogReady: Bool) -> [DIPInterest] {
        catalogReady ? profile.selectedInterests : []
    }

    /// Job title, availability and travel radius, for account-backed profiles only.
    @ViewBuilder private var accountDetails: some View {
        if profile.hasAccountDetails {
            VStack(alignment: .leading, spacing: 12) {
                Text("About")
                    .font(DIPReferenceAssets.font("Figtree-Regular", size: 18, relativeTo: .headline))
                    .accessibilityAddTraits(.isHeader)
                detail("Job title", profile.jobTitle.isEmpty ? nil : profile.jobTitle, id: "jobTitle")
                let free = Self.availabilityLabels(profile.availability)
                detail("When you're free", free.isEmpty ? nil : free.joined(separator: ", "), id: "availability")
                detail("How far you'll travel", profile.travelRadiusMiles.map { Self.radiusLabel($0) }, id: "radius")
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("profile.details")
        }
    }

    private func detail(_ title: String, _ value: String?, id: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(DIPReferenceAssets.font("Inter-Regular", size: 13, relativeTo: .caption))
                .foregroundStyle(.secondary)
            Text(value ?? "Not added yet")
                .font(DIPReferenceAssets.font("Inter-Regular", size: 16, relativeTo: .body))
                .foregroundStyle(value == nil ? Color.secondary : Color.primary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("profile.details.\(id)")
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
                    Button { isChoosingDraftInterests = true } label: {
                        LabeledContent("Choose interests", value: "\(draftInterests.count) selected")
                    }
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
        defer { isSaving = false }
        do {
            try await onSave(edit)
            isEditing = false
        } catch {
            saveError = "Your profile could not be saved. Try again."
        }
    }
}
