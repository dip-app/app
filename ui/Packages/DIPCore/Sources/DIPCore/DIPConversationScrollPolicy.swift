import Foundation

/// Incoming messages must not interrupt a reader browsing earlier conversation history.
public enum DIPConversationScrollPolicy {
    public static func shouldFollow(
        isNearBottom: Bool, previousIDs: [String], messages: [DIPMessage], currentUserID: String
    ) -> Bool {
        let previous = Set(previousIDs)
        let additions = messages.filter { !previous.contains($0.id) }
        return !additions.isEmpty && (isNearBottom || additions.contains { $0.authorID == currentUserID })
    }
}
