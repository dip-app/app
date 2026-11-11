import DIPCore
import Foundation

/// Pure mapping from `companies/{c}/invites/{id}` fields and `listCoworkersV1` rows to presentation values.
/// Firestore Timestamps are converted to `Date` by the adapter before they reach this type, so it stays
/// free of the SDK. Malformed documents are skipped, never fatal (the same stance as the attendee mapper).
enum InviteDocumentMapper {
    enum Direction { case received, sent }

    /// A received invite shows the sender; a sent invite shows the recipient. Rows that do not belong to
    /// `uid` or `companyID` (a rules or query mistake) are dropped.
    static func invite(id: String, fields: [String: Any], companyID: String, uid: String, direction: Direction) -> DIPInvite? {
        guard fields["companyId"] as? String == companyID,
              let eventID = fields["eventId"] as? String, !eventID.isEmpty,
              let title = fields["eventTitle"] as? String,
              let start = fields["eventStartTime"] as? Date,
              let fromID = fields["fromUserId"] as? String, let toID = fields["toUserId"] as? String,
              let statusText = fields["status"] as? String, let status = DIPInviteStatus(rawValue: statusText) else { return nil }
        let createdAt = fields["createdAt"] as? Date ?? start
        let personID: String, name: String
        switch direction {
        case .received:
            guard toID == uid else { return nil }
            personID = fromID; name = fields["fromUserName"] as? String ?? ""
        case .sent:
            guard fromID == uid else { return nil }
            personID = toID; name = fields["toUserName"] as? String ?? ""
        }
        return DIPInvite(id: id, eventID: eventID, eventTitle: title, eventStart: start, personID: personID,
                         personName: name.isEmpty ? "A coworker" : name, message: fields["message"] as? String ?? "",
                         status: status, createdAt: createdAt)
    }

    static func coworker(_ row: [String: Any]) -> DIPCoworker? {
        guard let id = row["userId"] as? String, !id.isEmpty, let name = row["displayName"] as? String, !name.isEmpty else { return nil }
        let state = (row["state"] as? String).flatMap(DIPCoworker.State.init(rawValue:)) ?? .available
        return DIPCoworker(id: id, name: name, team: row["department"] as? String ?? "", state: state)
    }
}
