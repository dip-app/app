import Foundation

// Calendar conflicts (stretch S1, docs/design/stretch/calendar.md). Everything here is pure and platform neutral:
// EventKit stays in the app target. Calendar titles and times are processed on the device only; nothing in this
// file logs, uploads or persists a title.

/// One entry from a calendar source, reduced to what the overlap check needs.
public struct DIPCalendarItem: Equatable, Sendable {
    public enum Availability: Equatable, Sendable { case busy, tentative, free }

    public var title: String
    public var start: Date
    public var end: Date
    public var isAllDay: Bool
    public var availability: Availability
    /// The member declined the invitation.
    public var isDeclined: Bool
    public var isCanceled: Bool
    /// The entry URL; DIP writes its share link here, which is how DIP recognizes its own entries.
    public var url: URL?

    public init(title: String, start: Date, end: Date, isAllDay: Bool = false, availability: Availability = .busy,
                isDeclined: Bool = false, isCanceled: Bool = false, url: URL? = nil) {
        self.title = title; self.start = start; self.end = end; self.isAllDay = isAllDay
        self.availability = availability; self.isDeclined = isDeclined; self.isCanceled = isCanceled; self.url = url
    }
}

/// Something the member is already doing at the same time as the viewed event.
public struct DIPCalendarConflict: Equatable, Sendable {
    public enum Source: Equatable, Sendable {
        /// Another DIP event the member joined (Phase A, no permission needed).
        case dip(eventID: String)
        /// An entry in the device calendar (Phase B, opt-in full access).
        case device
    }

    public var title: String
    public var start: Date
    public var end: Date
    /// Tentative entries are soft conflicts: shown, but worded as "may overlap".
    public var isSoft: Bool
    public var source: Source

    public init(title: String, start: Date, end: Date, isSoft: Bool = false, source: Source) {
        self.title = title; self.start = start; self.end = end; self.isSoft = isSoft; self.source = source
    }
}

/// Which device entries count as busy.
public struct DIPCalendarConflictRules: Equatable, Sendable {
    /// All-day entries (holidays, birthdays, "working from home") are ignored unless the member turns this on.
    public var treatsAllDayAsBusy: Bool

    public init(treatsAllDayAsBusy: Bool = false) { self.treatsAllDayAsBusy = treatsAllDayAsBusy }
}

public enum DIPCalendarOverlap {
    /// Half-open intervals: an entry that ends exactly when the event starts is not a conflict. A zero-length
    /// entry counts when its instant falls inside the other interval.
    public static func overlaps(_ aStart: Date, _ aEnd: Date, _ bStart: Date, _ bEnd: Date) -> Bool {
        let aEnd = max(aStart, aEnd), bEnd = max(bStart, bEnd)
        if aStart == aEnd { return bStart <= aStart && aStart < bEnd }
        if bStart == bEnd { return aStart <= bStart && bStart < aEnd }
        return aStart < bEnd && bStart < aEnd
    }

    /// Device entries overlapping `start..<end`, after the ignore rules: canceled, declined and free entries,
    /// all-day entries (unless `rules` says otherwise) and DIP's own entry for this event (`excluding`).
    /// Sorted by start, then title, so the modal text is stable.
    public static func conflicts(start: Date, end: Date, items: [DIPCalendarItem],
                                 rules: DIPCalendarConflictRules = .init(), excluding: Set<URL> = []) -> [DIPCalendarConflict] {
        items.filter { item in
            guard !item.isCanceled, !item.isDeclined, item.availability != .free else { return false }
            if item.isAllDay && !rules.treatsAllDayAsBusy { return false }
            if let url = item.url, excluding.contains(url) { return false }
            return overlaps(start, end, item.start, item.end)
        }
        .map { DIPCalendarConflict(title: $0.title, start: $0.start, end: $0.end, isSoft: $0.availability == .tentative, source: .device) }
        .sorted(by: ordered)
    }

