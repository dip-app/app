import DIPCore
import Foundation
import XCTest

final class ConversationGroupingTests: XCTestCase {
    private var calendar: Calendar {
        var value = Calendar(identifier: .gregorian)
        value.timeZone = TimeZone(secondsFromGMT: 0)!
        return value
    }
    private func message(_ id: String, author: String = "a", seconds: TimeInterval) -> DIPMessage {
        .init(id: id, authorID: author, text: id, authorName: "Same display name",
              authorAvatar: .asset("AvatarPink"), createdAt: Date(timeIntervalSince1970: seconds))
    }
    func testAdjacentSameSenderMessagesGroupThroughFiveMinuteBoundary() {
        let messages = [message("1", seconds: 43_200), message("2", seconds: 43_500), message("3", seconds: 43_801)]
        let groups = DIPConversationGrouping.groups(messages, calendar: calendar)
        XCTAssertEqual(groups.map { $0.messages.map(\.id) }, [["1", "2"], ["3"]])
        XCTAssertEqual(groups.map(\.id), ["1", "3"])
        XCTAssertEqual(groups.flatMap(\.messages), messages)
    }
    func testSenderChangeStartsNewGroupEvenWhenNamesMatch() {
        let messages = [message("1", seconds: 43_200), message("2", author: "b", seconds: 43_201), message("3", seconds: 43_202)]
        XCTAssertEqual(DIPConversationGrouping.groups(messages, calendar: calendar).map { $0.messages.count }, [1, 1, 1])
    }
    func testDayBoundaryAndOutOfOrderTimesDoNotGroup() {
        XCTAssertEqual(DIPConversationGrouping.groups([
            message("1", seconds: 86_340), message("2", seconds: 86_400)
        ], calendar: calendar).count, 2)
        XCTAssertEqual(DIPConversationGrouping.groups([
            message("1", seconds: 43_210), message("2", seconds: 43_200)
        ], calendar: calendar).count, 2)
    }
    func testEmptyAndSingleMessage() {
        XCTAssertTrue(DIPConversationGrouping.groups([]).isEmpty)
        let item = message("only", seconds: 43_200)
        XCTAssertEqual(DIPConversationGrouping.groups([item]).first?.messages, [item])
    }
}
