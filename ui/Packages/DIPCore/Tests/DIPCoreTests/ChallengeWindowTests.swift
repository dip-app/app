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
}
