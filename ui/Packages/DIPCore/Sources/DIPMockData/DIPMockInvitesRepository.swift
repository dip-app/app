import DIPCore
import Foundation

/// In-memory invitations for previews, Debug fixtures and tests; never a Firebase adapter.
/// It follows the server contract: one invitation per person per event, `requestID` idempotency, going coworkers
/// cannot be invited, and an accepted invitation to a full event fails and stays pending.
public actor DIPMockInvitesRepository: DIPInvitesRepository {
    public struct Person: Equatable, Sendable {
        public var id: String
        public var name: String
        public var team: String
        public init(id: String, name: String, team: String = "") { self.id = id; self.name = name; self.team = team }
    }

    /// What the next calls do instead of succeeding (`--invites-state=` flags map to these in the shell).
    public struct Behavior: Equatable, Sendable {
        public var observeFailure = false
        public var searchFailure: DIPInviteFailure?
        public var sendFailure: DIPInviteFailure?
        public var respondFailure: DIPInviteFailure?
        public var latency: Duration = .zero
        /// Extra wait before `send` answers (to review the sending state).
        public var sendLatency: Duration = .zero
        public init(observeFailure: Bool = false, searchFailure: DIPInviteFailure? = nil, sendFailure: DIPInviteFailure? = nil,
                    respondFailure: DIPInviteFailure? = nil, latency: Duration = .zero, sendLatency: Duration = .zero) {
            self.observeFailure = observeFailure; self.searchFailure = searchFailure; self.sendFailure = sendFailure
            self.respondFailure = respondFailure; self.latency = latency; self.sendLatency = sendLatency
        }
    }

    private var invites: DIPInvites
    private let directory: [Person]
    private var goingByEvent: [String: Set<String>]
    private var fullEvents: Set<String>
    private var eventTitles: [String: (title: String, start: Date)]
    private var sentRequests: [String: String] = [:]
    private var behavior: Behavior
    private let me: Person
    private let now: @Sendable () -> Date
    private var observers: [UUID: AsyncThrowingStream<DIPInvites, Error>.Continuation] = [:]
    public private(set) var sendCount = 0
    public private(set) var respondCount = 0

    public init(me: Person = Person(id: "me", name: "You"), directory: [Person] = DIPMockInvitesRepository.referenceDirectory,
                invites: DIPInvites = DIPInvites(), goingByEvent: [String: Set<String>] = [:], fullEvents: Set<String> = [],
                events: [String: (title: String, start: Date)] = [:], behavior: Behavior = Behavior(),
                now: @escaping @Sendable () -> Date = { Date() }) {
        self.me = me; self.directory = directory; self.invites = invites; self.goingByEvent = goingByEvent
        self.fullEvents = fullEvents; self.eventTitles = events; self.behavior = behavior; self.now = now
    }

    public static let referenceDirectory: [Person] = [
        Person(id: "u-priya", name: "Priya Shah", team: "Design"), Person(id: "u-theo", name: "Theo Marsh", team: "Engineering"),
        Person(id: "u-jordan", name: "Jordan Lee", team: "People"), Person(id: "u-sam", name: "Sam Okafor", team: "Finance"),
        Person(id: "u-mia", name: "Mia Rossi", team: "Operations"), Person(id: "u-prisha", name: "Prisha Nair", team: "Engineering"),
    ]

    /// The design-review fixture: two pending and one accepted received invitation, three sent in every status.
    public static func reference(now: Date = Date(), behavior: Behavior = Behavior()) -> DIPMockInvitesRepository {
        let day: TimeInterval = 86_400
        func invite(_ id: String, _ event: String, _ title: String, in days: Double, person: Person,
                    message: String = "", status: DIPInviteStatus = .pending, ago: TimeInterval) -> DIPInvite {
            DIPInvite(id: id, eventID: event, eventTitle: title, eventStart: now.addingTimeInterval(days * day),
                      personID: person.id, personName: person.name, message: message, status: status, createdAt: now.addingTimeInterval(-ago))
        }
        let directory = referenceDirectory
        let theo = directory[1], priya = directory[0], jordan = directory[2], sam = directory[3]
        let received = [
            invite("e1_me", "puppy-yoga", "Puppy Yoga", in: 2, person: theo, message: "Say yes, there are puppies.", ago: 3_600),
            invite("e2_me", "kayaking-sunrise", "Sunrise Kayaking", in: 5, person: priya, ago: 7_200),
            invite("e3_me", "pasta-night", "Pasta Night", in: 3, person: jordan, status: .accepted, ago: 86_400),
            // Accepted earlier, then the member left Kayaking (it is not joined in the fixtures): offered a Rejoin.
            invite("e4_me", "kayaking", "Kayaking", in: 4, person: directory[4], status: .accepted, ago: 172_800),
        ]
        let sent = [
            invite("e1_u-mia", "puppy-yoga", "Puppy Yoga", in: 2, person: directory[4], ago: 1_800),
            invite("e1_u-sam", "puppy-yoga", "Puppy Yoga", in: 2, person: sam, status: .accepted, ago: 5_400),
            invite("e4_u-theo", "pasta-night", "Pasta Night", in: 3, person: theo, status: .declined, ago: 9_000),
        ]
        return DIPMockInvitesRepository(
            invites: DIPInvites(received: received, sent: sent),
            goingByEvent: ["puppy-yoga": ["u-sam"]],
            events: ["puppy-yoga": ("Puppy Yoga", now.addingTimeInterval(2 * day)),
                     "pasta-night": ("Pasta Night", now.addingTimeInterval(3 * day)),
                     "kayaking-sunrise": ("Sunrise Kayaking", now.addingTimeInterval(5 * day))],
            behavior: behavior, now: { now })
    }

    public static func empty(behavior: Behavior = Behavior()) -> DIPMockInvitesRepository {
        DIPMockInvitesRepository(behavior: behavior)
    }

    public func setBehavior(_ behavior: Behavior) { self.behavior = behavior }
    public func markFull(_ eventID: String) { fullEvents.insert(eventID) }
    public func current() -> DIPInvites { invites }

    public func observe() async -> AsyncThrowingStream<DIPInvites, Error> {
        let (stream, continuation) = AsyncThrowingStream<DIPInvites, Error>.makeStream(bufferingPolicy: .bufferingNewest(1))
        if behavior.latency > .zero { try? await Task.sleep(for: behavior.latency) }
        if behavior.observeFailure { continuation.finish(throwing: DIPInviteFailure.offline); return stream }
        let id = UUID()
        observers[id] = continuation
        continuation.onTermination = { [weak self] _ in Task { await self?.removeObserver(id) } }
        continuation.yield(invites)
        return stream
    }

    public func searchCoworkers(eventID: String, query: String) async throws -> [DIPCoworker] {
        if behavior.latency > .zero { try? await Task.sleep(for: behavior.latency) }
        if let failure = behavior.searchFailure { throw failure }
        guard let term = DIPInviteRules.searchTerm(query)?.lowercased() else { throw DIPInviteFailure.unknown }
        let going = goingByEvent[eventID] ?? []
        let invited = Set(invites.sent.filter { $0.eventID == eventID }.map(\.personID))
        return directory
            .filter { $0.id != me.id && Self.matches($0.name, term) }
            .sorted { ($0.name.lowercased().hasPrefix(term) ? 0 : 1, $0.name) < ($1.name.lowercased().hasPrefix(term) ? 0 : 1, $1.name) }
            .prefix(20)
            .map { person in
                DIPCoworker(id: person.id, name: person.name, team: person.team,
                            state: going.contains(person.id) ? .going : invited.contains(person.id) ? .invited : .available)
            }
    }

    public func send(eventID: String, toUserID: String, message: String, requestID: String) async throws {
        if behavior.latency > .zero { try? await Task.sleep(for: behavior.latency) }
        if behavior.sendLatency > .zero { try? await Task.sleep(for: behavior.sendLatency) }
        if let failure = behavior.sendFailure { throw failure }
        guard let person = directory.first(where: { $0.id == toUserID }), toUserID != me.id else { throw DIPInviteFailure.notFound }
        let inviteID = "\(eventID)_\(toUserID)"
        if let existing = invites.sent.first(where: { $0.id == inviteID }) {
            // A replay of the same request returns the stored invitation; anything else is a duplicate.
            if sentRequests[inviteID] == requestID { _ = existing; return }
            throw DIPInviteFailure.alreadyInvited
        }
        if (goingByEvent[eventID] ?? []).contains(toUserID) { throw DIPInviteFailure.alreadyGoing }
        if fullEvents.contains(eventID) { throw DIPInviteFailure.full }
        let event = eventTitles[eventID] ?? (eventID, now().addingTimeInterval(86_400))
        sendCount += 1
        sentRequests[inviteID] = requestID
        invites.sent.append(DIPInvite(id: inviteID, eventID: eventID, eventTitle: event.title, eventStart: event.start,
                                      personID: person.id, personName: person.name, message: message, createdAt: now()))
        publish()
    }

    public func respond(inviteID: String, accept: Bool) async throws -> DIPInviteReply {
        if behavior.latency > .zero { try? await Task.sleep(for: behavior.latency) }
        if let failure = behavior.respondFailure { throw failure }
        guard let index = invites.received.firstIndex(where: { $0.id == inviteID }) else { throw DIPInviteFailure.notFound }
        let invite = invites.received[index]
        let wanted: DIPInviteStatus = accept ? .accepted : .declined
        if invite.status != .pending {
            if invite.status == wanted { return DIPInviteReply(status: wanted, joined: accept) }
            throw DIPInviteFailure.alreadyAnswered
        }
        if accept {
            if invite.eventStart <= now() { throw DIPInviteFailure.closed }
            if fullEvents.contains(invite.eventID) { throw DIPInviteFailure.full }
            goingByEvent[invite.eventID, default: []].insert(me.id)
        }
        respondCount += 1
        invites.received[index].status = wanted
        publish()
        return DIPInviteReply(status: wanted, joined: accept)
    }

    private func publish() { observers.values.forEach { $0.yield(invites) } }
    private func removeObserver(_ id: UUID) { observers.removeValue(forKey: id) }

    private static func matches(_ name: String, _ term: String) -> Bool {
        let lower = name.lowercased()
        let words = term.split(separator: " ").map(String.init)
        let parts = lower.split(whereSeparator: { $0 == " " || $0 == "-" }).map(String.init)
        return !words.isEmpty && words.allSatisfy { word in parts.contains { $0.hasPrefix(word) } || lower.contains(word) }
    }
}
