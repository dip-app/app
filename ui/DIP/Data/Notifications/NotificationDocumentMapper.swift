import DIPCore
import Foundation

/// Pure mapping from `users/{uid}/notifications/{id}` fields to presentation values. Timestamps are converted to
/// `Date` by the adapter, so this stays free of the SDK. Malformed documents are skipped, never fatal.
enum NotificationDocumentMapper {
    static func notification(id: String, fields: [String: Any], uid: String) -> DIPNotification? {
        // A document that names another recipient (a rules or query mistake) is dropped.
        if let owner = fields["userId"] as? String, owner != uid { return nil }
        guard let type = fields["type"] as? String, !type.isEmpty,
              let title = fields["title"] as? String, !title.isEmpty else { return nil }
        let targetType = fields["targetType"] as? String ?? ""
        let targetID = fields["targetId"] as? String ?? ""
        return DIPNotification(
            id: id, kind: DIPNotificationKind(serverType: type), title: title, body: fields["body"] as? String ?? "",
            destination: DIPNotificationDestination(targetType: targetType, targetID: targetID),
            createdAt: fields["createdAt"] as? Date ?? Date(), isRead: fields["isRead"] as? Bool ?? false)
    }
}
