import DIPDesignSystem
import SwiftUI

/// Local presentation of the original upcoming-events and memories reference frames.
/// Callbacks cross the feature boundary; these fixtures do not read or mutate Firebase.
struct DIPMyEventsScreen: View {
    private enum Section {
        case active
        case memories
    }

    @State private var section: Section
    let onSelectTab: (DIPHomeTab) -> Void
    let onEvent: (String) -> Void
    let onAlbum: (String) -> Void
    let onNotifications: () -> Void
    let onProfile: () -> Void

    init(
        initialMemories: Bool = false,
        onSelectTab: @escaping (DIPHomeTab) -> Void,
        onEvent: @escaping (String) -> Void,
        onAlbum: @escaping (String) -> Void,
        onNotifications: @escaping () -> Void,
        onProfile: @escaping () -> Void
    ) {
        _section = State(initialValue: initialMemories ? .memories : .active)
        self.onSelectTab = onSelectTab
        self.onEvent = onEvent
        self.onAlbum = onAlbum
        self.onNotifications = onNotifications
        self.onProfile = onProfile
    }

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .top) {
                DIPTokens.Color.surfaceDefault.swiftUIColor
                VStack(spacing: 0) {
                    DIPHomeHeader(
                        title: "My Events", unreadCount: 5,
                        onNotifications: onNotifications, onProfile: onProfile
                    )
                    .padding(.horizontal, 20).padding(.top, 60).padding(.bottom, 10)
                    ScrollView {
                        VStack(spacing: 18) {
                            sectionPicker
                            if section == .active {
                                activeEvents(width: geometry.size.width - 40)
                            } else {
                                memories
                            }
                        }
                        .padding(.horizontal, 20).padding(.bottom, 120)
                    }
                    .scrollIndicators(.hidden)
                    .accessibilityIdentifier("events.content")
                }
                DIPFloatingNavigation(selected: .events, onSelect: onSelectTab)
                    .padding(.horizontal, 20)
                    .position(x: geometry.size.width / 2, y: geometry.size.height - 61)
            }
            .clipped()
        }
        .ignoresSafeArea()
        .preferredColorScheme(.light)
        .accessibilityElement(children: .contain)
    }

    private var sectionPicker: some View {
        HStack(spacing: 0) {
            Button {
                section = .active
            } label: {
                Text("Active Events")
                    .font(DIPReferenceAssets.font("Figtree-Regular", size: 18))
                    .foregroundStyle(section == .active ? segmentAccent : .white)
                    .frame(width: 112, height: 40, alignment: .leading)
                    .background {
                        if section == .active {
                            Capsule().fill(.white).frame(width: 141, height: 40)
                                .offset(x: -0.5)
                        }
                    }
                    .frame(height: 50)
                    .contentShape(Rectangle())
            }
            .accessibilityIdentifier("events.segment.active")
            .accessibilityAddTraits(section == .active ? .isSelected : [])
            Spacer(minLength: 0)
            Button {
                section = .memories
            } label: {
                Text("Memories")
                    .font(DIPReferenceAssets.font("Figtree-Regular", size: 18))
                    .foregroundStyle(section == .memories ? segmentAccent : .white)
                    .frame(width: 80, height: 40)
                    .background {
                        if section == .memories {
                            Capsule().fill(.white).frame(width: 111, height: 40)
                                .offset(x: -0.5)
                        }
                    }
                    .frame(height: 50)
                    .contentShape(Rectangle())
            }
            .accessibilityIdentifier("events.segment.memories")
            .accessibilityAddTraits(section == .memories ? .isSelected : [])
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 20)
        .frame(height: 50)
        .background(segmentAccent, in: Capsule())
        .accessibilityElement(children: .contain)
    }

    private var segmentAccent: Color {
        DIPTokens.Color.eventsAccent.swiftUIColor
    }

    private func activeEvents(width: CGFloat) -> some View {
        VStack(spacing: 18) {
            ForEach(ActiveEvent.reference) { event in
                Button {
                    onEvent(event.title)
                } label: {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(event.title.uppercased())
                            .font(DIPReferenceAssets.font("FjallaOne-Regular", size: 40, relativeTo: .largeTitle))
                            .fixedSize(horizontal: true, vertical: false)
                            .frame(height: 32, alignment: .leading)
                        Text(event.locality)
                            .font(DIPReferenceAssets.font("Inter-LightItalic", size: 11))
                            .frame(height: 14, alignment: .leading)
                    }
                    .foregroundStyle(.white)
                    .padding(15)
                    .frame(width: width, height: 246, alignment: .bottomLeading)
                    .background {
                        DIPReferenceAssets.image(event.asset)
                            .resizable().scaledToFill().frame(width: width, height: 246)
                            .overlay(.black.opacity(event.shade))
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 20))
                    .contentShape(RoundedRectangle(cornerRadius: 20))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(event.title), \(event.locality)")
                .accessibilityIdentifier("events.card.\(event.id)")
            }
        }
    }

    private var memories: some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 18), GridItem(.flexible(), spacing: 18)], spacing: 18) {
            ForEach(Array(Memory.reference.enumerated()), id: \.offset) { index, memory in
                GeometryReader { geometry in
                    Button {
                        onAlbum(memory.title)
                    } label: {
                        VStack(alignment: .leading, spacing: 0) {
                            HStack(spacing: -4) {
                                ForEach(Array(memory.avatars.enumerated()), id: \.offset) { _, avatar in
                                    DIPReferenceAssets.image("events-past_\(avatar)")
                                        .resizable().frame(width: 22, height: 22)
                                }
                                Text("View Album")
                                    .font(DIPReferenceAssets.font("Inter-Light", size: 10))
                                    .foregroundStyle(.black).frame(height: 22).padding(.horizontal, 10)
                                    .background(.white, in: Capsule())
                            }
                            .fixedSize().accessibilityHidden(true)
                            Spacer(minLength: 0)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(memory.title.uppercased())
                                    .font(DIPReferenceAssets.font("FjallaOne-Regular", size: 20, relativeTo: .title3))
                                    .fixedSize(horizontal: true, vertical: false).frame(height: 22, alignment: .leading)
                                Text(memory.locality)
                                    .font(DIPReferenceAssets.font("Inter-LightItalic", size: 11))
                                    .fixedSize(horizontal: true, vertical: false).frame(height: 18, alignment: .leading)
                            }
                            .foregroundStyle(.white).padding(10)
                        }
                        .padding(5)
                        .frame(width: geometry.size.width, height: 205, alignment: .leading)
                        .background {
                            Group {
                                if memory.asset == "EventCard3" {
                                    // Original Boat Ride instance uses this explicit image-fill transform.
                                    DIPReferenceAssets.image("events-past_\(memory.asset)").resizable()
                                        .frame(width: geometry.size.width * 1.6798, height: 205)
                                        .frame(width: geometry.size.width, height: 205).clipped()
                                } else {
                                    DIPReferenceAssets.image("events-past_\(memory.asset)")
                                        .resizable().scaledToFill()
                                        .frame(width: geometry.size.width, height: 205)
                                }
                            }
                            .overlay(.black.opacity(memory.shade))
                        }
                        .clipShape(RoundedRectangle(cornerRadius: 20))
                        .contentShape(RoundedRectangle(cornerRadius: 20))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("View album, \(memory.title), \(memory.locality)")
                    .accessibilityIdentifier("events.album.\(index)")
                }
                .frame(height: 205)
            }
        }
    }

    private struct ActiveEvent: Identifiable {
        let id: String
        let title: String
        let locality: String
        let asset: String
        let shade: Double

        static let reference: [Self] = [
            .init(
                id: "puppy-yoga", title: "Puppy Yoga", locality: "Lawrenceville, PA", asset: "events_Rectangle930",
                shade: 0.2),
            .init(
                id: "game-cafe", title: "Game cafe", locality: "Squirrel Hill, PA", asset: "events_Rectangle931",
                shade: 0.08),
            .init(
                id: "mount-diablo-hike", title: "Mount Diablo Hike", locality: "Allegheny, PA",
                asset: "events_Rectangle932", shade: 0),
            .init(
                id: "cooking-class", title: "Cooking class", locality: "Strip District, PA",
                asset: "events_Rectangle933", shade: 0),
        ]
    }

    private struct Memory {
        let title: String
        let locality: String
        let asset: String
        let avatars: [String]
        var shade: Double = 0.08

        static let reference: [Self] = [
            .init(
                title: "Kayaking 03/01", locality: "Delaware River, NJ", asset: "EventCard",
                avatars: ["AvatarPink", "AvatarRed", "AvatarTeal"]),
            .init(
                title: "Hiking 02/22", locality: "Fall Run Park, PA", asset: "EventCard1",
                avatars: ["CoworkerProfilePicture", "CoworkerProfilePicture1", "AvatarPink"], shade: 0.2),
            .init(
                title: "Rug Tuft 02/15", locality: "Poconos, PA", asset: "EventCard2",
                avatars: ["CoworkerProfilePicture2", "CoworkerProfilePicture3", "CoworkerProfilePicture4"]),
            .init(
                title: "Boat Ride 02/08", locality: "Allegheny, PA", asset: "EventCard3",
                avatars: ["AvatarRed", "CoworkerProfilePicture2", "AvatarTeal"]),
            .init(
                title: "Rage Room 02/01", locality: "Southside, PA", asset: "EventCard4",
                avatars: ["AvatarPink", "CoworkerProfilePicture1", "CoworkerProfilePicture"]),
            .init(
                title: "Paint Sip 01/25", locality: "Lawrenceville, PA", asset: "EventCard5",
                avatars: ["CoworkerProfilePicture4", "AvatarRed", "CoworkerProfilePicture2"]),
            .init(
                title: "Ceramics 01/18", locality: "Strip District, PA", asset: "EventCard6",
                avatars: ["AvatarPink", "AvatarRed", "AvatarTeal"]),
            .init(
                title: "Book Club 01/11", locality: "Bloomfield, PA", asset: "EventCard7",
                avatars: ["AvatarPink", "AvatarRed", "AvatarTeal"]),
        ]
    }
}
