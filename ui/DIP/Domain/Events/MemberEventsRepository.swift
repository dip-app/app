import Foundation
import DIPContracts
import DIPCore

struct EventReadScope: Hashable, Sendable {
    let uid: String
    let companyID: String
}
enum EventReadFailure: Error, Equatable {
    case unauthenticated, permissionDenied, invalidQuery, invalidCursor, invalidDocument, unavailable
}
struct EventFeedQuery: Equatable, Sendable {
    /// Retain the same lower bound while paginating; do not recompute now for each page.
    let startsAtOrAfter: Date
    let pageSize: Int
    init(startsAtOrAfter: Date, pageSize: Int = 20) { self.startsAtOrAfter = startsAtOrAfter; self.pageSize = pageSize }
}
struct EventFeedCursor: Equatable, Sendable {
    let scope: EventReadScope
    let query: EventFeedQuery
    let startTime: Date
    let eventID: String
}
struct EventFeedPage: Equatable, Sendable {
    let events: [DIPContracts.Event]
    /// A full last page can yield a cursor whose following page is empty.
    let nextCursor: EventFeedCursor?
}
@MainActor protocol EventReadSource: AnyObject {
    func feed(scope: EventReadScope, query: EventFeedQuery, after: EventFeedCursor?) async throws -> [DIPContracts.Event]
    func detail(scope: EventReadScope, eventID: String) async throws -> DIPContracts.Event?
    func observeDetail(scope: EventReadScope, eventID: String) -> AsyncThrowingStream<DIPContracts.Event?, Error>
    func stop()
}

/// One repository per observed membership. Invalidation permanently ends this tenant lease.
/// The host must clear rendered event state on invalidation/sign-out before installing another lease.
@MainActor final class MemberEventsRepository {
    let scope: EventReadScope
    private let source: any EventReadSource
    private let currentUID: () -> String?
    private var active = true
    private var observers: [UUID: (Task<Void, Never>, AsyncThrowingStream<DIPContracts.Event?, Error>.Continuation)] = [:]
    init(scope: EventReadScope, source: any EventReadSource, currentUID: @escaping () -> String?) {
        self.scope = scope; self.source = source; self.currentUID = currentUID
    }
    private func requireActive() throws {
        guard Self.validID(scope.companyID), !scope.uid.isEmpty, !scope.uid.contains("/") else { invalidate(); throw EventReadFailure.invalidQuery }
        guard active, currentUID() == scope.uid else { invalidate(); throw EventReadFailure.unauthenticated }
    }
    func invalidate() {
        guard active else { return }; active = false
        source.stop()
        for (task, continuation) in observers.values { task.cancel(); continuation.finish(throwing: EventReadFailure.unauthenticated) }
        observers.removeAll()
    }
    func feed(_ query: EventFeedQuery, after cursor: EventFeedCursor? = nil) async throws -> EventFeedPage {
        try requireActive()
        guard query.startsAtOrAfter.timeIntervalSince1970.isFinite, (1...100).contains(query.pageSize) else { throw EventReadFailure.invalidQuery }
        if let cursor {
            guard cursor.scope == scope, cursor.query == query, Self.validID(cursor.eventID),
                  cursor.startTime.timeIntervalSince1970.isFinite, cursor.startTime >= query.startsAtOrAfter else { throw EventReadFailure.invalidCursor }
        }
        let events = try await source.feed(scope: scope, query: query, after: cursor)
        try requireActive(); try Task.checkCancellation()
        guard events.count <= query.pageSize else { throw EventReadFailure.invalidDocument }
        var previous = cursor.map { ($0.startTime, $0.eventID) }
        for event in events {
            try validate(event)
            guard let id = event.id, event.status == "scheduled", event.startTime >= query.startsAtOrAfter else { throw EventReadFailure.invalidDocument }
            if let previous { guard event.startTime > previous.0 || (event.startTime == previous.0 && id > previous.1) else { throw EventReadFailure.invalidDocument } }
            previous = (event.startTime, id)
        }
        let next = events.count == query.pageSize ? events.last.map { EventFeedCursor(scope: scope, query: query, startTime: $0.startTime, eventID: $0.id!) } : nil
        return EventFeedPage(events: events, nextCursor: next)
    }
    func detail(_ eventID: String) async throws -> DIPContracts.Event? {
        try requireActive(); guard Self.validID(eventID) else { throw EventReadFailure.invalidQuery }
        let event = try await source.detail(scope: scope, eventID: eventID)
        try requireActive(); try Task.checkCancellation()
        if let event { try validate(event); guard event.id == eventID else { throw EventReadFailure.invalidDocument } }
        return event
    }
    func observeDetail(_ eventID: String) -> AsyncThrowingStream<DIPContracts.Event?, Error> {
        AsyncThrowingStream { continuation in
            do { try requireActive(); guard Self.validID(eventID) else { throw EventReadFailure.invalidQuery } }
            catch { continuation.finish(throwing: error); return }
            let id = UUID()
            let stream = source.observeDetail(scope: scope, eventID: eventID)
            let task = Task { [weak self] in
                do {
                    for try await event in stream {
                        guard let self else { break }
                        try self.requireActive(); try Task.checkCancellation()
                        if let event { try self.validate(event); guard event.id == eventID else { throw EventReadFailure.invalidDocument } }
                        continuation.yield(event)
                    }
                    continuation.finish()
                } catch { continuation.finish(throwing: error) }
                self?.observers.removeValue(forKey: id)
            }
            observers[id] = (task, continuation)
            continuation.onTermination = { _ in task.cancel() }
        }
    }
    private func validate(_ event: DIPContracts.Event) throws {
        guard event.companyId == scope.companyID, let id = event.id, Self.validID(id),
              event.endTime > event.startTime, event.revision >= 1,
              event.attendeeCount >= 0, (1...10000).contains(event.capacity), event.costCents >= 0,
              DIPEventStatus(rawValue: event.status) != nil else { throw EventReadFailure.invalidDocument }
    }
    nonisolated static func validID(_ id: String) -> Bool {
        !id.isEmpty && id.count <= 128 && id.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil
    }
    nonisolated static func metadata(_ event: DIPContracts.Event) throws -> DIPEventMetadata {
        guard let status = DIPEventStatus(rawValue: event.status), event.endTime > event.startTime,
              event.costCents >= 0, event.capacity >= 1, event.revision >= 1 else { throw EventReadFailure.invalidDocument }
        return DIPEventMetadata(startTime: event.startTime, endTime: event.endTime, venueName: event.venue.name,
            address: event.venue.address, locality: event.venue.locality, costCents: event.costCents,
            costNote: event.costNote, capacity: event.capacity, status: status, revision: event.revision)
    }
}