    /// Phase A: other DIP events the member joined that overlap `event`. Needs no permission and works offline.
    /// Only scheduled, not-yet-ended events with metadata count; the event itself never conflicts with itself.
    public static func dipConflicts(for event: DIPEventDetail, among events: [DIPEventDetail], now: Date) -> [DIPCalendarConflict] {
        guard let metadata = event.metadata else { return [] }
        return events.compactMap { other -> DIPCalendarConflict? in
            guard other.id != event.id, other.isJoined, !other.isPast, let theirs = other.metadata,
                  theirs.status == .scheduled, theirs.calendarEnd > now,
                  overlaps(metadata.startTime, metadata.calendarEnd, theirs.startTime, theirs.calendarEnd) else { return nil }
            return DIPCalendarConflict(title: other.title, start: theirs.startTime, end: theirs.calendarEnd, source: .dip(eventID: other.id))
        }
        .sorted(by: ordered)
    }

    /// DIP conflicts plus device conflicts that are not a copy of one of them. Copies DIP wrote carry the share
    /// link and are excluded upstream by `ownEntryURLs`; this also drops copies made by hand (same title and times).
    public static func merged(dip: [DIPCalendarConflict], device: [DIPCalendarConflict]) -> [DIPCalendarConflict] {
        let deviceOnly = device.filter { conflict in
            !dip.contains { $0.start == conflict.start && $0.end == conflict.end && $0.title == conflict.title }
        }
        return (dip + deviceOnly).sorted(by: ordered)
    }

    /// DIP's own calendar entries for these events (their share links), excluded from device conflicts so an
    /// event never conflicts with its own calendar copy, and a joined DIP event is not listed twice.
    public static func ownEntryURLs(eventIDs: [String]) -> Set<URL> {
        Set(eventIDs.compactMap(DIPShareLink.url(forEventID:)))
    }

    static func ordered(_ lhs: DIPCalendarConflict, _ rhs: DIPCalendarConflict) -> Bool {
        if lhs.start != rhs.start { return lhs.start < rhs.start }
        if lhs.isSoft != rhs.isSoft { return !lhs.isSoft }
        return lhs.title.localizedStandardCompare(rhs.title) == .orderedAscending
    }
}

/// A start-sorted index over one fetched window, so Home can ask about many events without refetching.
public struct DIPCalendarIndex: Sendable {
    public let items: [DIPCalendarItem]
    private let longest: TimeInterval

    public init(_ items: [DIPCalendarItem]) {
        self.items = items.sorted { $0.start < $1.start }
        longest = items.map { max(0, $0.end.timeIntervalSince($0.start)) }.max() ?? 0
    }

    /// Items that can overlap `start..<end` (before ignore rules), found by binary search on start.
    public func candidates(start: Date, end: Date) -> [DIPCalendarItem] {
        let lower = start.addingTimeInterval(-longest)
        var low = 0, high = items.count
        while low < high {
            let mid = (low + high) / 2
            if items[mid].start < lower { low = mid + 1 } else { high = mid }
        }
        var found: [DIPCalendarItem] = []
        var index = low
        while index < items.count, items[index].start <= end {
            if DIPCalendarOverlap.overlaps(start, end, items[index].start, items[index].end) { found.append(items[index]) }
            index += 1
        }
        return found
    }

    public func conflicts(start: Date, end: Date, rules: DIPCalendarConflictRules = .init(), excluding: Set<URL> = []) -> [DIPCalendarConflict] {
        DIPCalendarOverlap.conflicts(start: start, end: end, items: candidates(start: start, end: end), rules: rules, excluding: excluding)
    }
}

/// Text for the "Overlaps with" modal, the pill and VoiceOver. Up to two names, then "and N more".
public enum DIPCalendarOverlapText {
    public static let untitled = "a busy time"

    public static func title(_ conflicts: [DIPCalendarConflict]) -> String {
        guard !conflicts.isEmpty else { return "" }
        let allSoft = conflicts.allSatisfy(\.isSoft)
        return (allSoft ? "May overlap with " : "Overlaps with ") + names(conflicts)
    }

