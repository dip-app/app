import DIPDesignSystem
import SwiftUI

/// A native rendering of the supplied Profile reference, with local preview-only edits.
struct DIPProfileScreen: View {
    let onSelectTab: (DIPHomeTab) -> Void
    let onMemory: (String) -> Void

    @State private var displayName = "Elissa Woode"
    @State private var department = "Human Resources"
    @State private var city = "Pittsburgh, PA"
    @State private var interests = ["Fitness", "Cooking", "Outdoors", "Carpentry"]
    @State private var isEditing = false
    @State private var draftName = ""
    @State private var draftDepartment = ""
    @State private var draftCity = ""
    @State private var draftInterests: Set<String> = []

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
                DIPFloatingNavigation(selected: .profile, onSelect: onSelectTab)
                    .padding(.horizontal, 20)
                    .position(x: geometry.size.width / 2, y: geometry.size.height - 61)
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
                Text(displayName.uppercased())
                    .font(DIPReferenceAssets.font("FjallaOne-Regular", size: 40, relativeTo: .largeTitle))
                    .frame(width: 216, height: 50)
                    .accessibilityIdentifier("profile.name")
                Text(department)
                    .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                    .frame(height: 22)
                Text(city)
                    .font(DIPReferenceAssets.font("Inter-Italic", size: 14))
                    .frame(width: 214, height: 22, alignment: .trailing)
            }
            .foregroundStyle(.white)
            .frame(width: width * 0.6034, alignment: .trailing)
            .offset(x: width * 0.3575, y: 148)
            HStack(spacing: 10.435) {
                ForEach(interests, id: \.self) { interest in
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
            DIPReferenceAssets.image("profile_Image1").resizable()
                .frame(width: width * 0.1117, height: 292 * 0.137)
                .offset(x: width * 0.5894, y: 292 * 0.0582)
                .accessibilityHidden(true)
        }
        .frame(width: width, height: 292, alignment: .topLeading)
        .clipShape(RoundedRectangle(cornerRadius: 20))
        .accessibilityElement(children: .contain)
    }

    private func profilePhoto(size: CGFloat) -> some View {
        DIPReferenceAssets.image("profile_Image").resizable()
            .frame(width: size * 1.5096, height: size * 1.0138)
            .offset(x: -size * 0.4574, y: -size * 0.0087)
            .frame(width: size, height: size, alignment: .topLeading)
            .clipShape(Circle())
            .overlay(Circle().strokeBorder(.white, lineWidth: 2))
            .accessibilityLabel("Elissa Woode's profile photo")
    }

    private func memories(width: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Favorite Memories")
                .font(DIPReferenceAssets.font("Figtree-Regular", size: 18))
                .foregroundStyle(.black)
                .frame(height: 22, alignment: .leading)
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 10) {
                    memory(
                        index: 0, asset: "profile_Rectangle935", date: "03/01", width: 131, height: 126,
                        rightInset: 13, bottomInset: 12)
                    memory(
                        index: 1, asset: "profile_Rectangle931", date: "02/10", width: 222, height: 125,
                        rightInset: 10, bottomInset: 10.5)
                }
                .frame(width: width, alignment: .leading)
                HStack(spacing: 10) {
                    memory(
                        index: 2, asset: "profile_Rectangle932", date: "02/07", width: 222, height: 125,
                        rightInset: 13, bottomInset: 10.5)
                    memory(
                        index: 3, asset: "profile_Rectangle933", date: "02/04", width: 131, height: 126,
                        rightInset: 12, bottomInset: 11)
                }
                .frame(width: width, alignment: .leading)
                HStack(spacing: 10) {
                    memory(
                        index: 4, asset: "profile_Rectangle934", date: "01/07", width: 131, height: 125,
                        rightInset: 12, bottomInset: 10)
                    memory(
                        index: 5, asset: "profile_Rectangle936", date: "12/30", width: 222, height: 125,
                        rightInset: 10, bottomInset: 10
                    )
                    .frame(width: 230, alignment: .leading)
                }
                .frame(width: width, alignment: .leading)
            }
        }
    }

    private func memory(
        index: Int, asset: String, date: String, width: CGFloat, height: CGFloat,
        rightInset: CGFloat, bottomInset: CGFloat
    ) -> some View {
        Button {
            onMemory(asset)
        } label: {
            DIPReferenceAssets.image(asset).resizable().scaledToFill()
                .frame(width: width, height: height)
                .clipShape(RoundedRectangle(cornerRadius: 20))
                .overlay(alignment: .bottomTrailing) {
                    Text(date)
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
        .accessibilityLabel("Favorite memory, \(date)")
        .accessibilityIdentifier("profile.memory.\(index)")
    }

    private func beginEditing() {
        draftName = displayName
        draftDepartment = department
        draftCity = city
        draftInterests = Set(interests)
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
                    ForEach(["Fitness", "Cooking", "Outdoors", "Carpentry"], id: \.self) { interest in
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
                Section {
                    Text("Changes affect this preview only.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Edit profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { isEditing = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        displayName = draftName.trimmingCharacters(in: .whitespacesAndNewlines)
                        department = draftDepartment.trimmingCharacters(in: .whitespacesAndNewlines)
                        city = draftCity.trimmingCharacters(in: .whitespacesAndNewlines)
                        interests = ["Fitness", "Cooking", "Outdoors", "Carpentry"].filter {
                            draftInterests.contains($0)
                        }
                        isEditing = false
                    }
                    .disabled(draftName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .accessibilityIdentifier("profile.edit.save")
                }
            }
        }
    }
}
