import DIPCore
import Foundation
import XCTest

final class EventDateTextTests: XCTestCase {
    private let utc = TimeZone(secondsFromGMT: 0)!
    private let us = Locale(identifier: "en_US")
    private let es = Locale(identifier: "es_ES")

    private func date(_ year: Int, _ month: Int, _ day: Int, _ hour: Int, _ minute: Int) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = utc
        return calendar.date(from: DateComponents(year: year, month: month, day: day, hour: hour, minute: minute))!
    }

    /// Wednesday, November 25, 2026, 9:00 AM UTC.
    private var now: Date { date(2026, 11, 25, 9, 0) }

    private func text(_ locale: Locale) -> DIPEventDateText {
        DIPEventDateText(now: now, calendar: Calendar(identifier: .gregorian), locale: locale, timeZone: utc)
    }

    /// Formatter output may use a narrow no-break space before AM/PM; compare with plain spaces.
    private func plain(_ value: String) -> String {
        value.replacingOccurrences(of: "\u{202F}", with: " ").replacingOccurrences(of: "\u{00A0}", with: " ")
    }

    func testTodayAndTomorrowUseWordsAndTheStartTime() {
        XCTAssertEqual(plain(text(us).string(date(2026, 11, 25, 19, 30))), "Today, 7:30 PM")
        XCTAssertEqual(plain(text(us).string(date(2026, 11, 25, 7, 0))), "Today, 7:00 AM", "Earlier today (already running) is still today")
        XCTAssertEqual(plain(text(us).string(date(2026, 11, 26, 19, 30))), "Tomorrow, 7:30 PM")
    }

    func testWithinSixDaysUsesTheShortWeekday() {
        XCTAssertEqual(plain(text(us).string(date(2026, 11, 27, 19, 30))), "Fri, 7:30 PM")
        XCTAssertEqual(plain(text(us).string(date(2026, 12, 1, 18, 0))), "Tue, 6:00 PM", "Six days ahead")
    }

    func testLaterThisYearHasNoYearAndNextYearHasOne() {
        XCTAssertEqual(plain(text(us).string(date(2026, 12, 2, 19, 30))), "Dec 2, 7:30 PM", "Seven days ahead is absolute")
        let nextYear = plain(text(us).string(date(2027, 1, 8, 19, 30)))
        XCTAssertTrue(nextYear.contains("2027"), nextYear)
        XCTAssertTrue(nextYear.hasPrefix("Jan 8"), nextYear)
        XCTAssertTrue(nextYear.contains("7:30 PM"), nextYear)
    }

    func testEarlierDaysAreAbsolute() {
        XCTAssertEqual(plain(text(us).string(date(2026, 11, 24, 19, 30))), "Nov 24, 7:30 PM")
    }

    func testDayBoundaryFollowsTheInjectedTimeZone() {
        // 11 PM in New York on Nov 25 is already Nov 26 in UTC: the member's zone decides "Today".
        let newYork = TimeZone(identifier: "America/New_York")!
        let lateEvening = date(2026, 11, 26, 4, 0)
        let local = DIPEventDateText(now: date(2026, 11, 25, 14, 0), locale: us, timeZone: newYork)
        XCTAssertEqual(plain(local.string(lateEvening)), "Today, 11:00 PM")
    }

    func testSpanishUsesSpanishDateFormsAnd24HourTime() {
        let spanish = text(es)
        XCTAssertEqual(plain(spanish.string(date(2026, 11, 27, 19, 30))).lowercased(), "vie, 19:30")
        let later = plain(spanish.string(date(2026, 12, 2, 19, 30)))
        XCTAssertTrue(later.hasPrefix("2 dic"), later)
        XCTAssertTrue(later.contains("19:30"), later)
        XCTAssertFalse(later.contains("2026"), later)
        // The words come from the String Catalog (English default under `swift test`); the time is Spanish.
        XCTAssertTrue(spanish.string(date(2026, 11, 25, 19, 30)).hasSuffix("19:30"))
    }
}
