import DIPCore

/// Opt-in review data for the designed empty states. Each case empties one part of the reference
/// fixture and leaves everything else, and `DIPMockFixtures.reference` itself, unchanged.
public enum DIPEmptyStateFixture: String, CaseIterable, Sendable {
    /// No upcoming company events: Home's carousel and My Events' Active list are both empty.
    case homeEvents = "home-events"
    /// No recent co-attendees on Home.
    case homeRecents = "home-recents"
    /// Puppy Yoga has no one going: event page and participants list.
    case attendees
    /// The member has joined nothing: My Events' Active and Memories are both empty.
    case myEvents = "my-events"
    /// The Kayaking album has no photos.
    case album

    /// The `--screen=` destination that shows this state.
    public var screen: String {
        switch self {
        case .homeEvents, .homeRecents: "home"
        case .attendees: "event"
        case .myEvents: "events"
        case .album: "album"
        }
    }
}

extension DIPMockFixtures {
    public static func emptyStateReview(_ fixture: DIPEmptyStateFixture) -> DIPAppSnapshot {
        var snapshot = reference
        switch fixture {
        case .homeEvents:
            let upcoming = snapshot.eventDetails.values.filter { !$0.isPast }.map(\.id)
            for id in upcoming { snapshot.eventDetails[id] = nil }
            snapshot.home.events = []
            snapshot.activeEvents = []
        case .homeRecents:
            snapshot.home.recentAttendeeAvatars = []
        case .attendees:
            snapshot.eventDetails["puppy-yoga"]?.attendeeCount = 0
            snapshot.eventDetails["puppy-yoga"]?.attendeeAvatars = []
            snapshot.participants["puppy-yoga"] = []
        case .myEvents:
            for id in snapshot.eventDetails.keys { snapshot.eventDetails[id]?.isJoined = false }
            snapshot.activeEvents = []
            snapshot.memories = []
        case .album:
            snapshot.albums["kayaking-memory"]?.photos = []
            snapshot.photoComments["kayaking-memory"] = nil
        }
        return snapshot
    }
}
