import Foundation

/// A coworker attending an event, from the server-written RSVP snapshot (never a private profile).
struct RsvpAttendee: Equatable, Sendable {
    let userID: String
    let name: String
    let department: String
    let avatarID: String
    /// "" when the RSVP predates job titles or the member has none.
    var jobTitle: String = ""
}

/// User-facing RSVP failures, mapped from setRsvpV1 `reason` details and SDK errors.
enum RsvpFailure: Error, Equatable {
    case full, closed, notFound, notMember, unauthenticated, unavailable, unknown

    var message: String {
        switch self {
        case .full: String(localized: "event.rsvp.error.full", defaultValue: "This event is full.", comment: "Join/leave error: event is full")
        case .closed: String(localized: "event.rsvp.error.closed", defaultValue: "This event has already started or was cancelled.", comment: "Join/leave error: event already started or cancelled")
        case .notFound: String(localized: "event.rsvp.error.notFound", defaultValue: "This event no longer exists.", comment: "Join/leave error: event deleted")
        case .notMember: String(localized: "event.rsvp.error.notMember", defaultValue: "You can only join events at your company.", comment: "Join/leave error: event belongs to another company")
        case .unauthenticated: String(localized: "error.signInAgain", defaultValue: "Please sign in again.", comment: "User-facing error: the session expired, shown near the action that failed")
        case .unavailable: String(localized: "event.rsvp.error.unavailable", defaultValue: "You're offline. Check your connection and try again.", comment: "Join/leave error: no connection")
        case .unknown: String(localized: "event.rsvp.error.unknown", defaultValue: "Couldn’t change your RSVP. Please try again.", comment: "Join/leave error: unexpected failure")
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
