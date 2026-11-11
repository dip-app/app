import DIPCore
import DIPDesignSystem
import SwiftUI

/// Review states for long event titles, `--long-titles=active|memories|home`: My Events cards and tiles
/// and Home cards with names long enough to wrap.
struct LongTitlesPreview: View {
    let mode: String

    static func launchMode() -> String? {
        ProcessInfo.processInfo.arguments.first { $0.hasPrefix("--long-titles=") }
            .map { String($0.dropFirst("--long-titles=".count)) }
    }

    private static let titles = [
        "Arianne's Carpentry Bash", "Lunch & Learn: Cooking Basics", "Game Night: Board Games & Pizza", "Boat Ride", "Ceramics",
    ]
    private static let images = ["events-past_EventCard3", "events-past_EventCard4", "events-past_EventCard5", "events-past_EventCard6"]
    private let avatars: [MediaReference] = [.asset("AvatarRed"), .asset("AvatarTeal"), .asset("AvatarPink")]

    var body: some View {
        switch mode {
        case "home":
            ScrollView(.horizontal) {
                HStack(spacing: 12) {
                    ForEach(Array(Self.titles.prefix(4).enumerated()), id: \.offset) { index, title in
                        DIPPhotoEventCard(
                            title: title, locality: "Lawrenceville, PA · Pittsburgh", identifier: "long-\(index)", attendeeCount: 7,
                            artwork: { DIPMedia(.asset(Self.images[index % 4])).resizable().scaledToFill() },
                            avatarStack: { DIPMediaStack(avatars) }, onSelect: {})
                    }
                }
                .padding(20)
            }
            .frame(maxHeight: .infinity, alignment: .center)
        default:
            DIPMyEventsScreen(
                activeEvents: Self.titles.enumerated().map { index, title in
                    DIPEventSummary(id: "a\(index)", title: title, locality: "Lawrenceville, PA · Pittsburgh",
                                    image: .asset(Self.images[index % 4]), avatars: avatars, attendeeCount: 7, imageShade: 0.1)
                },
                memories: Self.titles.enumerated().map { index, title in
                    DIPMemory(id: "m\(index)", eventID: "m\(index)", title: title, locality: "Pocono Mountains, PA",
                              image: .asset(Self.images[index % 4]), avatars: avatars)
                },
                unreadCount: 0, profileAvatar: .asset("AvatarTeal"), initialMemories: mode == "memories",
                showsBottomBar: false, onSelectTab: { _ in }, onEvent: { _ in }, onAlbum: { _ in },
                onNotifications: {}, onProfile: {})
        }
    }
}
