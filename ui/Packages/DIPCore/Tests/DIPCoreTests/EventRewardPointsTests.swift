import DIPCore
import DIPMockData
import Foundation
import XCTest

final class EventRewardPointsTests: XCTestCase {
    private let locale = Locale(identifier: "en_US")

    func testRewardTextHidesAtZeroAndPluralizes() {
        XCTAssertNil(DIPPointsFormat.reward(0, locale: locale))
        XCTAssertNil(DIPPointsFormat.reward(-5, locale: locale))
        XCTAssertEqual(DIPPointsFormat.reward(1, locale: locale), "+1 point")
        XCTAssertEqual(DIPPointsFormat.reward(50, locale: locale), "+50 points")
        XCTAssertEqual(DIPPointsFormat.reward(1_200, locale: locale), "+1,200 points")
        XCTAssertEqual(DIPPointsFormat.rewardShort(50, locale: locale), "+50 pts")
        XCTAssertNil(DIPPointsFormat.rewardShort(0, locale: locale))
    }

    func testMetadataAndSummariesCarryPointsAndClampNegatives() {
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        let metadata = DIPEventMetadata(startTime: start, endTime: start.addingTimeInterval(3_600), venueName: "V", address: "A",
                                        locality: "L", costCents: 0, capacity: 5, pointsValue: -3)
        XCTAssertEqual(metadata.pointsValue, 0)
        XCTAssertEqual(DIPEventSummary(id: "e", title: "t", locality: "l", image: .asset("x"), pointsValue: -1).pointsValue, 0)
    }

    func testListsPassPointsToHomeSummaries() {
        let now = Date()
        let snapshot = DIPMockFixtures.v1Events(now: now)
        let lists = DIPEventLists(snapshot: snapshot, now: now)
        let byID = Dictionary((lists.discovery + lists.upcoming).map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        for (id, summary) in byID {
            XCTAssertEqual(summary.pointsValue, snapshot.eventDetails[id]?.metadata?.pointsValue ?? 0, id)
        }
        XCTAssertTrue(byID.values.contains { $0.pointsValue > 0 }, "Fixtures include events with points")
        XCTAssertTrue(byID.values.contains { $0.pointsValue == 0 }, "Fixtures include events without points")
    }
}
