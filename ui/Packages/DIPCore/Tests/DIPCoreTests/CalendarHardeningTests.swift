import DIPCore
import Foundation
import XCTest

/// Audit hardening for the calendar flow: daylight saving all-day detection, overlap copy, own-entry exclusion by
/// identifier, local record pruning and the pill's VoiceOver text.
final class CalendarHardeningTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_800_000_000) // 2027-01-15 08:00:00 UTC
    private let utc = TimeZone(secondsFromGMT: 0)!
    private let posix = Locale(identifier: "en_US_POSIX")
    private let la = TimeZone(identifier: "America/Los_Angeles")!

    private func at(_ minutes: Double) -> Date { t0.addingTimeInterval(minutes * 60) }

    private func laDate(_ year: Int, _ month: Int, _ day: Int, hour: Int = 0) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = la
        return calendar.date(from: DateComponents(year: year, month: month, day: day, hour: hour))!
    }

    private func metadata(_ start: Date, _ end: Date) -> DIPEventMetadata {
        .init(startTime: start, endTime: end, venueName: "", address: "", locality: "", costCents: 0, capacity: 5)
    }

    private func conflict(_ title: String, _ start: Double, _ end: Double, allDay: Bool = false) -> DIPCalendarConflict {
        .init(title: title, start: at(start), end: at(end), source: .device, isAllDay: allDay)
    }

    // MARK: All-day detection across daylight saving (CAL-Q7)

    func testAllDayIsDetectedOnTheSpringForwardDay() {
        // Sun Mar 8 2026 in Los Angeles is 23 hours long.
        let start = laDate(2026, 3, 8), end = laDate(2026, 3, 9)
        XCTAssertEqual(end.timeIntervalSince(start), 23 * 3_600)
        XCTAssertTrue(metadata(start, end).calendarFields(title: "A", description: "", timeZone: la).isAllDay)
    }

    func testAllDayIsDetectedOnTheFallBackDay() {
        // Sun Nov 1 2026 is 25 hours long.
        let start = laDate(2026, 11, 1), end = laDate(2026, 11, 2)
        XCTAssertEqual(end.timeIntervalSince(start), 25 * 3_600)
        XCTAssertTrue(metadata(start, end).calendarFields(title: "A", description: "", timeZone: la).isAllDay)
    }

    func testMultiDayAcrossDaylightSavingIsAllDay() {
        XCTAssertTrue(metadata(laDate(2026, 3, 7), laDate(2026, 3, 10)).calendarFields(title: "A", description: "", timeZone: la).isAllDay)
    }

    func testShortOrOffMidnightEventsOnDaylightSavingDaysAreNotAllDay() {
        let midnight = laDate(2026, 3, 8)
        XCTAssertFalse(metadata(midnight, laDate(2026, 3, 8, hour: 12)).calendarFields(title: "A", description: "", timeZone: la).isAllDay)
        // Midnight to 11 pm of the same long day is not a whole day.
        XCTAssertFalse(metadata(midnight, laDate(2026, 3, 8, hour: 23)).calendarFields(title: "A", description: "", timeZone: la).isAllDay)
        XCTAssertFalse(metadata(laDate(2026, 11, 1, hour: 1), laDate(2026, 11, 2, hour: 1)).calendarFields(title: "A", description: "", timeZone: la).isAllDay)
    }

    func testCalendarEndIsPublicAndDefaultsToOneHour() {
        XCTAssertEqual(metadata(at(0), at(0)).calendarEnd, at(60))
        XCTAssertEqual(metadata(at(0), at(90)).calendarEnd, at(90))
    }

    // MARK: Overlap copy (CAL-Q15)

    func testTimeOnlyWhenSameDayAsTheEvent() {
        let text = DIPCalendarOverlapText.message([conflict("A", 0, 30)], eventStart: at(0), locale: posix, timeZone: utc)
        XCTAssertTrue(text.contains("8:00"), text)
        XCTAssertFalse(text.contains("Jan"), text)
    }

    func testDayShownWhenTheConflictIsOnAnotherDay() {
        let text = DIPCalendarOverlapText.message([conflict("A", 1_440 + 60, 1_440 + 120)], eventStart: at(0), locale: posix, timeZone: utc)
        XCTAssertTrue(text.contains("Jan 16"), text)
    }

    func testDayShownWhenTheConflictSpansMidnight() {
        // 23:00 Jan 14 to 09:00 Jan 15 UTC.
        let text = DIPCalendarOverlapText.message([conflict("Late", -540, 60)], eventStart: at(0), locale: posix, timeZone: utc)
        XCTAssertTrue(text.contains("Jan 14") && text.contains("Jan 15"), text)
    }

    func testEndingExactlyAtMidnightDoesNotCountAsSpanningIt() {
        // 22:00 to 24:00 UTC on Jan 15 (event also on Jan 15).
        let text = DIPCalendarOverlapText.message([conflict("Evening", 14 * 60, 16 * 60)], eventStart: at(14 * 60), locale: posix, timeZone: utc)
        XCTAssertFalse(text.contains("Jan"), text)
    }

    func testAllDayReadsAllDay() {
        XCTAssertEqual(DIPCalendarOverlapText.message([conflict("Holiday", -480, 960, allDay: true)], eventStart: at(0), locale: posix, timeZone: utc), "All day")
        let other = DIPCalendarOverlapText.message([conflict("Trip", 1_440 - 480, 1_440 + 960, allDay: true)], eventStart: at(0), locale: posix, timeZone: utc)
        XCTAssertTrue(other.contains("Jan 16") && other.hasSuffix("all day"), other)
    }

    func testUntitledEntriesCollapseIntoOneName() {
        XCTAssertEqual(DIPCalendarOverlapText.names([conflict("", 0, 30)]), "a busy time")
        XCTAssertEqual(DIPCalendarOverlapText.names([conflict("", 0, 30), conflict("  ", 10, 40)]), "2 busy times")
        XCTAssertEqual(DIPCalendarOverlapText.title([conflict("", 0, 30), conflict("", 0, 30)]), "Overlaps with 2 busy times")
        XCTAssertEqual(DIPCalendarOverlapText.names([conflict("Standup", 0, 30), conflict("", 0, 30), conflict("", 5, 30)]), "Standup and 2 busy times")
        XCTAssertEqual(DIPCalendarOverlapText.names([conflict("A", 0, 30), conflict("", 0, 30), conflict("B", 0, 30), conflict("C", 0, 30)]), "A, a busy time and 2 more")
    }

    // MARK: Own-entry exclusion by identifier (CAL-Q6)

    func testOwnEntryIsExcludedByIdentifierEvenWithoutItsURL() {
        let own = DIPCalendarItem(title: "Edited by hand", start: at(0), end: at(60), url: nil, identifier: "id-1")
        let other = DIPCalendarItem(title: "Dentist", start: at(0), end: at(60), url: nil, identifier: "id-2")
        let result = DIPCalendarOverlap.conflicts(start: at(0), end: at(60), items: [own, other], excludingIdentifiers: ["id-1"])
        XCTAssertEqual(result.map(\.title), ["Dentist"])
        let index = DIPCalendarIndex([own, other])
        XCTAssertEqual(index.conflicts(start: at(0), end: at(60), excludingIdentifiers: ["id-1"]).map(\.title), ["Dentist"])
        XCTAssertEqual(index.conflicts(start: at(0), end: at(60)).count, 2)
    }

    func testAdjacentEntriesDoNotConflictEvenWhenTheyShareAnIdentifierList() {
        let before = DIPCalendarItem(title: "Before", start: at(-60), end: at(0), identifier: "x")
        let after = DIPCalendarItem(title: "After", start: at(60), end: at(120), identifier: "y")
        XCTAssertTrue(DIPCalendarOverlap.conflicts(start: at(0), end: at(60), items: [before, after], excludingIdentifiers: ["z"]).isEmpty)
    }

    func testConflictsCarryTheAllDayFlag() {
        let holiday = DIPCalendarItem(title: "Holiday", start: at(-60), end: at(600), isAllDay: true)
        let result = DIPCalendarOverlap.conflicts(start: at(0), end: at(60), items: [holiday], rules: .init(treatsAllDayAsBusy: true))
        XCTAssertEqual(result.map(\.isAllDay), [true])
    }

    // MARK: Pill VoiceOver text (CAL-Q12)

    func testPillLabelStartsWithTheVisibleDate() {
        let c = [conflict("Dentist", 0, 60)]
        XCTAssertEqual(DIPCalendarPillState.free(direct: false).accessibilityLabel(date: "Monday 11/23"), "Monday 11/23. Add to calendar")
        XCTAssertEqual(DIPCalendarPillState.conflict(c, direct: true).accessibilityLabel(date: "Monday 11/23"),
                       "Monday 11/23. Add to calendar. Overlaps with Dentist")
        XCTAssertEqual(DIPCalendarPillState.added.accessibilityLabel(date: "Monday 11/23"), "Monday 11/23. Added to your calendar")
        XCTAssertEqual(DIPCalendarPillState.free(direct: false).accessibilityLabel(date: nil), "Add to calendar")
        XCTAssertEqual(DIPCalendarPillState.hidden.accessibilityLabel(date: "Monday 11/23"), "")
    }

    func testPillHintSaysWhetherItSavesDirectlyOrOpensTheEditor() {
        XCTAssertTrue(DIPCalendarPillState.free(direct: true).accessibilityHint.contains("Saves"))
        XCTAssertTrue(DIPCalendarPillState.free(direct: false).accessibilityHint.contains("editor"))
        XCTAssertTrue(DIPCalendarPillState.conflict([conflict("A", 0, 60)], direct: false).accessibilityHint.contains("confirm"))
        XCTAssertEqual(DIPCalendarPillState.added.accessibilityHint, "")
    }

    // MARK: Local store (CAL-Q20)

    private func suite() -> UserDefaults {
        let name = "work.letsdip.tests.calendar.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        addTeardownBlock { UserDefaults(suiteName: name)?.removePersistentDomain(forName: name) }
        return defaults
    }

    func testRecordsEndedMoreThanThirtyDaysAgoArePruned() {
        let defaults = suite()
        let now = t0
        let store = DIPCalendarLocalStore(uid: "u", defaults: defaults, now: { now })
        store.save(DIPCalendarEntryRecord(eventID: "old", itemIdentifier: "1", startDate: now.addingTimeInterval(-40 * 86_400), endDate: now.addingTimeInterval(-40 * 86_400 + 3_600)))
        store.save(DIPCalendarEntryRecord(eventID: "recent", itemIdentifier: "2", startDate: now.addingTimeInterval(-10 * 86_400), endDate: now.addingTimeInterval(-10 * 86_400 + 3_600)))
        store.save(DIPCalendarEntryRecord(eventID: "future", itemIdentifier: "3", startDate: now.addingTimeInterval(86_400), endDate: now.addingTimeInterval(86_400 + 3_600)))
        // A fresh instance reads what was persisted; the old record is gone from storage, not only hidden.
        let reread = DIPCalendarLocalStore(uid: "u", defaults: defaults, now: { now })
        XCTAssertNil(reread.record(for: "old"))
        XCTAssertNotNil(reread.record(for: "recent"))
        XCTAssertNotNil(reread.record(for: "future"))
        let raw = defaults.data(forKey: DIPCalendarLocalStore.key(for: "u")).flatMap { String(data: $0, encoding: .utf8) } ?? ""
        XCTAssertFalse(raw.contains("\"old\""), raw)
    }

    func testCachedReadsStillSeeAWipeThroughAnotherStoreInstance() {
        let defaults = suite()
        let model = DIPCalendarLocalStore(uid: "u", defaults: defaults)
        model.save(DIPCalendarEntryRecord(eventID: "e", itemIdentifier: "1", startDate: t0, endDate: t0.addingTimeInterval(3_600)))
        XCTAssertNotNil(model.record(for: "e"))
        XCTAssertNotNil(model.record(for: "e"), "second read comes from the cache")
        // Sign-out wipes through a different instance for the same uid.
        DIPCalendarLocalStore(uid: "u", defaults: defaults).removeAll()
        XCTAssertNil(model.record(for: "e"))
        XCTAssertEqual(model.preferences, DIPCalendarPreferences())
    }

    func testRecordWithoutSavedAtStillDecodes() throws {
        let json = #"{"eventID":"e","startDate":0,"endDate":3600}"#.data(using: .utf8)!
        let record = try JSONDecoder().decode(DIPCalendarEntryRecord.self, from: json)
        XCTAssertNil(record.savedAt)
        XCTAssertNil(record.itemIdentifier)
    }
}