    /// "Team Lunch", "Team Lunch and Standup", "Team Lunch, Standup and 2 more".
    public static func names(_ conflicts: [DIPCalendarConflict]) -> String {
        let names = conflicts.map { name($0.title) }
        switch names.count {
        case 0: return ""
        case 1: return names[0]
        case 2: return "\(names[0]) and \(names[1])"
        default: return "\(names[0]), \(names[1]) and \(names.count - 2) more"
        }
    }

    /// One line per conflict with its time, for the modal body; a single conflict shows only its time (the title
    /// already names it). `timeZone` and `locale` are injectable for tests.
    public static func message(_ conflicts: [DIPCalendarConflict], locale: Locale = .current, timeZone: TimeZone = .current) -> String {
        let formatter = DateIntervalFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        let lines = conflicts.prefix(3).map { conflict -> String in
            let time = formatter.string(from: conflict.start, to: max(conflict.start, conflict.end))
            let label = conflicts.count == 1 ? "" : "\(name(conflict.title)): "
            return "\(label)\(time)\(conflict.isSoft ? " (tentative)" : "")"
        }
        let more = conflicts.count > 3 ? ["and \(conflicts.count - 3) more"] : []
        return (lines + more).joined(separator: "\n")
    }

    private static func name(_ title: String) -> String {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? untitled : trimmed
    }
}

/// What the event page date pill shows. Pure so every state is unit tested.
public enum DIPCalendarPillState: Equatable, Sendable {
    /// Past or cancelled: no pill action (the informational date pill stays).
    case hidden
    /// Nothing known to overlap. `direct` saves straight to the default calendar (full access); otherwise the
    /// system editor opens, which needs no permission.
    case free(direct: Bool)
    /// Something overlaps: tapping opens the "Overlaps with" modal first.
    case conflict([DIPCalendarConflict], direct: Bool)
    /// A save is in flight.
    case adding
    /// Already in the member's calendar: informational, disabled.
    case added

    public static func resolve(canAdd: Bool, isAdded: Bool, isAdding: Bool, direct: Bool,
                               conflicts: [DIPCalendarConflict]) -> DIPCalendarPillState {
        guard canAdd else { return .hidden }
        if isAdded { return .added }
        if isAdding { return .adding }
        return conflicts.isEmpty ? .free(direct: direct) : .conflict(conflicts, direct: direct)
    }

    public var isEnabled: Bool {
        switch self {
        case .free, .conflict: true
        case .hidden, .adding, .added: false
        }
    }

    public var accessibilityLabel: String {
        switch self {
        case .hidden: ""
        case .free: "Add to calendar"
        case .conflict(let conflicts, _): "Add to calendar. \(DIPCalendarOverlapText.title(conflicts))"
        case .adding: "Adding to calendar"
        case .added: "Added to your calendar"
        }
    }
}

/// Events that fit the member's calendar come first; nothing is ever hidden and order is otherwise kept.
public enum DIPCalendarFit {
    public static func prioritized<Item>(_ items: [Item], id: (Item) -> String, conflicted: Set<String>) -> [Item] {
        guard !conflicted.isEmpty else { return items }
        return items.filter { !conflicted.contains(id($0)) } + items.filter { conflicted.contains(id($0)) }
    }
}

// MARK: - Local records (per uid, on device only)

/// DIP's own calendar entry for one event: enough to re-find, update or remove it, and to notice that the event
/// moved. No titles are stored.
public struct DIPCalendarEntryRecord: Codable, Equatable, Sendable {
    public var eventID: String
    /// `EKEvent.eventIdentifier`; nil when the entry was saved through the system editor (DIP cannot see it).
    public var itemIdentifier: String?
    public var startDate: Date
    public var endDate: Date

    public init(eventID: String, itemIdentifier: String?, startDate: Date, endDate: Date) {
        self.eventID = eventID; self.itemIdentifier = itemIdentifier; self.startDate = startDate; self.endDate = endDate
    }

