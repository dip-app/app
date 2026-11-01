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

    @State private var isEditing = false
    @State private var draftName = ""
    @State private var draftDepartment = ""
    @State private var draftCity = ""
    @State private var draftInterests: Set<String> = []
    @State private var isSaving = false
    @State private var saveError: String?

    init(
        profile: DIPProfile,
        showsBottomBar: Bool = true,
        onSelectTab: @escaping (DIPHomeTab) -> Void,
        onMemory: @escaping (String) -> Void,
        onSave: @escaping (ProfileEdit) async throws -> Void
    ) {
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
                        profileHeader(width: geometry.size.width - 40)
                        memories(width: geometry.size.width - 40)
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
        .sheet(isPresented: $isEditing) { editForm }
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
                    .frame(width: 216, height: 50)
                    .accessibilityIdentifier("profile.name")
                Text(profile.department)
                    .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                    .frame(height: 22)
                Text(profile.city)
                    .font(DIPReferenceAssets.font("Inter-Italic", size: 14))
                    .frame(width: 214, height: 22, alignment: .trailing)
            }
            .foregroundStyle(.white)
            .frame(width: width * 0.6034, alignment: .trailing)
            .offset(x: width * 0.3575, y: 148)
            HStack(spacing: 10.435) {
                ForEach(profile.interests, id: \.self) { interest in
                    Text(interest)
                        .font(DIPReferenceAssets.font("Inter-Light", size: 12))
                        .foregroundStyle(.black)
                        .frame(height: 22)
                        .padding(.horizontal, 13.043)
                        .frame(height: 30)
                        .background(.white, in: Capsule())
                }
            }
            .fixedSize()
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
        DIPMedia(profile.photo).resizable()
            .frame(width: size * 1.5096, height: size * 1.0138)
            .offset(x: -size * 0.4574, y: -size * 0.0087)
            .frame(width: size, height: size, alignment: .topLeading)
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
        let left = row * 2
        let wideLeft = row.isMultiple(of: 2) == false
        return HStack(spacing: 10) {
            memory(
                index: left, width: wideLeft ? 222 : 131, height: row == 0 ? 126 : 125,
                rightInset: row == 2 ? 12 : 13,
                bottomInset: row == 0 ? 12 : (wideLeft ? 10.5 : 10))
            if left + 1 < profile.favoriteMemories.count {
                memory(
                    index: left + 1, width: wideLeft ? 131 : 222, height: wideLeft ? 126 : 125,
                    rightInset: wideLeft ? 12 : 10, bottomInset: wideLeft ? 11 : (row == 0 ? 10.5 : 10)
                )
                .frame(width: row == 2 ? 230 : (wideLeft ? 131 : 222), alignment: .leading)
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

    private var interestOptions: [String] {
        profile.availableInterests + profile.interests.filter { !profile.availableInterests.contains($0) }
    }

    private func beginEditing() {
        draftName = profile.displayName
        draftDepartment = profile.department
        draftCity = profile.city
        draftInterests = Set(profile.interests)
        saveError = nil
        isEditing = true
    }

    private var editForm: some View {
        NavigationStack {
            Form {
                Section("Profile") {
                    TextField("Name", text: $draftName).accessibilityIdentifier("profile.edit.name")
                    TextField("Department", text: $draftDepartment)
                    TextField("City", text: $draftCity)
                }
                Section("Interests") {
                    ForEach(interestOptions, id: \.self) { interest in
                        Toggle(
                            interest,
                            isOn: Binding(
                                get: { draftInterests.contains(interest) },
                                set: { value in
                                    if value {
                                        draftInterests.insert(interest)
                                    } else {
                                        draftInterests.remove(interest)
                                    }
                                }))
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
                    .disabled(isSaving || draftName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .accessibilityIdentifier("profile.edit.save")
                }
            }
            .interactiveDismissDisabled(isSaving)
        }
    }

    @MainActor
    private func saveProfile() async {
        let name = draftName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !isSaving, !name.isEmpty else { return }
        let edit = ProfileEdit(
            displayName: name,
            department: draftDepartment.trimmingCharacters(in: .whitespacesAndNewlines),
            city: draftCity.trimmingCharacters(in: .whitespacesAndNewlines),
            interests: interestOptions.filter { draftInterests.contains($0) })
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
