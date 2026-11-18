import Foundation

/// One organizer edit of an event, from `Event.changeLog` (server-written by the onEventChanged trigger).
public struct DIPChangeLogEntry: Equatable, Identifiable, Sendable {
    public var id: Int { revision }
    public var at: Date
    public var revision: Int
    public var changes: [DIPFieldChange]
    public init(at: Date, revision: Int, changes: [DIPFieldChange]) {
        self.at = at; self.revision = revision; self.changes = changes
    }
}

/// A single changed field with the server's display values (`nil` = empty/unset).
public struct DIPFieldChange: Equatable, Sendable {
    public var field: String
    public var from: String?
    public var to: String?
    public init(field: String, from: String? = nil, to: String? = nil) { self.field = field; self.from = from; self.to = to }
}

/// One human-readable line of a change: a stable label plus an optional "from -> to" description.
public struct DIPChangeRow: Equatable, Identifiable, Sendable {
    public var id: String { key }
    /// Stable identity of the row kind (`time`, `location`, ...); never shown, never localized.
    public var key: String
    public var label: String
    /// Previous and new values; both nil when the value is not useful to show (long text, photo, interests),
    /// so the label alone says what changed.
    public var old: String?
    public var new: String?
    public init(label: String, old: String? = nil, new: String? = nil, key: String? = nil) { self.label = label; self.old = old; self.new = new; self.key = key ?? label }

    /// One-line text: "a → b", "Now b" or "Was a".
    public var detail: String? {
        switch (old, new) {
        case let (old?, new?): String(localized: "changelog.detail.change", defaultValue: "\(old) → \(new)", bundle: .module, comment: "Change row; first %@ = previous value, second %@ = new value")
        case let (nil, new?): String(localized: "changelog.detail.now", defaultValue: "Now \(new)", bundle: .module, comment: "Change row when there was no previous value; %@ = new value")
        case let (old?, nil): String(localized: "changelog.detail.was", defaultValue: "Was \(old)", bundle: .module, comment: "Change row when the value was removed; %@ = previous value")
        default: nil
        }
    }
}

private struct Pair { var old: String?; var new: String? }

/// Pure presentation of change-log entries: consistent field names, grouped, values formatted for people.
public enum DIPChangeLogText {
    /// Newest first, as the sheet shows them.
    public static func newestFirst(_ log: [DIPChangeLogEntry]) -> [DIPChangeLogEntry] {
        log.sorted { ($0.at, $0.revision) > ($1.at, $1.revision) }
    }

    public static func rows(_ entry: DIPChangeLogEntry, locale: Locale = .current, timeZone: TimeZone = .current) -> [DIPChangeRow] {
        var rows: [DIPChangeRow] = []
        func add(_ row: DIPChangeRow) { if !rows.contains(where: { $0.key == row.key }) { rows.append(row) } }
        let byField = Dictionary(entry.changes.map { ($0.field, $0) }, uniquingKeysWith: { first, _ in first })
        let order = ["status", "title", "startTime", "endTime", "venue.name", "venue.address", "venue.locality",
                     "costCents", "costNote", "capacity", "isOutdoor", "description", "tagIds", "coverImageURL"]
        for field in order {
            guard let change = byField[field] else { continue }
            switch field {
            case "status":
                // Only the two known statuses produce a row; an unknown future status is skipped, not mislabelled.
                if change.to == "cancelled" { add(DIPChangeRow(label: String(localized: "changelog.row.cancelled", defaultValue: "Activity cancelled", bundle: .module, comment: "Change log row: the organizer cancelled the activity"), key: "cancelled")) }
                else if change.to == "scheduled" { add(DIPChangeRow(label: String(localized: "changelog.row.backOn", defaultValue: "Activity is back on", bundle: .module, comment: "Change log row: a cancelled activity was reinstated"), key: "backOn")) }
            case "title":
                add(row("name", String(localized: "changelog.row.name", defaultValue: "Name", bundle: .module, comment: "Change log row label: activity name changed"), arrow(change.from, change.to)))
            case "startTime", "endTime":
                guard !rows.contains(where: { $0.key == "time" }) else { continue }
                add(row("time", String(localized: "changelog.row.time", defaultValue: "Time", bundle: .module, comment: "Change log row label: start or end time changed"), timeDetail(byField, locale: locale, timeZone: timeZone)))
            case "venue.name", "venue.address", "venue.locality":
                guard !rows.contains(where: { $0.key == "location" }) else { continue }
                add(row("location", String(localized: "changelog.row.location", defaultValue: "Location", bundle: .module, comment: "Change log row label: venue changed"), locationDetail(byField)))
            case "costCents", "costNote":
                guard !rows.contains(where: { $0.key == "cost" }) else { continue }
                add(row("cost", String(localized: "changelog.row.cost", defaultValue: "Cost", bundle: .module, comment: "Change log row label: price changed"), costDetail(byField, locale: locale)))
            case "capacity":
                add(row("spots", String(localized: "changelog.row.spots", defaultValue: "Spots", bundle: .module, comment: "Change log row label: capacity changed"), arrow(change.from, change.to)))
            case "isOutdoor":
                add(DIPChangeRow(label: String(localized: "changelog.row.setting", defaultValue: "Setting", bundle: .module, comment: "Change log row label: indoor/outdoor setting changed"), new: change.to == "true" ? String(localized: "changelog.setting.outdoors", defaultValue: "Outdoors", bundle: .module, comment: "Change log value: activity is outdoors") : String(localized: "changelog.setting.indoors", defaultValue: "Indoors", bundle: .module, comment: "Change log value: activity is indoors"), key: "setting"))
            case "description": add(DIPChangeRow(label: String(localized: "changelog.row.description", defaultValue: "Description updated", bundle: .module, comment: "Change log row: the description changed"), key: "description"))
            case "tagIds": add(DIPChangeRow(label: String(localized: "changelog.row.interests", defaultValue: "Interests updated", bundle: .module, comment: "Change log row: the interest tags changed"), key: "interests"))
            case "coverImageURL": add(DIPChangeRow(label: String(localized: "changelog.row.photo", defaultValue: "Photo changed", bundle: .module, comment: "Change log row: the cover photo changed"), key: "photo"))
            default: break
            }
        }
        return rows
    }

