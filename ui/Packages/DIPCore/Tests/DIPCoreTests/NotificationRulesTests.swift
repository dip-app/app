import Foundation
import Testing
@testable import DIPCore

@Suite struct NotificationRulesTests {
    private var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }
    /// Wednesday 2030-01-09 15:00 UTC.
    private let now = Date(timeIntervalSince1970: 1_894_460_400)

    private func item(_ id: String, ago seconds: TimeInterval, read: Bool = false, kind: DIPNotificationKind = .eventUpdated) -> DIPNotification {
        DIPNotification(id: id, kind: kind, title: id, body: "", destination: .none, createdAt: now.addingTimeInterval(-seconds), isRead: read)
    }

    @Test func groupsAreTodayYesterdayEarlierNewestFirst() {
        let items = [item("old", ago: 5 * 86_400), item("today-a", ago: 600), item("yesterday", ago: 16 * 3_600), item("today-b", ago: 60)]
        let sections = DIPNotificationRules.sections(items, now: now, calendar: calendar)
        #expect(sections.map(\.group) == [.today, .yesterday, .earlier])
        #expect(sections[0].items.map(\.id) == ["today-b", "today-a"])
        #expect(sections[1].items.map(\.id) == ["yesterday"])
    }

    @Test func emptyGroupsAreOmittedAndFutureTimestampsAreToday() {
        #expect(DIPNotificationRules.sections([], now: now, calendar: calendar).isEmpty)
        let skewed = DIPNotificationRules.sections([item("future", ago: -300)], now: now, calendar: calendar)
        #expect(skewed.map(\.group) == [.today])
    }

    @Test func relativeTimeReadsNaturally() {
        func text(_ seconds: TimeInterval) -> String { DIPNotificationRules.relativeTime(now.addingTimeInterval(-seconds), now: now, calendar: calendar) }
        #expect(text(5) == "Just now")
        #expect(text(-30) == "Just now")
        #expect(text(5 * 60) == "5m ago")
        #expect(text(2 * 3_600 + 10) == "2h ago")
        #expect(text(5 * 86_400).hasPrefix("Jan"))
    }

    @Test func batchesNeverExceedTheWriteLimit() {
        let ids = (0..<1_000).map(String.init)
        let batches = DIPNotificationRules.batches(ids)
        #expect(batches.map(\.count) == [400, 400, 200])
        #expect(batches.allSatisfy { $0.count <= 500 })
        #expect(DIPNotificationRules.batches([]).isEmpty)
    }

    @Test func destinationsFollowTheServerTarget() {
        #expect(DIPNotificationDestination(targetType: "invite", targetID: "e1_me") == .invitations)
        #expect(DIPNotificationDestination(targetType: "event", targetID: "e1") == .event("e1"))
        #expect(DIPNotificationDestination(targetType: "challenge", targetID: "week1") == .challenge("week1"))
        #expect(DIPNotificationDestination(targetType: "album", targetID: "e2") == .album("e2"))
        #expect(DIPNotificationDestination(targetType: "event", targetID: " ") == .none)
        #expect(DIPNotificationDestination(targetType: "mystery", targetID: "x") == .none)
    }

    @Test func serverTypesMapToKindsAndUnknownFallsBack() {
        #expect(DIPNotificationKind(serverType: "invite") == .invite)
        #expect(DIPNotificationKind(serverType: "event_changed") == .eventUpdated)
        #expect(DIPNotificationKind(serverType: "event_cancelled") == .eventCancelled)
        #expect(DIPNotificationKind(serverType: "challenge_approved") == .challengeApproved)
        #expect(DIPNotificationKind(serverType: "challenge_changes_requested") == .challengeChanges)
        #expect(DIPNotificationKind(serverType: "attendee_added") == .attendeeAdded)
        #expect(DIPNotificationKind(serverType: "something_new") == .other)
    }
}
