import DIPCore
import Foundation
import XCTest

final class EventMetadataTests: XCTestCase {
    private let start = Date(timeIntervalSince1970: 1_800_000_000)
    private let locale = Locale(identifier: "en_US")
    private let utc = TimeZone(secondsFromGMT: 0)!
    private func metadata(status: DIPEventStatus = .scheduled, cost: Int = 0) -> DIPEventMetadata {
        .init(startTime: start, endTime: start.addingTimeInterval(5_400),
              venueName: "Riverside Park", address: "10 River Road", locality: "Boston",
              costCents: cost, costNote: "Bring water", capacity: 10, status: status)
    }

    func testStartAndEndBoundariesCloseJoiningAndCancellation() {
        let event = metadata()
        XCTAssertEqual(event.state(now: start.addingTimeInterval(-1), attendeeCount: 0, isJoined: false), .available)
        XCTAssertTrue(event.canCancel(now: start.addingTimeInterval(-1)))
        XCTAssertEqual(event.state(now: start, attendeeCount: 0, isJoined: false), .started)
        XCTAssertFalse(event.canCancel(now: start))
        XCTAssertEqual(event.state(now: event.endTime, attendeeCount: 0, isJoined: true), .past)
        XCTAssertFalse(event.canCancel(now: event.endTime))
    }

    func testMapsURLSearchesVenueAndAddress() throws {
        let url = try XCTUnwrap(metadata().mapsURL)
        let items = Dictionary(uniqueKeysWithValues: try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems).map { ($0.name, $0.value ?? "") })
        XCTAssertEqual(url.host, "maps.apple.com")
        XCTAssertEqual(items["q"], "Riverside Park")
        XCTAssertEqual(items["address"], "10 River Road, Boston")
        var blank = metadata(); blank.venueName = " "; blank.address = ""; blank.locality = ""
        XCTAssertNil(blank.mapsURL)
    }

    func testJoinedMemberKeepsJoinedStateAtCapacity() {
        let event = metadata()
        let now = start.addingTimeInterval(-10)
        XCTAssertEqual(event.state(now: now, attendeeCount: 10, isJoined: false), .full)
        XCTAssertEqual(event.state(now: now, attendeeCount: 11, isJoined: false), .full)
        XCTAssertEqual(event.state(now: now, attendeeCount: 10, isJoined: true), .joined)
        XCTAssertEqual(event.state(now: now, attendeeCount: 9, isJoined: false), .available)
    }

    func testCancellationOverridesTimeAndMembership() {
        let event = metadata(status: .cancelled)
        for now in [start.addingTimeInterval(-1), start, event.endTime] {
            XCTAssertEqual(event.state(now: now, attendeeCount: 10, isJoined: true), .cancelled)
            XCTAssertFalse(event.canCancel(now: now))
        }
    }

    func testShareReadsAsParagraphsForPaidEvent() {
        let text = metadata(cost: 1_250).shareText(title: "Kayaking", description: "Paddle the river with the team. Bring a hat.", locale: locale, timeZone: utc)
        let paragraphs = text.components(separatedBy: "\n\n")
        XCTAssertEqual(paragraphs.count, 2)
        XCTAssertEqual(paragraphs[0], "Join me for Kayaking! Paddle the river with the team.")
        XCTAssertTrue(paragraphs[1].contains("at Riverside Park, 10 River Road, Boston."))
        XCTAssertTrue(paragraphs[1].contains("It costs $12.50 (Bring water)."))
        XCTAssertTrue(paragraphs[1].hasSuffix("Hope to see you there!"))
        XCTAssertTrue(paragraphs[1].contains(" from "))
        XCTAssertFalse(text.contains("Duration:"))
        XCTAssertFalse(text.contains("https://"))
    }

    func testShareFreeEventWithoutDescriptionOrVenue() {
        var event = metadata()
        event.venueName = " "; event.address = ""; event.locality = "\n"; event.costNote = " "
        let text = event.shareText(title: "Walk", locale: locale, timeZone: utc)
        XCTAssertTrue(text.hasPrefix("Join me for Walk!\n\n"))
        XCTAssertTrue(text.contains("It’s free to join."))
        XCTAssertFalse(text.contains(" at  "))
        XCTAssertFalse(text.contains(", ,"))
    }

    func testShareWithoutEndTimeAndLongAddress() {
        var event = metadata()
        event.endTime = event.startTime
        event.address = String(repeating: "Long Street ", count: 12)
        let text = event.shareText(title: "Lunch", locale: locale, timeZone: utc)
        XCTAssertTrue(text.contains(" at 8:00"))
        XCTAssertFalse(text.contains(" to 8:"))
        XCTAssertTrue(text.contains(event.address.trimmingCharacters(in: .whitespaces)))
    }

    func testShareMultiDayAndCancelled() {
        var event = metadata()
        event.endTime = event.startTime.addingTimeInterval(2 * 86_400)
        let text = event.shareText(title: "Retreat", locale: locale, timeZone: utc)
        XCTAssertTrue(text.contains("It’s from "))
        XCTAssertTrue(text.contains(" to "))
        event.status = .cancelled
        XCTAssertTrue(event.shareText(title: "Retreat", locale: locale, timeZone: utc).contains("has been cancelled"))
    }

    func testTimezoneAffectsDisplayWithoutChangingStoredInstant() {
        let event = metadata()
        let eastern = TimeZone(identifier: "America/New_York")!
        XCTAssertNotEqual(event.dateTimeText(locale: locale, timeZone: utc),
                          event.dateTimeText(locale: locale, timeZone: eastern))
        XCTAssertEqual(event.startTime, start)
        XCTAssertEqual(event.revision, 1)
    }
}
