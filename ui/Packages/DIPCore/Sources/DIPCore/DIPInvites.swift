import Foundation

// Coworker invitations (V2-01 / F4): value types, pure rules and the repository protocol the UI depends on.
// The Firebase adapter (sendInviteV1 / respondToInviteV1 / listCoworkersV1 + invite listeners) and the in-memory
// mock live behind `DIPInvitesRepository`; nothing here knows about Firebase.

/// One coworker in the invite picker: the server's minimal directory entry (name, team, app-assigned avatar).
public struct DIPCoworker: Identifiable, Equatable, Sendable {
    public enum State: String, Equatable, Sendable { case available, going, invited }
    public var id: String
    public var name: String
    public var team: String
    public var avatar: MediaReference
    public var state: State
    public init(id: String, name: String, team: String = "", avatar: MediaReference? = nil, state: State = .available) {
        self.id = id; self.name = name; self.team = team
        self.avatar = avatar ?? .generatedAvatar(userID: id); self.state = state
    }
}

public enum DIPInviteStatus: String, Equatable, Sendable { case pending, accepted, declined }

/// An invitation as the signed-in member sees it. `personName`/`avatar` are the other party: the sender for a
/// received invite, the recipient for a sent one.
public struct DIPInvite: Identifiable, Equatable, Sendable {
    public var id: String
    public var eventID: String
    public var eventTitle: String
    public var eventStart: Date
    public var personID: String
    public var personName: String
    public var avatar: MediaReference
    public var message: String
    public var status: DIPInviteStatus
    public var createdAt: Date
    public init(id: String, eventID: String, eventTitle: String, eventStart: Date, personID: String, personName: String,
                avatar: MediaReference? = nil, message: String = "", status: DIPInviteStatus = .pending, createdAt: Date) {
        self.id = id; self.eventID = eventID; self.eventTitle = eventTitle; self.eventStart = eventStart
        self.personID = personID; self.personName = personName; self.avatar = avatar ?? .generatedAvatar(userID: personID)
        self.message = message; self.status = status; self.createdAt = createdAt
    }
}

public struct DIPInvites: Equatable, Sendable {
    public var received: [DIPInvite]
    public var sent: [DIPInvite]
    public init(received: [DIPInvite] = [], sent: [DIPInvite] = []) { self.received = received; self.sent = sent }
}

/// What answering an invitation did. `joined` is true when an accepted invite put the member on the guest list.
public struct DIPInviteReply: Equatable, Sendable {
    public var status: DIPInviteStatus
    public var joined: Bool
    public init(status: DIPInviteStatus, joined: Bool) { self.status = status; self.joined = joined }
}

/// User-facing failures, mapped from the callable `reason` details and SDK errors by the adapter.
public enum DIPInviteFailure: Error, Equatable, Sendable {
    case alreadyInvited, alreadyGoing, full, closed, cancelled, notFound, rateLimited, notMember, unauthenticated, offline, unknown

    public var message: String {
        switch self {
        case .alreadyInvited: "Someone already invited this coworker to this activity."
        case .alreadyGoing: "This coworker is already going."
        case .full: "This activity is full."
        case .closed: "This activity has already started."
        case .cancelled: "This activity was cancelled."
        case .notFound: "This invitation or activity is no longer available."
        case .rateLimited: "You’ve sent a lot of invitations. Try again a little later."
        case .notMember: "You can only invite coworkers from your company."
        case .unauthenticated: "Please sign in again."
        case .offline: "You’re offline. Check your connection and try again."
        case .unknown: "Something went wrong. Please try again."
        }
    }

    /// Worth offering "Try again" (the same request may succeed); the others will keep failing.
    public var isRetryable: Bool {
        switch self { case .offline, .unknown, .rateLimited: true; default: false }
    }
}

/// UI depends only on this protocol. Implementations own validation, idempotency and persistence.
public protocol DIPInvitesRepository: Sendable {
    /// Received and sent invitations, live. Finishing with an error means the listener failed (offline, denied).
    func observe() async -> AsyncThrowingStream<DIPInvites, Error>
    /// Same-company coworkers whose name matches `query` (at least two characters), with their state for the event.
    func searchCoworkers(eventID: String, query: String) async throws -> [DIPCoworker]
    /// Sends one invitation. `requestID` makes a retry safe: the same id never creates a second invitation.
    func send(eventID: String, toUserID: String, message: String, requestID: String) async throws
    func respond(inviteID: String, accept: Bool) async throws -> DIPInviteReply
}

