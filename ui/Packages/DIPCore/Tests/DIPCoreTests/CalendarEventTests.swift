import DIPCore
import Foundation
import XCTest

final class CalendarEventTests: XCTestCase {
    private let start = Date(timeIntervalSince1970: 1_800_000_000)
    private let utc = TimeZone(secondsFromGMT: 0)!
    private func metadata(start: Date? = nil, end: Date? = nil, status: DIPEventStatus = .scheduled,
                          venue: String = "Riverside Park", address: String = "10 River Road", locality: String = "Boston") -> DIPEventMetadata {
        let s = start ?? self.start
        return .init(startTime: s, endTime: end ?? s.addingTimeInterval(5_400), venueName: venue, address: address,
                     locality: locality, costCents: 0, capacity: 10, status: status)
    }

    func testMapsTitleTimesLocationAndNotes() {
        let fields = metadata().calendarFields(title: "Kayaking", description: " Paddle together. ", timeZone: utc)
        XCTAssertEqual(fields.title, "Kayaking")
        XCTAssertEqual(fields.startDate, start)
        XCTAssertEqual(fields.endDate, start.addingTimeInterval(5_400))
        XCTAssertEqual(fields.location, "Riverside Park, 10 River Road, Boston")
        XCTAssertEqual(fields.notes, "Paddle together.")
        XCTAssertFalse(fields.isAllDay)
        XCTAssertEqual(fields.timeZone, utc)
        XCTAssertNotNil(fields.url)
    }

    func testAbsentOrInvertedEndDefaultsToOneHour() {
        XCTAssertEqual(metadata(end: start).calendarFields(title: "A", description: "", timeZone: utc).endDate, start.addingTimeInterval(3_600))
        XCTAssertEqual(metadata(end: start.addingTimeInterval(-60)).calendarFields(title: "A", description: "", timeZone: utc).endDate, start.addingTimeInterval(3_600))
    }

    func testAllDayDependsOnTimeZoneMidnight() {
        let midnight = Date(timeIntervalSince1970: 1_799_971_200) // exact UTC midnight
        let day = metadata(start: midnight, end: midnight.addingTimeInterval(86_400))
        XCTAssertTrue(day.calendarFields(title: "A", description: "", timeZone: utc).isAllDay)
        XCTAssertFalse(day.calendarFields(title: "A", description: "", timeZone: TimeZone(secondsFromGMT: 5 * 3_600)!).isAllDay)
        let short = metadata(start: midnight, end: midnight.addingTimeInterval(3_600))
        XCTAssertFalse(short.calendarFields(title: "A", description: "", timeZone: utc).isAllDay)
    }

    func testLongTitleAndNotesAreClipped() {
        let fields = metadata().calendarFields(title: String(repeating: "T", count: 300), description: String(repeating: "d", count: 900), timeZone: utc)
        XCTAssertEqual(fields.title.count, DIPEventMetadata.calendarTitleLimit)
        XCTAssertTrue(fields.title.hasSuffix("…"))
        XCTAssertEqual(fields.notes.count, DIPEventMetadata.calendarNotesLimit)
    }

    func testLocationSkipsEmptyAndDuplicateParts() {
        XCTAssertEqual(metadata(venue: "Office", address: "", locality: "Office").calendarFields(title: "A", description: "").location, "Office")
    }

    func testCancelledAndPastEventsCannotBeAdded() {
        XCTAssertTrue(metadata().canAddToCalendar(now: start.addingTimeInterval(-10)))
        XCTAssertTrue(metadata().canAddToCalendar(now: start.addingTimeInterval(60)))
        XCTAssertFalse(metadata().canAddToCalendar(now: start.addingTimeInterval(5_400)))
        XCTAssertFalse(metadata(status: .cancelled).canAddToCalendar(now: start.addingTimeInterval(-10)))
    }
}