    /// True when the event's current times differ from what was written to the calendar. Sub-minute differences
    /// (calendar storage rounding) do not count as a move.
    public func isOutdated(for fields: DIPCalendarEventFields) -> Bool {
        abs(startDate.timeIntervalSince(fields.startDate)) >= 60 || abs(endDate.timeIntervalSince(fields.endDate)) >= 60
    }
}

/// Opt-in settings. Default off: DIP never reads the calendar until the member turns this on.
public struct DIPCalendarPreferences: Codable, Equatable, Sendable {
    public var showsConflicts: Bool
    public var teaserDismissed: Bool
    public var treatsAllDayAsBusy: Bool

    public init(showsConflicts: Bool = false, teaserDismissed: Bool = false, treatsAllDayAsBusy: Bool = false) {
        self.showsConflicts = showsConflicts; self.teaserDismissed = teaserDismissed; self.treatsAllDayAsBusy = treatsAllDayAsBusy
    }
}

/// Per-uid local storage for preferences and entry records (UserDefaults key `dip.calendar.v1.<uid>`).
public final class DIPCalendarLocalStore: @unchecked Sendable {
    private struct Payload: Codable {
        var preferences = DIPCalendarPreferences()
        var entries: [String: DIPCalendarEntryRecord] = [:]
    }

    public let uid: String
    private let defaults: UserDefaults
    private let lock = NSLock()

    public static func key(for uid: String) -> String { "dip.calendar.v1.\(uid)" }

    public init(uid: String, defaults: UserDefaults = .standard) {
        self.uid = uid; self.defaults = defaults
    }

    public var preferences: DIPCalendarPreferences {
        get { load().preferences }
        set { mutate { $0.preferences = newValue } }
    }

    public func record(for eventID: String) -> DIPCalendarEntryRecord? { load().entries[eventID] }

    public func save(_ record: DIPCalendarEntryRecord) { mutate { $0.entries[record.eventID] = record } }

    public func removeRecord(for eventID: String) { mutate { $0.entries[eventID] = nil } }

    /// Sign-out or account deletion: forget everything for this uid.
    public func removeAll() { lock.withLock { defaults.removeObject(forKey: Self.key(for: uid)) } }

    private func load() -> Payload {
        lock.withLock {
            guard let data = defaults.data(forKey: Self.key(for: uid)),
                  let payload = try? JSONDecoder().decode(Payload.self, from: data) else { return Payload() }
            return payload
        }
    }

    private func mutate(_ change: (inout Payload) -> Void) {
        lock.withLock {
            var payload = (defaults.data(forKey: Self.key(for: uid)).flatMap { try? JSONDecoder().decode(Payload.self, from: $0) }) ?? Payload()
            change(&payload)
            if let data = try? JSONEncoder().encode(payload) { defaults.set(data, forKey: Self.key(for: uid)) }
        }
    }
}

// MARK: - Device calendar port

public enum DIPCalendarAccess: Equatable, Sendable {
    case notDetermined, denied, restricted, writeOnly, fullAccess
}

public enum DIPCalendarWriteError: Error, Equatable, Sendable {
    case noAccess, notFound, failed(String)
}

/// Reads conflicts from the device calendar. The EventKit adapter lives in the app; tests and previews use
/// `DIPFakeDeviceCalendar`.
public protocol DIPCalendarConflictChecking: Sendable {
    @MainActor func conflicts(start: Date, end: Date, rules: DIPCalendarConflictRules, excluding: Set<URL>) async -> [DIPCalendarConflict]
}

