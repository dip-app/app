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

    func testShareIncludesStructuredInformationWithoutInventingLink() {
        let event = metadata(cost: 1_250)
        let text = event.shareText(title: "Kayaking", locale: locale, timeZone: utc)
        XCTAssertTrue(text.hasPrefix("Kayaking\n"))
        XCTAssertTrue(text.contains(event.dateTimeText(locale: locale, timeZone: utc)))
        XCTAssertTrue(text.contains("Duration: 90 minutes"))
        XCTAssertTrue(text.contains("Riverside Park, 10 River Road, Boston"))
        XCTAssertTrue(text.contains("$12.50 — Bring water"))
        XCTAssertFalse(text.contains("https://"))
    }

    func testFreeBlankLocationAndCancelledSharing() {
        var event = metadata(status: .cancelled)
        event.venueName = " "
        event.address = ""
        event.locality = "\n"
        event.costNote = " "
        let text = event.shareText(title: "Walk", locale: locale, timeZone: utc)
        XCTAssertTrue(text.contains("Walk\nCancelled\n"))
        XCTAssertTrue(text.hasSuffix("\nFree"))
        XCTAssertFalse(text.contains(", ,"))
        XCTAssertEqual(event.durationMinutes, 90)
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