    // MARK: Formatting

    private static func row(_ key: String, _ label: String, _ pair: Pair?) -> DIPChangeRow {
        DIPChangeRow(label: label, old: pair?.old, new: pair?.new, key: key)
    }

    private static func arrow(_ from: String?, _ to: String?) -> Pair? {
        let from = clean(from), to = clean(to)
        return from == nil && to == nil ? nil : Pair(old: from, new: to)
    }

    private static func clean(_ text: String?) -> String? {
        let trimmed = text?.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed?.isEmpty == false ? trimmed : nil
    }

    nonisolated(unsafe) private static let isoWithFraction: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return formatter
    }()
    nonisolated(unsafe) private static let isoPlain = ISO8601DateFormatter()

    private static func date(_ iso: String?) -> Date? {
        guard let iso else { return nil }
        return isoWithFraction.date(from: iso) ?? isoPlain.date(from: iso)
    }

    /// Entries that render at least one row (what the sheet will actually show).
    public static func visibleCount(_ log: [DIPChangeLogEntry]) -> Int { log.filter { !rows($0).isEmpty }.count }

    private static func dayAndTime(_ value: String?, locale: Locale, timeZone: TimeZone) -> String? {
        guard let parsed = date(value) else { return nil }
        let formatter = DateFormatter()
        formatter.locale = locale; formatter.timeZone = timeZone
        formatter.setLocalizedDateFormatFromTemplate("EEEMMMdjmm")
        return formatter.string(from: parsed)
    }

    private static func timeDetail(_ fields: [String: DIPFieldChange], locale: Locale, timeZone: TimeZone) -> Pair? {
        if let start = fields["startTime"] {
            return arrowText(dayAndTime(start.from, locale: locale, timeZone: timeZone), dayAndTime(start.to, locale: locale, timeZone: timeZone))
        }
        if let end = fields["endTime"] {
            let time = DateFormatter(); time.locale = locale; time.timeZone = timeZone
            time.dateStyle = .none; time.timeStyle = .short
            let from = date(end.from).map(time.string(from:)), to = date(end.to).map(time.string(from:))
            func ends(_ time: String) -> String {
                String(localized: "changelog.time.ends", defaultValue: "Ends \(time)", bundle: .module, comment: "Change log time value when only the end time changed; %@ = clock time")
            }
            return arrowText(from.map(ends), to.map(ends))
        }
        return nil
    }

    private static func arrowText(_ from: String?, _ to: String?) -> Pair? {
        guard let to else { return nil }
        return Pair(old: from, new: to)
    }

    private static func locationDetail(_ fields: [String: DIPFieldChange]) -> Pair? {
        let name = fields["venue.name"]
        let address = fields["venue.address"]
        let from = [clean(name?.from), clean(address?.from)].compactMap { $0 }.joined(separator: ", ")
        let to = [clean(name?.to), clean(address?.to)].compactMap { $0 }.joined(separator: ", ")
        if !to.isEmpty { return Pair(old: from.isEmpty ? nil : from, new: to) }
        if let locality = fields["venue.locality"] { return arrow(locality.from, locality.to) }
        return nil
    }

    private static func costDetail(_ fields: [String: DIPFieldChange], locale: Locale) -> Pair? {
        guard let cents = fields["costCents"] else { return fields["costNote"].flatMap { arrow($0.from, $0.to) } }
        func price(_ text: String?) -> String? {
            guard let text, let value = Int(text) else { return nil }
            if value == 0 { return String(localized: "changelog.cost.free", defaultValue: "Free", bundle: .module, comment: "Change log price value: no cost") }
            let formatter = NumberFormatter(); formatter.locale = locale
            formatter.numberStyle = .currency; formatter.currencyCode = "USD"
            return formatter.string(from: NSDecimalNumber(value: value).dividing(by: 100))
        }
        return arrowText(price(cents.from), price(cents.to))
    }
}