@MainActor
final class FakeDeviceCalendarHardeningTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_800_000_000)

    private func fields(event: String) -> DIPCalendarEventFields {
        let meta = DIPEventMetadata(startTime: t0, endTime: t0.addingTimeInterval(3_600), venueName: "", address: "", locality: "", costCents: 0, capacity: 1)
        return meta.calendarFields(title: "DIP", description: "", eventID: event, timeZone: TimeZone(secondsFromGMT: 0)!)
    }

    func testRemoveRefusesAnEntryThatBelongsToAnotherEvent() async throws {
        let fake = DIPFakeDeviceCalendar()
        let id = try await fake.save(fields(event: "e1"))
        do { try await fake.remove(identifier: id, eventID: "e2"); XCTFail("expected notFound") }
        catch { XCTAssertEqual(error as? DIPCalendarWriteError, .notFound) }
        let exists = await fake.entryExists(identifier: id)
        XCTAssertTrue(exists)
        try await fake.remove(identifier: id, eventID: "e1")
        let gone = await fake.entryExists(identifier: id)
        XCTAssertFalse(gone)
    }

    func testEntryExistsNeedsFullAccess() async {
        let fake = DIPFakeDeviceCalendar()
        let id = fake.insert(fields(event: "e1"))
        let before = await fake.entryExists(identifier: id)
        XCTAssertTrue(before)
        fake.revoke()
        let after = await fake.entryExists(identifier: id)
        XCTAssertFalse(after)
    }

    func testItemsCarryTheirIdentifier() async {
        let fake = DIPFakeDeviceCalendar()
        let id = fake.insert(fields(event: "e1"))
        let items = await fake.items(start: t0, end: t0.addingTimeInterval(3_600))
        XCTAssertEqual(items.map(\.identifier), [id])
    }
}
