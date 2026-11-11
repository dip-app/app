import DIPCore
import Foundation
import XCTest

final class DIPShareLinkTests: XCTestCase {
    private let host = DIPShareLink.baseURL.host!

    func testBuildsOpaqueIDLinkOnTheBaseURL() {
        XCTAssertEqual(DIPShareLink.url(forEventID: "abc123")?.absoluteString, "https://\(host)/e/abc123")
        XCTAssertEqual(DIPShareLink.baseURL.scheme, "https")
        XCTAssertNil(DIPShareLink.baseURL.query)
    }

    func testRoundTripIncludingPercentEncoding() throws {
        for id in ["abc123", "puppy-yoga", "a_b.c~d", "é", "x?y#z%", "100%"] {
            let url = try XCTUnwrap(DIPShareLink.url(forEventID: id), id)
            XCTAssertEqual(DIPShareLink.eventID(from: url), id)
        }
        XCTAssertEqual(DIPShareLink.url(forEventID: "x?y#z")?.absoluteString, "https://\(host)/e/x%3Fy%23z")
    }

    func testRejectsInvalidIDs() {
        for id in ["", "a/b", String(repeating: "x", count: 129), "a\nb", " "] {
            XCTAssertNil(DIPShareLink.url(forEventID: id), id)
        }
    }

    func testParsesShareLinkVariants() {
        XCTAssertEqual(DIPShareLink.eventID(from: URL(string: "https://\(host)/e/abc")!), "abc")
        XCTAssertEqual(DIPShareLink.eventID(from: URL(string: "https://\(host)/e/abc/")!), "abc")
        XCTAssertEqual(DIPShareLink.eventID(from: URL(string: "https://\(host.uppercased())/e/abc?utm=1#frag")!), "abc")
    }

    func testParsesPushDeepLinks() {
        XCTAssertEqual(DIPShareLink.eventID(from: URL(string: "dip://events/abc")!), "abc")
        XCTAssertEqual(DIPShareLink.eventID(from: URL(string: "dip://events/abc/chat")!), "abc")
    }

    func testRejectsOtherHostsSchemesAndPaths() {
        let rejected = [
            "https://evil.example.com/e/abc", "https://\(host).evil.com/e/abc", "https://evil.com/https://\(host)/e/abc",
            "http://\(host)/e/abc", "https://user@\(host)/e/abc", "https://\(host):8443/e/abc",
            "https://\(host)/", "https://\(host)/e", "https://\(host)/e/", "https://\(host)/x/abc",
            "https://\(host)/e/abc/def", "https://\(host)//e/abc", "https://\(host)/e//abc", "https://\(host)/e/a%2Fb",
            "dip://events", "dip://events/", "dip://other/abc", "dip://events/abc/other", "dip://events/a/b/c",
            "otherapp://events/abc", "com.googleusercontent.apps.123:/oauth2callback",
        ]
        for string in rejected {
            guard let url = URL(string: string) else { continue }
            XCTAssertNil(DIPShareLink.eventID(from: url), string)
        }
    }

    func testShareTextEndsWithTheLink() throws {
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        let event = DIPEventMetadata(startTime: start, endTime: start.addingTimeInterval(3_600), venueName: "Park",
                                     address: "", locality: "", costCents: 0, capacity: 5)
        let link = try XCTUnwrap(DIPShareLink.url(forEventID: "abc"))
        let utc = TimeZone(secondsFromGMT: 0)!, locale = Locale(identifier: "en_US")
        let text = event.shareText(title: "Walk", link: link, locale: locale, timeZone: utc)
        XCTAssertTrue(text.hasSuffix("Hope to see you there!\n\n\(link.absoluteString)"))
        XCTAssertEqual(text.components(separatedBy: "\n").last, link.absoluteString)
        XCTAssertFalse(event.shareText(title: "Walk", locale: locale, timeZone: utc).contains("http"))
        var cancelled = event; cancelled.status = .cancelled
        XCTAssertFalse(cancelled.shareText(title: "Walk", link: link, locale: locale, timeZone: utc).contains("http"))
    }
}