/// The device calendar: access, a window read, and writes limited to entries DIP created.
public protocol DIPDeviceCalendar: DIPCalendarConflictChecking {
    @MainActor var access: DIPCalendarAccess { get }
    @MainActor func requestFullAccess() async -> DIPCalendarAccess
    /// Entries overlapping the window. Adapters read only the window asked for (cached per window).
    @MainActor func items(start: Date, end: Date) async -> [DIPCalendarItem]
    /// Saves without UI to the default calendar; returns the new entry's identifier.
    @MainActor func save(_ fields: DIPCalendarEventFields) async throws -> String
    /// Moves an entry DIP created to new times; returns its (possibly new) identifier.
    @MainActor func update(identifier: String, with fields: DIPCalendarEventFields) async throws -> String
    @MainActor func remove(identifier: String) async throws
    /// The identifier of an entry carrying `url` (DIP's share link) inside the window, for re-finding an entry
    /// whose identifier changed or that was saved through the editor.
    @MainActor func identifier(forURL url: URL, start: Date, end: Date) async -> String?
}

extension DIPDeviceCalendar {
    @MainActor public func conflicts(start: Date, end: Date, rules: DIPCalendarConflictRules, excluding: Set<URL>) async -> [DIPCalendarConflict] {
        guard access == .fullAccess else { return [] }
        let items = await items(start: start, end: end)
        return DIPCalendarOverlap.conflicts(start: start, end: end, items: items, rules: rules, excluding: excluding)
    }
}

/// In-memory device calendar for tests, previews and UI-test launch arguments. Never touches EventKit.
@MainActor public final class DIPFakeDeviceCalendar: DIPDeviceCalendar {
    public var access: DIPCalendarAccess
    /// What `requestFullAccess` grants (simulates the member's answer to the system prompt).
    public var grantOnRequest: DIPCalendarAccess
    public private(set) var entries: [String: (fields: DIPCalendarEventFields?, item: DIPCalendarItem)] = [:]
    public private(set) var requestCount = 0
    public private(set) var readWindows: [(start: Date, end: Date)] = []
    private var nextID = 1

    public init(access: DIPCalendarAccess = .fullAccess, grantOnRequest: DIPCalendarAccess = .fullAccess, items: [DIPCalendarItem] = []) {
        self.access = access
        self.grantOnRequest = grantOnRequest
        for item in items { entries[makeID()] = (nil, item) }
    }

    public func requestFullAccess() async -> DIPCalendarAccess {
        requestCount += 1
        if access == .notDetermined { access = grantOnRequest }
        return access
    }

    public func items(start: Date, end: Date) async -> [DIPCalendarItem] {
        guard access == .fullAccess else { return [] }
        readWindows.append((start, end))
        return entries.values.map(\.item).filter { DIPCalendarOverlap.overlaps(start, end, $0.start, $0.end) }
    }

    public func save(_ fields: DIPCalendarEventFields) async throws -> String {
        guard access == .fullAccess || access == .writeOnly else { throw DIPCalendarWriteError.noAccess }
        let id = makeID()
        entries[id] = (fields, Self.item(fields))
        return id
    }

    public func update(identifier: String, with fields: DIPCalendarEventFields) async throws -> String {
        guard access == .fullAccess else { throw DIPCalendarWriteError.noAccess }
        guard entries[identifier]?.fields != nil else { throw DIPCalendarWriteError.notFound }
        entries[identifier] = (fields, Self.item(fields))
        return identifier
    }

    public func remove(identifier: String) async throws {
        guard access == .fullAccess else { throw DIPCalendarWriteError.noAccess }
        guard entries[identifier]?.fields != nil else { throw DIPCalendarWriteError.notFound }
        entries[identifier] = nil
    }

    public func identifier(forURL url: URL, start: Date, end: Date) async -> String? {
        guard access == .fullAccess else { return nil }
        return entries.first { $0.value.item.url == url && DIPCalendarOverlap.overlaps(start, end, $0.value.item.start, $0.value.item.end) }?.key
    }

    /// Simulates the member revoking access in iOS Settings mid-session.
    public func revoke() { access = .denied }

    private func makeID() -> String { defer { nextID += 1 }; return "fake-\(nextID)" }

    private static func item(_ fields: DIPCalendarEventFields) -> DIPCalendarItem {
        DIPCalendarItem(title: fields.title, start: fields.startDate, end: fields.endDate, isAllDay: fields.isAllDay, url: fields.url)
    }
}