public enum DIPInviteDenial: Equatable, Sendable {
    case cancelled, started, ended, full
    public var message: String {
        switch self {
        case .cancelled: "This activity was cancelled."
        case .started: "This activity has already started."
        case .ended: "This activity has ended."
        case .full: "This activity is full, so there is no space to invite someone."
        }
    }
}

public enum DIPInviteRules {
    public static let minimumQueryLength = 2
    public static let messageLimit = 200

    /// Mirrors `sendInviteV1`: a scheduled event that has not started and still has a place.
    public static func denial(_ metadata: DIPEventMetadata, attendeeCount: Int, now: Date) -> DIPInviteDenial? {
        if metadata.status == .cancelled { return .cancelled }
        if metadata.endTime <= now { return .ended }
        if metadata.startTime <= now { return .started }
        if attendeeCount >= metadata.capacity { return .full }
        return nil
    }

    /// The trimmed query, or nil while it is too short to search (the server refuses it as well).
    public static func searchTerm(_ raw: String) -> String? {
        let term = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return term.count >= minimumQueryLength && term.count <= 40 ? term : nil
    }

    /// Trims and caps an optional note to the contract limit.
    public static func note(_ raw: String) -> String {
        String(raw.trimmingCharacters(in: .whitespacesAndNewlines).prefix(messageLimit))
    }

    /// A fresh idempotency key (`[A-Za-z0-9_-]{8,128}`).
    public static func newRequestID() -> String {
        UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
    }
}

/// How the sent list labels an invitation. A pending invite for an event that already started is "Expired".
public enum DIPInviteStatusLabel: String, Equatable, Sendable {
    case pending = "Pending", accepted = "Accepted", declined = "Declined", expired = "Expired"
}

/// Pure projection of the repository state for the Invitations screen.
public struct DIPInviteInbox: Equatable, Sendable {
    /// Pending invitations to events that have not started, soonest event first.
    public var pending: [DIPInvite]
    /// Accepted invitations to events that have not started (the member is going), soonest first.
    public var accepted: [DIPInvite]
    /// Invitations the member sent, newest first (all statuses).
    public var sent: [DIPInvite]
    public var now: Date

    public init(_ invites: DIPInvites, now: Date) {
        self.now = now
        let upcoming = invites.received.filter { $0.eventStart > now }
        func byStart(_ a: DIPInvite, _ b: DIPInvite) -> Bool {
            (a.eventStart, a.createdAt, a.id) < (b.eventStart, b.createdAt, b.id)
        }
        pending = upcoming.filter { $0.status == .pending }.sorted(by: byStart)
        accepted = upcoming.filter { $0.status == .accepted }.sorted(by: byStart)
        sent = invites.sent.sorted { ($0.createdAt, $0.id) > ($1.createdAt, $1.id) }
    }

    /// The count on the bell: invitations waiting for an answer.
    public var badgeCount: Int { pending.count }
    public var isEmptyReceived: Bool { pending.isEmpty && accepted.isEmpty }

    public func label(for invite: DIPInvite) -> DIPInviteStatusLabel {
        switch invite.status {
        case .accepted: .accepted
        case .declined: .declined
        case .pending: invite.eventStart <= now ? .expired : .pending
        }
    }

    /// Short one-liner for list rows ("Fri, Nov 13 · 4:03 PM"), so a row never needs a third line.
    public static func shortWhenText(_ date: Date, locale: Locale = .current, timeZone: TimeZone = .current) -> String {
        let day = date.formatted(Date.FormatStyle(locale: locale, timeZone: timeZone).weekday(.abbreviated).month(.abbreviated).day())
        let time = date.formatted(Date.FormatStyle(locale: locale, timeZone: timeZone).hour().minute())
        return "\(day) · \(time)"
    }

    /// One line for a row: "Thu, Nov 19 at 6:30 PM".
    public static func whenText(_ date: Date, locale: Locale = .current, timeZone: TimeZone = .current) -> String {
        let style = Date.FormatStyle(locale: locale, timeZone: timeZone)
            .weekday(.abbreviated).month(.abbreviated).day().hour().minute()
        return date.formatted(style)
    }
}
