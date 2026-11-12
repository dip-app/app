import Foundation
import CoreFoundation
import DIPContracts
@preconcurrency import FirebaseFirestore

/// Firestore uses Timestamps, while wire DTOs use JSON dates. IDs come from snapshot metadata.
enum EventDocumentMapper {
    /// Live data is written by several tools (seed scripts, the admin portal, older builds), so every field except the
    /// tenant, the id and the start time is read tolerantly: a missing or oddly typed field falls back to a safe default
    /// instead of making the whole event unreadable. Events must never silently disappear because of a cosmetic field.
    /// Only the tenant mismatch, an invalid id and a missing start time (nothing to place the event on) still throw.
    static func decode(id: String, companyID: String, fields: [String: Any]?) throws -> DIPContracts.Event? {
        guard let f = fields else { return nil }
        guard MemberEventsRepository.validID(id), f["companyId"] as? String == companyID else { throw EventReadFailure.invalidDocument }
        let start = try requiredStart(f["startTime"])
        let end = (f["endTime"] as? Timestamp).map { $0.dateValue() }.flatMap { $0 > start ? $0 : nil } ?? start.addingTimeInterval(3600)
        let v = f["venue"] as? [String: Any] ?? [:]
        let title = text(f["title"], maximum: 120)
        let status = statusValue(f["status"])
        return DIPContracts.Event(id: id, companyId: companyID,
            title: title.isEmpty ? "Untitled activity" : title,
            description: text(f["description"], maximum: 5000),
            tagIds: (f["tagIds"] as? [Any] ?? []).compactMap { $0 as? String }.filter(MemberEventsRepository.validID),
            coverImageURL: f["coverImageURL"] as? String ?? "", startTime: start, endTime: end,
            venue: Venue(name: text(v["name"], maximum: 200), address: text(v["address"], maximum: 300),
                         locality: text(v["locality"], maximum: 200),
                         latitude: coordinate(v["latitude"], bound: 90), longitude: coordinate(v["longitude"], bound: 180),
                         fsqPlaceId: v["fsqPlaceId"] as? String, phone: v["phone"] as? String, website: v["website"] as? String),
            costCents: integer(f["costCents"], default: 0), costNote: f["costNote"] as? String ?? "",
            capacity: min(10000, integer(f["capacity"], default: 10000, minimum: 1)),
            pointsValue: integer(f["pointsValue"], default: 0), isOutdoor: boolean(f["isOutdoor"]),
            status: status, attendeeCount: integer(f["attendeeCount"], default: 0),
            createdBy: f["createdBy"] as? String ?? "", createdAt: (f["createdAt"] as? Timestamp)?.dateValue() ?? start,
            revision: integer(f["revision"], default: 1, minimum: 1), changeLog: changeLog(f["changeLog"]))
    }

    private static func requiredStart(_ raw: Any?) throws -> Date {
        guard let value = raw as? Timestamp else { throw EventReadFailure.invalidDocument }
        return value.dateValue()
    }
    private static func text(_ raw: Any?, maximum: Int) -> String {
        guard let value = raw as? String else { return "" }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return String(String.UnicodeScalarView(trimmed.unicodeScalars.prefix(maximum)))
    }
    /// An unknown or missing status is shown as scheduled: the event stays visible and the server stays the authority.
    static func statusValue(_ raw: Any?) -> String {
        guard let value = (raw as? String)?.lowercased() else { return "scheduled" }
        switch value {
        case "cancelled", "canceled": return "cancelled"
        case "completed": return "completed"
        default: return "scheduled"
        }
    }
    /// Accepts numbers (int or double), numeric strings; anything else, non-finite, or out of range is 0 (unknown place).
    static func coordinate(_ raw: Any?, bound: Double) -> Double {
        var number: Double?
        if let value = raw as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID() { number = value.doubleValue }
        else if let value = raw as? String { number = Double(value.trimmingCharacters(in: .whitespaces)) }
        guard let result = number, result.isFinite, abs(result) <= bound else { return 0 }
        return result
    }
    /// Whole numbers from ints, doubles with no fraction or numeric strings; below `minimum` or unreadable gives the default.
    static func integer(_ raw: Any?, default fallback: Int, minimum: Int = 0) -> Int {
        var number: Double?
        if let value = raw as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID() { number = value.doubleValue }
        else if let value = raw as? String { number = Double(value.trimmingCharacters(in: .whitespaces)) }
        guard let result = number, result.isFinite, abs(result) < 1e12, let whole = Int(exactly: result.rounded()) else { return fallback }
        return max(minimum, whole)
    }
    private static func boolean(_ raw: Any?) -> Bool {
        if let value = raw as? NSNumber, CFGetTypeID(value) == CFBooleanGetTypeID() { return value.boolValue }
        return (raw as? String)?.lowercased() == "true"
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
