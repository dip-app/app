import Foundation

/// Why a join or leave is refused locally, before any optimistic change. Mirrors `setRsvpV1`:
/// joining needs a scheduled, future-start event with a free place (unless already going);
/// leaving needs a current RSVP and an event that has not started.
public enum DIPRsvpDenial: Equatable, Sendable {
    case alreadyGoing, notGoing, full, started, ended, cancelled

    public var message: String {
        switch self {
        case .alreadyGoing: "You’re already going to this activity."
        case .notGoing: "You’re not going to this activity."
        case .full: "Couldn’t join: the event is full."
        case .started: "This activity has already started."
        case .ended: "This activity has ended."
        case .cancelled: "This activity was cancelled."
        }
    }
}

public enum DIPParticipationRules {
    /// nil means the join may proceed.
    public static func joinDenial(_ metadata: DIPEventMetadata, attendeeCount: Int, isGoing: Bool, now: Date) -> DIPRsvpDenial? {
        if isGoing { return .alreadyGoing }
        if metadata.status == .cancelled { return .cancelled }
        if metadata.endTime <= now { return .ended }
        if metadata.startTime <= now { return .started }
        if attendeeCount >= metadata.capacity { return .full }
        return nil
    }

    /// nil means the leave may proceed.
    public static func leaveDenial(_ metadata: DIPEventMetadata, isGoing: Bool, now: Date) -> DIPRsvpDenial? {
        if !isGoing { return .notGoing }
        if metadata.status == .cancelled { return .cancelled }
        if metadata.endTime <= now { return .ended }
        if metadata.startTime <= now { return .started }
        return nil
    }

    public static func denial(going: Bool, metadata: DIPEventMetadata, attendeeCount: Int, isGoing: Bool, now: Date) -> DIPRsvpDenial? {
        going ? joinDenial(metadata, attendeeCount: attendeeCount, isGoing: isGoing, now: now)
              : leaveDenial(metadata, isGoing: isGoing, now: now)
    }
}

/// Optimistic RSVP for one event: the UI shows the intended state at once and the server's answer
/// confirms or rolls it back. The latest intent wins; a stale request's result is ignored.
public struct DIPOptimisticRSVP: Equatable, Sendable {
    public struct Pending: Equatable, Sendable {
        public let going: Bool
        public let requestID: String
        public let baseCount: Int
    }

    public private(set) var confirmedGoing: Bool
    public private(set) var confirmedCount: Int
    public private(set) var pending: Pending?

    public init(going: Bool, attendeeCount: Int) { confirmedGoing = going; confirmedCount = attendeeCount }

    public var isGoing: Bool { pending?.going ?? confirmedGoing }

    public var attendeeCount: Int {
        guard let pending, pending.going != confirmedGoing else { return confirmedCount }
        return max(0, pending.baseCount + (pending.going ? 1 : -1))
    }

    /// Starts an intent. Returns false when it changes nothing (already in that state, nothing in flight).
    @discardableResult
    public mutating func begin(going: Bool, requestID: String) -> Bool {
        guard going != isGoing else { return false }
        pending = Pending(going: going, requestID: requestID, baseCount: confirmedCount)
        return true
    }

    /// The server acknowledged `requestID`. A stale acknowledgement (a newer intent exists) is ignored.
    public mutating func succeed(requestID: String, serverCount: Int?) {
        guard pending?.requestID == requestID, let pending else { return }
        confirmedGoing = pending.going
        if let serverCount { confirmedCount = serverCount }
        self.pending = nil
    }

    /// Rolls back to the confirmed state, unless a newer intent replaced this request.
    @discardableResult
    public mutating func fail(requestID: String) -> Bool {
        guard pending?.requestID == requestID else { return false }
        pending = nil
        return true
    }

    /// Observed server state. While an intent is in flight, state that does not yet match it is the
    /// stale pre-write value, so the optimistic state stays; matching state confirms the intent.
    public mutating func observe(going: Bool, attendeeCount: Int) {
        if let pending, pending.going != going { confirmedCount = attendeeCount; return }
        confirmedGoing = going; confirmedCount = attendeeCount; pending = nil
    }
}
