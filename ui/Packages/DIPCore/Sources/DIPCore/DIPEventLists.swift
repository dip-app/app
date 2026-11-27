import Foundation

/// Classifies observed event/RSVP projections using timestamps, never card titles.
/// Legacy frame fixtures retain their supplied lists until an adapter supplies metadata.
public struct DIPEventLists: Equatable, Sendable {
    public let discovery: [DIPEventSummary]
    public let upcoming: [DIPEventSummary]
    public let past: [DIPMemory]

    public init(snapshot: DIPAppSnapshot, now: Date, locale: Locale = .current, timeZone: TimeZone = .current) {
        let events = snapshot.eventDetails.values.filter { $0.metadata != nil }
        let scheduled = events.filter { $0.metadata?.status == .scheduled }
        // `completed` events (closed by an organizer) stay in a member's history alongside ended scheduled ones.
        let finished = events.filter { $0.metadata?.status == .completed }
        func ascending(_ lhs: DIPEventDetail, _ rhs: DIPEventDetail) -> Bool {
            let left = lhs.metadata!.startTime
            let right = rhs.metadata!.startTime
            return left == right ? lhs.id < rhs.id : left < right
        }
        // Built once per projection: formatters are costly to create.
        let absolute = DateFormatter()
        absolute.locale = locale
        absolute.timeZone = timeZone
        absolute.dateStyle = .medium
        absolute.timeStyle = .short
        let relative = DIPEventDateText(now: now, locale: locale, timeZone: timeZone)
        /// Date on the first line, place on the second: a one-line separator could wrap and leave a dangling dot.
        /// Upcoming cards read relative to now ("Tomorrow, 7:30 PM"); memories keep the absolute date with the year.
        func label(_ event: DIPEventDetail, past: Bool = false) -> String {
            guard let metadata = event.metadata else { return "" }
            let date = past ? absolute.string(from: metadata.startTime) : relative.string(metadata.startTime)
            return [date, metadata.locality].filter { !$0.isEmpty }.joined(separator: "\n")
        }
        func summary(_ event: DIPEventDetail) -> DIPEventSummary {
            .init(id: event.id, title: event.title, locality: label(event), image: event.image,
                  avatars: event.attendeeAvatars, attendeeCount: event.attendeeCount, tagIDs: event.tagIDs,
                  pointsValue: event.metadata?.pointsValue ?? 0)
        }
        discovery = scheduled.filter { $0.metadata!.startTime > now }.sorted(by: ascending).map(summary)
            + snapshot.home.events.filter { snapshot.eventDetails[$0.id]?.metadata == nil }
        upcoming = scheduled.filter { $0.isJoined && $0.metadata!.endTime > now }.sorted(by: ascending).map(summary)
            + snapshot.activeEvents.filter { snapshot.eventDetails[$0.id]?.metadata == nil }
        past = (scheduled.filter { $0.metadata!.endTime <= now } + finished).filter { $0.isJoined }.sorted {
            let left = $0.metadata!.endTime
            let right = $1.metadata!.endTime
            return left == right ? $0.id < $1.id : left > right
        }.map {
            .init(id: $0.id, eventID: $0.id, title: $0.title, locality: label($0, past: true), image: $0.image,
                  avatars: $0.attendeeAvatars)
        } + snapshot.memories.filter { snapshot.eventDetails[$0.eventID]?.metadata == nil }
    }
}
