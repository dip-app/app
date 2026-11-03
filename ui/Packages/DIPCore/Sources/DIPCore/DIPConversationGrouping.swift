import Foundation

public struct DIPMessageGroup: Identifiable, Equatable, Sendable {
    public let messages: [DIPMessage]
    public var id: String { messages[0].id }
    fileprivate init(messages: [DIPMessage]) { self.messages = messages }
}

/// Only adjacent messages from the same identity group together. Dates stay local to the reader.
public enum DIPConversationGrouping {
    public static func groups(
        _ messages: [DIPMessage], maximumGap: TimeInterval = 5 * 60, calendar: Calendar = .current
    ) -> [DIPMessageGroup] {
        var groups: [[DIPMessage]] = []
        for message in messages {
            if let previous = groups.last?.last {
                let gap = message.createdAt.timeIntervalSince(previous.createdAt)
                if previous.authorID == message.authorID,
                   gap >= 0, gap <= max(0, maximumGap),
                   calendar.isDate(previous.createdAt, inSameDayAs: message.createdAt) {
                    groups[groups.count - 1].append(message)
                    continue
                }
            }
            groups.append([message])
        }
        return groups.map(DIPMessageGroup.init)
    }
}
