import DIPDesignSystem
import SwiftUI

/// Deterministic presentation fixture matching Figma Home 35:147.
/// Counts, avatars and events are prototype content, never authoritative server data.
struct DIPHomeFixturePreview: View {
    var body: some View { DIPPrototypeApp() }
}

struct DIPHomeScreen: View {
    let onSelect: (String) -> Void
    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .top) {
                Color.white
                VStack(spacing: 0) {
                    DIPHomeHeader(
                        title: "Home", unreadCount: 5,
                        onNotifications: { onSelect("Notifications") }, onProfile: { onSelect("Profile") }
                    )
                    .padding(.horizontal, 20).padding(.top, 60).padding(.bottom, 10)
                    ScrollView(.vertical) {
                        VStack(alignment: .leading, spacing: 22) {
                            VStack(alignment: .leading, spacing: 8) {
                                sectionTitle("This Week’s Challenge", size: 18)
                                DIPChallengeCard(
                                    category: "Fitness", participantCount: 128,
                                    avatars: ["CoworkerProfilePicture", "AvatarRed", "AvatarTeal"]
                                ) {
                                    onSelect("Fitness challenge")
                                }
                            }
                            .padding(.top, 15)
                            VStack(alignment: .leading, spacing: 8) {
                                sectionTitle("This Week’s Events")
                                ScrollView(.horizontal) {
                                    HStack(spacing: 10) {
                                        DIPPhotoEventCard(
                                            title: "Puppy Yoga", locality: "Lawrenceville, PA",
                                            imageName: "EventCard",
                                            avatars: ["AvatarPink", "CoworkerProfilePicture1", "AvatarTeal"],
                                            attendeeCount: 7
                                        ) { onSelect("Puppy Yoga") }
                                        DIPPhotoEventCard(
                                            title: "Kayaking", locality: "Delaware River, NJ",
                                            imageName: "EventCard1",
                                            avatars: [
                                                "CoworkerProfilePicture2", "AvatarRed", "CoworkerProfilePicture1",
                                            ],
                                            attendeeCount: 13, shade: 0.2
                                        ) { onSelect("Kayaking") }
                                        DIPPhotoEventCard(
                                            title: "Hike", locality: "Poconos, PA",
                                            imageName: "EventCard2",
                                            avatars: [
                                                "CoworkerProfilePicture", "CoworkerProfilePicture2", "AvatarTeal",
                                            ],
                                            attendeeCount: 10, width: 169, shade: 0.08
                                        ) { onSelect("Hike") }
                                    }
                                    .padding(.horizontal, 20)
                                }
                                .scrollIndicators(.hidden)
                                .frame(height: 205).padding(.horizontal, -20)
                                .accessibilityIdentifier("home.events")
                            }
                            VStack(alignment: .leading, spacing: 14) {
                                sectionTitle("Attended Your Recent Events:")
                                HStack(spacing: 10) {
                                    ForEach(3...7, id: \.self) { index in
                                        DIPReferenceAssets.image("CoworkerProfilePicture\(index)")
                                            .resizable().frame(width: 40, height: 40).accessibilityHidden(true)
                                    }
                                    Button {
                                        onSelect("Recent attendees")
                                    } label: {
                                        Text("See All").font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                                            .foregroundStyle(.white).frame(maxWidth: .infinity).frame(height: 40)
                                            .background(
                                                DIPTokens.Color.navigationBackground.swiftUIColor, in: Capsule())
                                    }
                                    .buttonStyle(.plain).accessibilityIdentifier("home.attendees")
                                }
                            }
                        }
                        .padding(.horizontal, 20).padding(.bottom, 120)
                    }
                    .scrollIndicators(.hidden)
                }
                .padding(.bottom, 22)
                DIPFloatingNavigation { if $0 != .home { onSelect($0.rawValue) } }
                    .padding(.horizontal, 20)
                    .position(x: geometry.size.width / 2, y: geometry.size.height - 61)
            }
            .clipped()
        }
        .ignoresSafeArea()
        .preferredColorScheme(.light)
    }
    private func sectionTitle(_ text: String, size: CGFloat = 17) -> some View {
        Text(text).font(DIPReferenceAssets.font("Figtree-Regular", size: size))
            .foregroundStyle(.black).frame(height: 22, alignment: .leading)
    }
}
