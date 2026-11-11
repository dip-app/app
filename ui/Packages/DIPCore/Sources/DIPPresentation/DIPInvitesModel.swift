import DIPCore
import Foundation
import Observation

private func failure(_ error: Error) -> DIPInviteFailure {
    (error as? DIPInviteFailure) ?? .unknown
}

/// The signed-in member's invitations: received (answer them) and sent (their status), observed from the repository.
/// Commands never fake success; a local status update only follows a successful reply, and the live listener confirms it.
@MainActor @Observable
public final class DIPInvitesModel {
    public enum Phase: Equatable, Sendable { case loading, ready, failed(String) }

    public private(set) var invites: DIPInvites?
    public private(set) var phase: Phase = .loading
    /// The listener failed after data arrived: what is shown is the last good state (offline).
    public private(set) var isStale = false
    public private(set) var answering: Set<String> = []
    public private(set) var answerErrors: [String: DIPInviteFailure] = [:]
    /// Accepted in this session (the row shows "You're going" and an Open action).
    public private(set) var joinedInviteIDs: Set<String> = []

    @ObservationIgnored private let repository: any DIPInvitesRepository
    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private var generation = UUID()

    public init(repository: any DIPInvitesRepository, now: @escaping () -> Date = { Date() }) {
        self.repository = repository; self.now = now
    }

    /// Called from the host's structured task; cancelling the task removes the listener.
    public func observe() async {
        let current = UUID()
        generation = current
        if invites == nil { phase = .loading }
        do {
            let stream = await repository.observe()
            for try await value in stream {
                guard !Task.isCancelled, generation == current else { return }
                invites = value; phase = .ready; isStale = false
            }
            guard !Task.isCancelled, generation == current else { return }
            markUnavailable("Updates stopped. Check your connection.")
        } catch {
            guard !Task.isCancelled, generation == current else { return }
            markUnavailable((error as? DIPInviteFailure)?.message ?? "Couldn’t load your invitations. Please try again.")
        }
    }

    private func markUnavailable(_ message: String) {
        if invites != nil { isStale = true } else { phase = .failed(message) }
    }

    public var inbox: DIPInviteInbox { DIPInviteInbox(invites ?? DIPInvites(), now: now()) }
    /// Waiting invitations for the bell badge; 0 until the first snapshot.
    public var badgeCount: Int { inbox.badgeCount }

    /// Accepts or declines. Returns the reply on success, nil on failure (see `answerErrors[inviteID]`).
    @discardableResult
    public func respond(inviteID: String, accept: Bool) async -> DIPInviteReply? {
        guard !answering.contains(inviteID) else { return nil }
        answering.insert(inviteID); answerErrors[inviteID] = nil
        defer { answering.remove(inviteID) }
        do {
            let reply = try await repository.respond(inviteID: inviteID, accept: accept)
            if var all = invites, let index = all.received.firstIndex(where: { $0.id == inviteID }) {
                all.received[index].status = reply.status
                invites = all
            }
            if reply.joined { joinedInviteIDs.insert(inviteID) }
            return reply
        } catch {
            answerErrors[inviteID] = failure(error)
            return nil
        }
    }

    public func clearAnswerError(_ inviteID: String) { answerErrors[inviteID] = nil }

    public func makePicker(eventID: String) -> DIPInvitePickerModel {
        DIPInvitePickerModel(eventID: eventID, repository: repository)
    }
}

/// One invite sheet for one event: debounced coworker search, an optional note, and per-person sending with
/// retry-safe request ids (a retry after an ambiguous failure reuses the id, so it can never invite twice).
@MainActor @Observable
public final class DIPInvitePickerModel {
    public enum Phase: Equatable, Sendable { case idle, searching, results, empty, failed(DIPInviteFailure) }

