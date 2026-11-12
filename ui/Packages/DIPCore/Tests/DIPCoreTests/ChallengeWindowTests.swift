import DIPCore
import Foundation
import XCTest

final class ChallengeWindowTests: XCTestCase {
    private let ny = DIPChallengeProjection.displayTimeZone
    private var cal: Calendar { var c = Calendar(identifier: .gregorian); c.timeZone = ny; return c }
    // Mon Nov 9 2026 00:00 to Mon Nov 16 2026 00:00 (New York), end exclusive.
    private var start: Date { cal.date(from: DateComponents(year: 2026, month: 11, day: 9))! }
    private var end: Date { cal.date(from: DateComponents(year: 2026, month: 11, day: 16))! }
    private func detail(start: Date?, end: Date?) -> DIPChallengeDetail {
        .init(id: "w", title: "Fitness", image: nil, timing: "Nov 9 - Nov 15", description: "Get moving.", tags: [],
              goalText: "3 workouts", rewardText: "+50 points", startDate: start, endDate: end)
    }

    func testPhaseFollowsTheWindowAndIsNilWithoutDates() {
        let d = detail(start: start, end: end)
        XCTAssertEqual(d.phase(now: start.addingTimeInterval(-1)), .upcoming)
        XCTAssertEqual(d.phase(now: start), .active)
        XCTAssertEqual(d.phase(now: end.addingTimeInterval(-1)), .active)
        XCTAssertEqual(d.phase(now: end), .ended)
        XCTAssertNil(detail(start: nil, end: nil).phase(now: Date()))
    }

    func testStatusNoteAndCalendarEligibility() {
        let d = detail(start: start, end: end)
        let locale = Locale(identifier: "en_US")
        XCTAssertEqual(d.statusNote(now: start.addingTimeInterval(-86_400), locale: locale), "Starts Mon, Nov 9")
        XCTAssertEqual(d.statusNote(now: start.addingTimeInterval(3_600), locale: locale), DIPChallengeText.submissionsSoon)
        XCTAssertEqual(d.statusNote(now: end.addingTimeInterval(3_600), locale: locale), "This weekly theme has ended")
        XCTAssertTrue(d.canAddToCalendar(now: start.addingTimeInterval(-1)))
        XCTAssertTrue(d.canAddToCalendar(now: start.addingTimeInterval(1)))
        XCTAssertFalse(d.canAddToCalendar(now: end))
        XCTAssertFalse(detail(start: nil, end: nil).canAddToCalendar(now: Date()))
    }

    func testCalendarFieldsAreAnAllDayWeekWithTheLastDayIncluded() throws {
        let fields = try XCTUnwrap(detail(start: start, end: end).calendarFields())
        XCTAssertTrue(fields.isAllDay)
        XCTAssertEqual(fields.title, "Weekly theme: Fitness")
        XCTAssertEqual(fields.startDate, start)
        XCTAssertEqual(fields.endDate, cal.date(from: DateComponents(year: 2026, month: 11, day: 15)))
        XCTAssertEqual(fields.notes, "Get moving.\nGoal: 3 workouts\nReward: +50 points")
        XCTAssertNil(detail(start: end, end: start).calendarFields())
        XCTAssertNil(detail(start: nil, end: nil).calendarFields())
    }

    func testProjectionCarriesTheWindow() {
        let weekly = DIPWeeklyChallenge(id: "w", title: "Fitness", description: "d", type: "fitness", goal: 3, goalUnit: "workouts", coverImageURL: "x",
                                        startDate: start, endDate: end, pointsReward: 50, participantCount: 1, completedCount: 0)
        let detail = DIPChallengeProjection.detail(weekly)
        XCTAssertEqual(detail.startDate, start)
        XCTAssertEqual(detail.endDate, end)
    }

    // MARK: Calendar entry correctness (floating local days, week window) and page variants

