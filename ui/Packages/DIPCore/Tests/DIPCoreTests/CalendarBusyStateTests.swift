import DIPCore
import Foundation
import XCTest

/// Grey "busy" pill state (personal, non-DIP calendar overlap) next to the amber DIP conflict: resolution priority
/// DIP > personal > free > added, alert text, VoiceOver, Home ordering and the time-zone / all-day edge cases.
final class CalendarBusyStateTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_800_000_000)
    private let utc = TimeZone(secondsFromGMT: 0)!
    private let posix = Locale(identifier: "en_US_POSIX")

    private func at(_ minutes: Double) -> Date { t0.addingTimeInterval(minutes * 60) }

    private func personal(_ title: String, _ s: Double = 0, _ e: Double = 60, soft: Bool = false, allDay: Bool = false) -> DIPCalendarConflict {
        .init(title: title, start: at(s), end: at(e), isSoft: soft, source: .device, isAllDay: allDay)
    }

    private func dip(_ title: String, _ s: Double = 0, _ e: Double = 60) -> DIPCalendarConflict {
        .init(title: title, start: at(s), end: at(e), source: .dip(eventID: title))
    }

    private func resolve(added: Bool = false, adding: Bool = false, direct: Bool = false,
                         _ conflicts: [DIPCalendarConflict] = []) -> DIPCalendarPillState {
        .resolve(canAdd: true, isAdded: added, isAdding: adding, direct: direct, conflicts: conflicts)
    }

    // MARK: Resolution priority

    func testPersonalOnlyIsBusyAndStaysEnabled() {
        let c = [personal("Dentist")]
        XCTAssertEqual(resolve(c), .busy(c, direct: false))
        XCTAssertEqual(resolve(direct: true, c), .busy(c, direct: true))
        XCTAssertTrue(resolve(c).isEnabled)
    }

    func testDIPOverlapBeatsPersonalOverlap() {
        let c = [personal("Dentist"), dip("Yoga")]
        XCTAssertEqual(resolve(c), .conflict(c, direct: false))
        XCTAssertEqual(resolve([dip("Yoga")]), .conflict([dip("Yoga")], direct: false))
    }

    func testFullPriorityOrderDIPPersonalFreeAdded() {
        let both = [personal("Dentist"), dip("Yoga")]
        XCTAssertEqual(resolve(both), .conflict(both, direct: false))
        XCTAssertEqual(resolve([personal("Dentist")]), .busy([personal("Dentist")], direct: false))
        XCTAssertEqual(resolve(), .free(direct: false))
        // Added and adding outrank every overlap; hidden outranks all.
        XCTAssertEqual(resolve(added: true, both), .added)
        XCTAssertEqual(resolve(adding: true, [personal("Dentist")]), .adding)
        XCTAssertEqual(DIPCalendarPillState.resolve(canAdd: false, isAdded: true, isAdding: false, direct: false, conflicts: both), .hidden)
    }

    func testTentativePersonalEntryIsStillBusy() {
        XCTAssertEqual(resolve([personal("Maybe", soft: true)]), .busy([personal("Maybe", soft: true)], direct: false))
    }

    // MARK: VoiceOver

    func testBusyLabelAndHint() {
        let state = DIPCalendarPillState.busy([personal("Dentist")], direct: false)
        XCTAssertEqual(state.accessibilityLabel, "Add to calendar. Busy at this time")
        XCTAssertEqual(state.accessibilityLabel(date: "Monday 11/23"), "Monday 11/23. Add to calendar. Busy at this time")
        XCTAssertTrue(state.accessibilityHint.contains("confirm"))
        // The grey label never reads the title; the amber one reads DIP titles and personal entries as Busy.
        XCTAssertFalse(state.accessibilityLabel.contains("Dentist"))
        XCTAssertEqual(DIPCalendarPillState.conflict([dip("Yoga")], direct: false).accessibilityLabel, "Add to calendar. Overlaps with Yoga")
        XCTAssertEqual(DIPCalendarPillState.conflict([dip("Yoga"), personal("")], direct: false).accessibilityLabel,
                       "Add to calendar. Overlaps with Yoga and Busy")
    }

    // MARK: Alert text

    func testBusyAlertTitleUsesTheEntryTitleOrBusy() {
        XCTAssertEqual(DIPCalendarOverlapText.alertTitle([personal("Team Lunch")]), "Team Lunch")
        XCTAssertEqual(DIPCalendarOverlapText.alertTitle([personal("")]), "Busy")
        XCTAssertEqual(DIPCalendarOverlapText.alertTitle([personal("  \n")]), "Busy")
        XCTAssertEqual(DIPCalendarOverlapText.alertTitle([personal(""), personal("")]), "Busy")
        XCTAssertEqual(DIPCalendarOverlapText.alertTitle([personal("A"), personal("B")]), "A and B")
        XCTAssertEqual(DIPCalendarOverlapText.alertTitle([personal("A"), personal("")]), "A and Busy")
        XCTAssertEqual(DIPCalendarOverlapText.alertTitle([personal("A"), personal("B"), personal("C"), personal("D")]), "A, B and 2 more")
    }

    func testBothAlertListsDIPTitlesAndPersonalAsBusyOrTitle() {
        XCTAssertEqual(DIPCalendarOverlapText.alertTitle([dip("Yoga"), personal("Dentist")]), "Overlaps with Yoga and Dentist")
        XCTAssertEqual(DIPCalendarOverlapText.alertTitle([dip("Yoga"), personal("")]), "Overlaps with Yoga and Busy")
        let message = DIPCalendarOverlapText.alertMessage([dip("Yoga"), personal("")], eventStart: at(0), locale: posix, timeZone: utc)
        XCTAssertTrue(message.contains("Yoga: "), message)
        XCTAssertTrue(message.contains("Busy: "), message)
        XCTAssertFalse(message.contains("You have something else then."), message)
    }

    func testBusyAlertMessageExplainsAndNeverNamesAnUntitledEntry() {
        let message = DIPCalendarOverlapText.alertMessage([personal("")], eventStart: at(0), locale: posix, timeZone: utc)
        XCTAssertTrue(message.hasPrefix("You have something else then.\n"), message)
        XCTAssertFalse(message.lowercased().contains("busy time"), message)
    }

    // MARK: Time zone and all-day edge cases carry over to the personal path

    func testAdjacentPersonalEntryDoesNotMakeTheEventBusy() {
        let items = [DIPCalendarItem(title: "Before", start: at(-60), end: at(0)), DIPCalendarItem(title: "After", start: at(60), end: at(120))]
        XCTAssertTrue(DIPCalendarOverlap.conflicts(start: at(0), end: at(60), items: items).isEmpty)
    }

    func testAllDayPersonalEntryIsBusyOnlyWhenCounted() {
        let holiday = DIPCalendarItem(title: "Holiday", start: at(-600), end: at(600), isAllDay: true)
        XCTAssertTrue(DIPCalendarOverlap.conflicts(start: at(0), end: at(60), items: [holiday]).isEmpty)
        let counted = DIPCalendarOverlap.conflicts(start: at(0), end: at(60), items: [holiday], rules: .init(treatsAllDayAsBusy: true))
        XCTAssertEqual(resolve(counted), .busy(counted, direct: false))
    }

    func testBusyMessageTimesFollowTheInjectedTimeZone() {
        let c = [personal("Dentist")]
        let la = TimeZone(identifier: "America/Los_Angeles")!
        let inUTC = DIPCalendarOverlapText.alertMessage(c, eventStart: at(0), locale: posix, timeZone: utc)
        let inLA = DIPCalendarOverlapText.alertMessage(c, eventStart: at(0), locale: posix, timeZone: la)
        XCTAssertNotEqual(inUTC, inLA)
    }

    func testDeclinedFreeAndCanceledEntriesNeverMakeTheEventBusy() {
        let items = [DIPCalendarItem(title: "Free", start: at(0), end: at(60), availability: .free),
                     DIPCalendarItem(title: "No", start: at(0), end: at(60), isDeclined: true),
                     DIPCalendarItem(title: "Gone", start: at(0), end: at(60), isCanceled: true)]
        let result = DIPCalendarOverlap.conflicts(start: at(0), end: at(60), items: items)
        XCTAssertEqual(resolve(result), .free(direct: false))
    }

    // MARK: Home overlaps and ordering

    func testOverlapsNeverListAnEventAsBoth() {
        let overlaps = DIPCalendarOverlaps(dip: ["a"], personal: ["a", "b"])
        XCTAssertEqual(overlaps.dip, ["a"])
        XCTAssertEqual(overlaps.personal, ["b"])
        XCTAssertTrue(DIPCalendarOverlaps.none.isEmpty)
    }

    func testHomeOrdersFreeThenPersonalThenDIPAndHidesNothing() {
        let ids = ["a", "b", "c", "d", "e"]
        let overlaps = DIPCalendarOverlaps(dip: ["a", "d"], personal: ["b"])
        XCTAssertEqual(DIPCalendarFit.prioritized(ids, id: { $0 }, overlaps: overlaps), ["c", "e", "b", "a", "d"])
        XCTAssertEqual(DIPCalendarFit.prioritized(ids, id: { $0 }, overlaps: .none), ids)
        XCTAssertEqual(DIPCalendarFit.prioritized(ids, id: { $0 }, conflicted: ["a"]), ["b", "c", "d", "e", "a"])
    }
}