    public var query = ""
    public var note = ""
    public private(set) var coworkers: [DIPCoworker] = []
    public private(set) var phase: Phase = .idle
    public private(set) var sending: Set<String> = []
    public private(set) var invitedIDs: Set<String> = []
    public private(set) var rowErrors: [String: DIPInviteFailure] = [:]
    /// People the server says a coworker (not this session) already invited.
    public private(set) var alreadyInvitedIDs: Set<String> = []

    public let eventID: String
    @ObservationIgnored private let repository: any DIPInvitesRepository
    @ObservationIgnored private let debounce: Duration
    @ObservationIgnored private var requestIDs: [String: String] = [:]
    @ObservationIgnored private var searchGeneration = 0
    @ObservationIgnored private var goingIDs: Set<String> = []

    public init(eventID: String, repository: any DIPInvitesRepository, debounce: Duration = .milliseconds(300)) {
        self.eventID = eventID; self.repository = repository; self.debounce = debounce
    }

    /// True while there is text that is too short to search (the view hints at the two-letter minimum).
    public var queryTooShort: Bool {
        !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && DIPInviteRules.searchTerm(query) == nil
    }

    /// Run from `.task(id: query)`: waits for typing to pause, then searches. Cancellation drops stale work.
    public func queryChanged() async {
        guard DIPInviteRules.searchTerm(query) != nil else {
            searchGeneration += 1; coworkers = []; phase = .idle; return
        }
        phase = .searching
        try? await Task.sleep(for: debounce)
        guard !Task.isCancelled else { return }
        await search()
    }

    public func search() async {
        guard let term = DIPInviteRules.searchTerm(query) else { coworkers = []; phase = .idle; return }
        searchGeneration += 1
        let mine = searchGeneration
        phase = .searching
        do {
            let found = try await repository.searchCoworkers(eventID: eventID, query: term)
            guard mine == searchGeneration, !Task.isCancelled else { return }
            coworkers = found
            goingIDs.formUnion(found.filter { $0.state == .going }.map(\.id))
            phase = found.isEmpty ? .empty : .results
        } catch {
            guard mine == searchGeneration, !Task.isCancelled else { return }
            coworkers = []; phase = .failed(failure(error))
        }
    }

    /// The row state, with this session's own sends applied on top of the server's answer.
    public func state(of coworker: DIPCoworker) -> DIPCoworker.State {
        if invitedIDs.contains(coworker.id) { return .invited }
        if goingIDs.contains(coworker.id) { return .going }
        return coworker.state
    }

    /// Sends one invitation. True when the server accepted it (or had already created it for this request).
    @discardableResult
    public func send(_ coworker: DIPCoworker) async -> Bool {
        guard state(of: coworker) == .available, !sending.contains(coworker.id) else { return false }
        let requestID = requestIDs[coworker.id] ?? DIPInviteRules.newRequestID()
        requestIDs[coworker.id] = requestID
        sending.insert(coworker.id); rowErrors[coworker.id] = nil
        defer { sending.remove(coworker.id) }
        do {
            try await repository.send(eventID: eventID, toUserID: coworker.id, message: DIPInviteRules.note(note), requestID: requestID)
            invitedIDs.insert(coworker.id); requestIDs[coworker.id] = nil
            return true
        } catch {
            let reason = failure(error)
            switch reason {
            case .alreadyInvited: invitedIDs.insert(coworker.id); alreadyInvitedIDs.insert(coworker.id); requestIDs[coworker.id] = nil
            case .alreadyGoing: goingIDs.insert(coworker.id); requestIDs[coworker.id] = nil
            // A definite refusal will not succeed on retry, so the next attempt starts a fresh request.
            case .full, .closed, .cancelled, .notFound, .notMember, .unauthenticated: requestIDs[coworker.id] = nil
            case .offline, .unknown, .rateLimited: break
            }
            rowErrors[coworker.id] = reason
            return false
        }
    }

    public func dismissRowError(_ id: String) { rowErrors[id] = nil }
}
