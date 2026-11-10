import DIPCore
import DIPDesignSystem
import SwiftUI
import UIKit

// Fictional, bundled content for the onboarding demos (spec §1 "Honest demos", §5 Files).
// Nothing here comes from a repository or a real company; every name and event is invented.

/// The four Crew characters (spec §1, §7.1): P purple round, W white pill, Y yellow square, G gray round.
enum CrewMember: String, CaseIterable, Sendable {
    case purple, white, yellow, gray

    var fill: Color {
        switch self {
        case .purple: OnboardingTheme.accent
        case .white: OnboardingTheme.inverse
        case .yellow: OnboardingTheme.notification
        case .gray: OnboardingTheme.muted
        }
    }

    var figure: OnboardingFace.Figure {
        switch self {
        case .purple, .gray: .round
        case .white: .pill
        case .yellow: .square
        }
    }

    /// The fictional coworker this face plays in the demos (open decision 4: names pending approval).
    var demoName: String {
        switch self {
        case .purple: "Maya"
        case .white: "Theo"
        case .yellow: "Jun"
        case .gray: "Priya"
        }
    }

    /// Default demo expression; the yellow face winks as on Welcome, the gray one is calm.
    var mood: OnboardingFace.Mood {
        switch self {
        case .purple, .white: .happy
        case .yellow: .wink
        case .gray: .calm
        }
    }

    func face(size: CGFloat, mood: OnboardingFace.Mood? = nil) -> OnboardingFace {
        OnboardingFace(fill: fill, figure: figure, mood: mood ?? self.mood, size: size)
    }
}

/// Crew faces as `MediaReference.data`, so the real `DIPDetailPeopleRow` / `DIPMediaStack` can show them
/// without forking `DIPAvatar` (spec §3 B1 "Avatars"). Each PNG is rendered once per size with
/// `ImageRenderer` at @3x and cached in memory.
@MainActor
enum CrewAvatarImages {
    private static var cache: [String: MediaReference] = [:]

    static func reference(_ member: CrewMember, size: CGFloat = 40) -> MediaReference {
        cached("\(member.rawValue)@\(size)") { member.face(size: size) }
    }

    /// "You": the person's initials in a `DIPAvatar` on `surfaceMuted` with a 3 pt white ring (spec §7.1).
    static func you(name: String, size: CGFloat = 40) -> MediaReference {
        cached("you:\(name)@\(size)") {
            DIPAvatar(person: DIPAvatarIdentity(id: "onboarding.you", name: name), size: size, isDecorative: true)
                .overlay(Circle().strokeBorder(.white, lineWidth: 3))
        }
    }

    private static func cached<Content: View>(_ key: String, _ content: () -> Content) -> MediaReference {
        if let hit = cache[key] { return hit }
        let renderer = ImageRenderer(content: content().environment(\.colorScheme, .light))
        renderer.scale = 3
        // A render can fail while SwiftUI is mid-update; never cache a failure, so the next call retries.
        guard let png = renderer.uiImage?.pngData() else { return .data(Data()) }
        let reference = MediaReference.data(png)
        cache[key] = reference
        return reference
    }
}

/// A fictional company event shown in a demo feed.
struct DemoEvent: Identifiable, Sendable {
    let id: String
    let title: String
    let locality: String
    let cover: String
    let crew: [CrewMember]
    let attendeeCount: Int
}

enum OnboardingDemoFixtures {
    /// Social activities first; the one fitness cover is fifth (spec §1 principle 4).
    static let feed: [DemoEvent] = [
        DemoEvent(id: "board-game-lunch", title: "Board Game Lunch", locality: "4th floor lounge",
                  cover: "cover_games", crew: [.purple, .yellow, .gray], attendeeCount: 5),
        DemoEvent(id: "pasta-night", title: "Pasta Night", locality: "Office kitchen",
                  cover: "cover_cooking", crew: [.purple, .yellow, .gray], attendeeCount: 5),
        DemoEvent(id: "saturday-hike", title: "Saturday Hike", locality: "Ridge trail",
                  cover: "cover_hiking", crew: [.white, .gray], attendeeCount: 4),
        DemoEvent(id: "kayak-morning", title: "Kayak Morning", locality: "Harbor dock",
                  cover: "cover_outdoors", crew: [.yellow], attendeeCount: 2),
        DemoEvent(id: "lunchtime-yoga", title: "Lunchtime Yoga", locality: "Studio B",
                  cover: "cover_fitness", crew: [.white, .purple], attendeeCount: 3),
    ]

    static var pastaNight: DemoEvent { feed[1] }
    static let pastaCapacity = 12
    static let pastaTags = ["Food", "Social"]

    /// Placeholder initials for "You" until the tour shell passes the member's name (Figma §7.1 uses "S").
    static let youPlaceholderName = "S"

    /// Fictional venue for the demo's Directions link; the canvas has hit testing off, so it never opens.
    static let directionsURL = URL(string: "https://maps.apple.com/?q=Office%20kitchen")!

    /// The demo event as the app's detail projection, so the bar comes from `EventBarAction.forEvent`.
    /// No metadata: the started/full/cancelled checks never apply to the fixture.
    static func pastaDetail(joined: Bool, avatars: [MediaReference]) -> DIPEventDetail {
        DIPEventDetail(
            id: pastaNight.id, title: pastaNight.title, image: .asset(pastaNight.cover),
            timing: "Thu · 6:30 PM", description: "Fresh pasta and a long table.", tags: pastaTags,
            isJoined: joined, attendeeCount: joined ? 6 : 5, attendeeAvatars: avatars)
    }
}
