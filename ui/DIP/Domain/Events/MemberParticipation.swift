import Foundation

/// A coworker attending an event, from the server-written RSVP snapshot (never a private profile).
struct RsvpAttendee: Equatable, Sendable {
    let userID: String
    let name: String
    let department: String
    let avatarID: String
}

/// User-facing RSVP failures, mapped from setRsvpV1 `reason` details and SDK errors.
enum RsvpFailure: Error, Equatable {
    case full, closed, notFound, notMember, unauthenticated, unavailable, unknown

    var message: String {
        switch self {
        case .full: "This event is full."
        case .closed: "This event has already started or was cancelled."
        case .notFound: "This event no longer exists."
        case .notMember: "You can only join events at your company."
        case .unauthenticated: "Please sign in again."
        case .unavailable: "You're offline. Check your connection and try again."
        case .unknown: "Couldn’t change your RSVP. Please try again."
        }
    }
}

/// Join/leave through setRsvpV1, the caller's own "going" RSVPs (My Events, joined state) and
/// attendee snapshots. One source per membership scope; `stop()` removes every listener.
@MainActor protocol ParticipationSource: AnyObject {
    /// Returns the server's attendeeCount acknowledgement. Listeners remain the rendered source.
    func setRsvp(scope: EventReadScope, eventID: String, going: Bool) async throws -> Int
    /// Event IDs the caller is going to, updated live.
    func observeMyGoingEventIDs(scope: EventReadScope) -> AsyncThrowingStream<Set<String>, Error>
    /// Up to 100 going attendees, sorted by name.
    func attendees(scope: EventReadScope, eventID: String) async throws -> [RsvpAttendee]
    /// A few going attendees for a card's avatar stack (one bounded read; no ordering guarantee).
    func previewAttendees(scope: EventReadScope, eventID: String, limit: Int) async throws -> [RsvpAttendee]
    func stop()
}

extension ParticipationSource {
    func previewAttendees(scope: EventReadScope, eventID: String, limit: Int) async throws -> [RsvpAttendee] {
        Array(try await attendees(scope: scope, eventID: eventID).prefix(limit))
    }
}
