import DIPCore
import Foundation
import XCTest

final class ChangeLogTextTests: XCTestCase {
    private let utc = TimeZone(secondsFromGMT: 0)!
    private let locale = Locale(identifier: "en_US")
    private func entry(_ changes: [DIPFieldChange], at seconds: TimeInterval = 1_800_000_000, revision: Int = 2) -> DIPChangeLogEntry {
        .init(at: Date(timeIntervalSince1970: seconds), revision: revision, changes: changes)
    }
    private func rows(_ changes: [DIPFieldChange]) -> [DIPChangeRow] {
        DIPChangeLogText.rows(entry(changes), locale: locale, timeZone: utc)
    }

    func testTimeMoveReadsAsOneRowWithFromAndTo() {
        let result = rows([.init(field: "startTime", from: "2027-01-15T12:00:00.000Z", to: "2027-01-15T13:00:00.000Z"),
                           .init(field: "endTime", from: "2027-01-15T13:30:00.000Z", to: "2027-01-15T14:30:00.000Z")])
        XCTAssertEqual(result.count, 1)
        XCTAssertEqual(result[0].label, "Time")
        XCTAssertTrue(result[0].detail?.contains("→") == true)
        XCTAssertTrue(result[0].detail?.contains("12:00") == true && result[0].detail?.contains("1:00") == true)
    }

    func testLocationCostSpotsAndNameUseConsistentLabels() {
        let result = rows([
            .init(field: "title", from: "Yoga", to: "Puppy Yoga"),
            .init(field: "venue.name", from: "Cafe", to: "Park"), .init(field: "venue.address", from: "1 Main", to: "2 Oak"),
            .init(field: "costCents", from: "0", to: "1250"), .init(field: "capacity", from: "20", to: "30")])
        XCTAssertEqual(result.map(\.label), ["Name", "Location", "Cost", "Spots"])
        XCTAssertEqual(result[0].detail, "Yoga → Puppy Yoga")
        XCTAssertEqual(result[1].detail, "Cafe, 1 Main → Park, 2 Oak")
        XCTAssertEqual(result[2].detail, "Free → $12.50")
        XCTAssertEqual(result[3].detail, "20 → 30")
    }

    func testCancelAndRestoreAreLeadingRowsAndNoisyFieldsHaveNoValues() {
        let cancelled = rows([.init(field: "description", from: "a", to: "b"), .init(field: "status", from: "scheduled", to: "cancelled")])
        XCTAssertEqual(cancelled.map(\.label), ["Activity cancelled", "Description updated"])
        XCTAssertNil(cancelled[1].detail)
        XCTAssertEqual(rows([.init(field: "status", from: "cancelled", to: "scheduled")]).first?.label, "Activity is back on")
        XCTAssertEqual(rows([.init(field: "tagIds", from: "a", to: "b"), .init(field: "coverImageURL", from: "x", to: "y")]).map(\.label),
                       ["Interests updated", "Photo changed"])
    }

    func testMissingValuesAndUnknownFieldsDegradeGracefully() {
        XCTAssertEqual(rows([.init(field: "capacity", from: nil, to: "10")])[0].detail, "Now 10")
        XCTAssertEqual(rows([.init(field: "capacity", from: "10", to: nil)])[0].detail, "Was 10")
        XCTAssertEqual(rows([.init(field: "startTime", from: "garbage", to: "also garbage")])[0].detail, nil)
        XCTAssertEqual(rows([.init(field: "somethingNew", from: "a", to: "b")]), [])
    }

    func testUnknownStatusProducesNoRowAndVisibleCountSkipsEmptyEntries() {
        XCTAssertEqual(rows([.init(field: "status", from: "scheduled", to: "completed")]), [])
        let log = [entry([.init(field: "status", from: "scheduled", to: "completed")], revision: 2),
                   entry([.init(field: "capacity", from: "1", to: "2")], revision: 3)]
        XCTAssertEqual(DIPChangeLogText.visibleCount(log), 1)
    }

    func testNewestFirstOrdersByTimeThenRevision() {
        let a = entry([], at: 100, revision: 2), b = entry([], at: 300, revision: 3), c = entry([], at: 300, revision: 4)
        XCTAssertEqual(DIPChangeLogText.newestFirst([a, b, c]).map(\.revision), [4, 3, 2])
    }
}
