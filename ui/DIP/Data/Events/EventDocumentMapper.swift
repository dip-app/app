import Foundation
import CoreFoundation
import DIPContracts
@preconcurrency import FirebaseFirestore

/// Firestore uses Timestamps, while wire DTOs use JSON dates. IDs come from snapshot metadata.
enum EventDocumentMapper {
    static func decode(id: String, companyID: String, fields: [String: Any]?) throws -> DIPContracts.Event? {
        guard let f = fields else { return nil }
        func string(_ key: String) throws -> String {
            guard let value = f[key] as? String else { throw EventReadFailure.invalidDocument }; return value
        }
        func integer(_ key: String, minimum: Int = 0) throws -> Int {
            guard let number = f[key] as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
                  number.doubleValue.isFinite, number.doubleValue.rounded() == number.doubleValue,
                  let value = Int(exactly: number.doubleValue), value >= minimum else { throw EventReadFailure.invalidDocument }
            return value
        }
        func date(_ key: String) throws -> Date {
            guard let value = f[key] as? Timestamp else { throw EventReadFailure.invalidDocument }; return value.dateValue()
        }
        guard MemberEventsRepository.validID(id), try string("companyId") == companyID,
              let tags = f["tagIds"] as? [String], tags.allSatisfy(MemberEventsRepository.validID),
              let outdoor = f["isOutdoor"] as? NSNumber, CFGetTypeID(outdoor) == CFBooleanGetTypeID(),
              let v = f["venue"] as? [String: Any], let name = v["name"] as? String,
              let address = v["address"] as? String, let locality = v["locality"] as? String else { throw EventReadFailure.invalidDocument }
        func coordinate(_ key: String, bound: Double) throws -> Double {
            guard let number = v[key] as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
                  number.doubleValue.isFinite, abs(number.doubleValue) <= bound else { throw EventReadFailure.invalidDocument }
            return number.doubleValue
        }
        func optional(_ key: String) throws -> String? {
            guard let value = v[key], !(value is NSNull) else { return nil }
            guard let text = value as? String else { throw EventReadFailure.invalidDocument }; return text
        }
        let title = try string("title"), description = try string("description"), status = try string("status")
        let start = try date("startTime"), end = try date("endTime"), capacity = try integer("capacity", minimum: 1)
        guard !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, title.unicodeScalars.count <= 120,
              !description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, description.unicodeScalars.count <= 5000,
              end > start, capacity <= 10000, ["scheduled", "cancelled"].contains(status) else { throw EventReadFailure.invalidDocument }
        return try DIPContracts.Event(id: id, companyId: companyID, title: title, description: description,
            tagIds: tags, coverImageURL: string("coverImageURL"), startTime: start, endTime: end,
            venue: Venue(name: name, address: address, locality: locality, latitude: coordinate("latitude", bound: 90),
                         longitude: coordinate("longitude", bound: 180), fsqPlaceId: optional("fsqPlaceId"), phone: optional("phone"), website: optional("website")),
            costCents: integer("costCents"), costNote: string("costNote"), capacity: capacity, pointsValue: integer("pointsValue"),
            isOutdoor: outdoor.boolValue, status: status, attendeeCount: integer("attendeeCount"),
            createdBy: string("createdBy"), createdAt: date("createdAt"), revision: integer("revision", minimum: 1),
            changeLog: changeLog(f["changeLog"]))
    }

    /// Server-written history; malformed entries are skipped rather than failing the whole event.
    static func changeLog(_ raw: Any?) -> [EventChangeLogEntry]? {
        guard let items = raw as? [Any] else { return nil }
        var seen = Set<Int>()
        // Newest delivery wins when a trigger retry stored the same revision twice (ids must be unique in the UI).
        let entries = items.reversed().compactMap { $0 as? [String: Any] }.compactMap { row -> EventChangeLogEntry? in
            guard let at = (row["at"] as? Timestamp)?.dateValue(),
                  let revision = row["revision"] as? Int, revision >= 1, seen.insert(revision).inserted,
                  let changes = row["changes"] as? [[String: Any]] else { return nil }
            let parsed = changes.compactMap { change -> EventFieldChange? in
                guard let field = change["field"] as? String else { return nil }
                return EventFieldChange(field: field, from: change["from"] as? String, to: change["to"] as? String)
            }
            return parsed.isEmpty ? nil : EventChangeLogEntry(at: at, by: row["by"] as? String ?? "", revision: revision, changes: parsed)
        }
        return entries.reversed()
    }
}