    private func la() -> Calendar { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "America/Los_Angeles")!; return c }
    private func tokyo() -> Calendar { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "Asia/Tokyo")!; return c }

    func testAllDayDatesFloatToTheSameCalendarDaysOnAnyDevice() throws {
        let fields = try XCTUnwrap(detail(start: start, end: end).calendarFields())
        for device in [la(), tokyo(), cal] {
            let days = fields.floatingAllDayDates(deviceCalendar: device)
            let first = device.dateComponents([.year, .month, .day, .hour], from: days.start)
            let last = device.dateComponents([.year, .month, .day, .hour], from: days.end)
            XCTAssertEqual([first.year, first.month, first.day, first.hour], [2026, 11, 9, 0], "start day on \(device.timeZone.identifier)")
            XCTAssertEqual([last.year, last.month, last.day, last.hour], [2026, 11, 15, 0], "last day on \(device.timeZone.identifier)")
        }
    }

    func testWeekEndingSundayLastSecondStillIncludesSunday() throws {
        let lastSecond = end.addingTimeInterval(-1)
        let fields = try XCTUnwrap(detail(start: start, end: lastSecond).calendarFields())
        XCTAssertEqual(fields.endDate, cal.date(from: DateComponents(year: 2026, month: 11, day: 15)))
    }

    func testDaylightSavingWeekKeepsSevenDays() throws {
        // Fall back on Sun Nov 1 2026: the week Mon Oct 26 to Mon Nov 2 is 169 hours long.
        let s = cal.date(from: DateComponents(year: 2026, month: 10, day: 26))!
        let e = cal.date(from: DateComponents(year: 2026, month: 11, day: 2))!
        XCTAssertEqual(e.timeIntervalSince(s), 169 * 3600)
        let fields = try XCTUnwrap(detail(start: s, end: e).calendarFields())
        XCTAssertEqual(fields.endDate, cal.date(from: DateComponents(year: 2026, month: 11, day: 1)))
        let days = fields.floatingAllDayDates(deviceCalendar: la())
        let last = la().dateComponents([.month, .day], from: days.end)
        XCTAssertEqual([last.month, last.day], [11, 1])
    }

    func testOneDayWindowStartsAndEndsOnTheSameDay() throws {
        let oneDay = cal.date(from: DateComponents(year: 2026, month: 11, day: 10))!
        let fields = try XCTUnwrap(detail(start: start, end: oneDay).calendarFields())
        XCTAssertEqual(fields.startDate, fields.endDate)
        let days = fields.floatingAllDayDates(deviceCalendar: la())
        XCTAssertEqual(days.start, days.end)
    }

    func testVeryLongTitleAndNotesAreClippedForTheCalendar() throws {
        var long = detail(start: start, end: end)
        long.title = String(repeating: "Marathon ", count: 60)
        long.goalText = String(repeating: "a very long goal ", count: 60)
        let fields = try XCTUnwrap(long.calendarFields())
        XCTAssertLessThanOrEqual(fields.title.count, DIPEventMetadata.calendarTitleLimit)
        XCTAssertLessThanOrEqual(fields.notes.count, DIPEventMetadata.calendarNotesLimit)
        XCTAssertTrue(fields.title.hasPrefix("Weekly theme: Marathon"))
    }

    func testNoRewardThemeOmitsTheRewardFromTheCalendarNotes() throws {
        var none = detail(start: start, end: end)
        none.rewardText = nil
        let fields = try XCTUnwrap(none.calendarFields())
        XCTAssertEqual(fields.notes, "Get moving.\nGoal: 3 workouts")
    }

    func testVariantsNotStartedAndEndedNotesAndCalendarGate() {
        let d = detail(start: start, end: end)
        let locale = Locale(identifier: "en_US")
        XCTAssertTrue(d.statusNote(now: start.addingTimeInterval(-7 * 86_400), locale: locale).hasPrefix("Starts "))
        XCTAssertFalse(d.canAddToCalendar(now: end.addingTimeInterval(86_400)), "an ended theme is informational only")
        XCTAssertEqual(d.statusNote(now: end, locale: locale), "This weekly theme has ended")
    }

    func testGoalAndRewardTextVariants() {
        XCTAssertNil(DIPChallengeProjection.goalText(goal: 0, unit: "x"))
        XCTAssertNil(DIPChallengeProjection.goalText(goal: .infinity, unit: "x"))
        XCTAssertNil(DIPChallengeProjection.rewardText(0))
        XCTAssertNil(DIPChallengeProjection.rewardText(-5))
        XCTAssertEqual(DIPChallengeProjection.goalText(goal: 2.5, unit: " km "), "2.5 km")
        XCTAssertEqual(DIPChallengeProjection.goalText(goal: 3, unit: ""), "3")
    }
}
