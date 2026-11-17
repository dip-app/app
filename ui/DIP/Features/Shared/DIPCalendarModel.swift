import DIPCore
#if DEBUG
import DIPMockData
#endif
import Foundation
import Observation
import SwiftUI

/// Calendar conflicts and one-tap add for the signed-in member (docs/design/stretch/calendar.md).
///
/// - Phase A (always on, no permission): overlaps with other DIP events the member joined.
/// - Phase B (feature flag + per-uid opt-in + full calendar access): overlaps with device calendar entries, read on
///   the device only, and direct saves with Undo. Without it the pill keeps the permissionless system editor.
///
/// Calendar titles are never logged, uploaded or written to analytics; records store identifiers and times only.
@MainActor @Observable final class DIPCalendarModel {
    /// Build flag `DIPCalendarConflictsEnabled` (Info.plist, build setting DIP_CALENDAR_CONFLICTS_ENABLED).
    let featureEnabled: Bool
    @ObservationIgnored private let store: DIPCalendarLocalStore?
    @ObservationIgnored let device: (any DIPDeviceCalendar)?
    private(set) var preferences: DIPCalendarPreferences
    private(set) var access: DIPCalendarAccess
    /// Bumped when the device calendar, access or preferences change; views re-run conflict work with `.task(id:)`.
    private(set) var revision = 0
    /// Set when the member turned conflicts on but iOS access is denied; the UI offers Settings.
    var accessDeniedNotice = false
    /// Records for a model without a store (signed out, previews): kept for the session only.
    @ObservationIgnored private var memoryRecords: [String: DIPCalendarEntryRecord] = [:]
    private var recordsRevision = 0

    init(featureEnabled: Bool, store: DIPCalendarLocalStore?, device: (any DIPDeviceCalendar)?) {
        self.featureEnabled = featureEnabled
        self.store = store
        self.device = device
        preferences = store?.preferences ?? DIPCalendarPreferences()
        access = device?.access ?? .notDetermined
    }

    /// Feature off, no storage, no device: DIP-only conflicts and the system editor (the environment default).
    static func disabled() -> DIPCalendarModel { DIPCalendarModel(featureEnabled: false, store: nil, device: nil) }

    // MARK: State

    /// DIP reads the device calendar only when all three hold.
    var readsCalendar: Bool { featureEnabled && preferences.showsConflicts && access == .fullAccess }

    /// Direct save (no editor) only for members who opted in; everyone else reviews in the system editor.
    var savesDirectly: Bool { readsCalendar }

    /// The one-time opt-in card on the event page.
    var showsTeaser: Bool {
        featureEnabled && device != nil && !preferences.showsConflicts && !preferences.teaserDismissed
            && access != .restricted
    }

    /// Re-reads iOS access (foreground, after Settings). A revoke mid-session simply stops device reads.
    func refreshAccess() {
        let current = device?.access ?? .notDetermined
        if current != access { access = current; revision += 1 }
    }

    /// The device calendar changed (EKEventStoreChanged): conflicts are recomputed.
    func calendarChanged() { revision += 1 }

    // MARK: Settings

    /// Turns device conflicts on or off. Turning on asks iOS for full access first; a denial leaves it off and
    /// raises `accessDeniedNotice`. Returns the resulting value.
    @discardableResult func setShowsConflicts(_ on: Bool) async -> Bool {
        guard featureEnabled, let device else { return false }
        if on {
            if device.access == .notDetermined { access = await device.requestFullAccess() } else { access = device.access }
            guard access == .fullAccess else {
                accessDeniedNotice = true
                updatePreferences { $0.showsConflicts = false; $0.teaserDismissed = true }
                return false
            }
        }
        updatePreferences { $0.showsConflicts = on; $0.teaserDismissed = true }
        return on
    }

    func dismissTeaser() { updatePreferences { $0.teaserDismissed = true } }

    func setTreatsAllDayAsBusy(_ on: Bool) { updatePreferences { $0.treatsAllDayAsBusy = on } }

    private func updatePreferences(_ change: (inout DIPCalendarPreferences) -> Void) {
        change(&preferences)
        store?.preferences = preferences
        revision += 1
    }

    // MARK: Conflicts

    /// DIP conflicts (always) merged with device conflicts (opt-in). `joined` is the member's other events.
    func conflicts(for event: DIPEventDetail, among events: [DIPEventDetail], now: Date = Date()) async -> [DIPCalendarConflict] {
        guard let metadata = event.metadata else { return [] }
        let dip = DIPCalendarOverlap.dipConflicts(for: event, among: events, now: now)
        guard readsCalendar, let device else { return dip }
        let own = DIPCalendarOverlap.ownEntryURLs(eventIDs: [event.id] + events.filter(\.isJoined).map(\.id))
        let fields = metadata.calendarFields(title: event.title, description: "", eventID: event.id)
        let deviceConflicts = await device.conflicts(
            start: fields.startDate, end: fields.endDate,
            rules: DIPCalendarConflictRules(treatsAllDayAsBusy: preferences.treatsAllDayAsBusy), excluding: own)
        return DIPCalendarOverlap.merged(dip: dip, device: deviceConflicts)
    }

    /// Home: ids of `candidates` that overlap something, with ONE device read over their whole span.
    func conflictedEventIDs(_ candidates: [DIPEventDetail], among events: [DIPEventDetail], now: Date = Date()) async -> Set<String> {
        var ids = Set(candidates.filter { !DIPCalendarOverlap.dipConflicts(for: $0, among: events, now: now).isEmpty }.map(\.id))
        guard readsCalendar, let device else { return ids }
        let windows = candidates.compactMap { event -> (String, Date, Date)? in
            guard let fields = event.metadata?.calendarFields(title: event.title, description: "", eventID: event.id) else { return nil }
            return (event.id, fields.startDate, fields.endDate)
        }
        guard let start = windows.map(\.1).min(), let end = windows.map(\.2).max() else { return ids }
        let index = DIPCalendarIndex(await device.items(start: start, end: end))
        let own = DIPCalendarOverlap.ownEntryURLs(eventIDs: events.filter(\.isJoined).map(\.id) + candidates.map(\.id))
        let rules = DIPCalendarConflictRules(treatsAllDayAsBusy: preferences.treatsAllDayAsBusy)
        for (id, start, end) in windows where !index.conflicts(start: start, end: end, rules: rules, excluding: own).isEmpty {
            ids.insert(id)
        }
        return ids
    }

    // MARK: Entries DIP created

    func record(for eventID: String) -> DIPCalendarEntryRecord? {
        _ = recordsRevision
        return store?.record(for: eventID) ?? memoryRecords[eventID]
    }

    /// In the calendar at the event's current times.
    func isAdded(eventID: String, fields: DIPCalendarEventFields) -> Bool {
        record(for: eventID).map { !$0.isOutdated(for: fields) } ?? false
    }

    /// In the calendar, but the event moved since: DIP offers "Update your calendar entry" (full access only).
    func needsUpdate(eventID: String, fields: DIPCalendarEventFields) -> Bool {
        guard readsCalendar, let record = record(for: eventID) else { return false }
        return record.isOutdated(for: fields)
    }

    /// Direct save (opted-in members). Callers use the system editor when `savesDirectly` is false and then
    /// call `markAddedThroughEditor`.
    func addDirectly(_ fields: DIPCalendarEventFields, eventID: String) async -> DIPCalendarAddResult {
        guard savesDirectly, let device else { return .failed("Calendar access is off.") }
        do {
            let identifier = try await device.save(fields)
            remember(DIPCalendarEntryRecord(eventID: eventID, itemIdentifier: identifier, startDate: fields.startDate, endDate: fields.endDate))
            return .added
        } catch {
            return .failed("Couldn’t save to your calendar. Try again, or check calendar access in Settings.")
        }
    }

    /// The system editor saved the entry. DIP cannot see it, but with full access it can re-find it by its URL.
    func markAddedThroughEditor(_ fields: DIPCalendarEventFields, eventID: String) async {
        var identifier: String?
        if readsCalendar, let device, let url = fields.url {
            identifier = await device.identifier(forURL: url, start: fields.startDate, end: fields.endDate)
        }
        remember(DIPCalendarEntryRecord(eventID: eventID, itemIdentifier: identifier, startDate: fields.startDate, endDate: fields.endDate))
    }

    /// Undo after a direct save, and "Remove from your calendar" after leaving. Only touches the entry DIP
    /// created (its stored identifier, or the entry carrying this event's share link).
    @discardableResult func removeEntry(eventID: String, fields: DIPCalendarEventFields) async -> Bool {
        guard let record = record(for: eventID) else { return false }
        guard let device, access == .fullAccess || record.itemIdentifier != nil else { forget(eventID); return false }
        var identifier = record.itemIdentifier
        if identifier == nil, let url = fields.url {
            identifier = await device.identifier(forURL: url, start: record.startDate, end: record.endDate)
        }
        guard let identifier else { forget(eventID); return false }
        do {
            try await device.remove(identifier: identifier)
            forget(eventID)
            return true
        } catch DIPCalendarWriteError.notFound {
            forget(eventID)
            return false
        } catch {
            return false
        }
    }

    /// True when leaving can offer "Remove from your calendar": DIP made the entry and can delete it.
    func canRemoveEntry(eventID: String) -> Bool {
        guard let record = record(for: eventID) else { return false }
        return readsCalendar || (record.itemIdentifier != nil && access == .fullAccess)
    }

    /// Moves DIP's entry to the event's new times.
    @discardableResult func updateEntry(eventID: String, fields: DIPCalendarEventFields) async -> Bool {
        guard readsCalendar, let device, let record = record(for: eventID) else { return false }
        var identifier = record.itemIdentifier
        if identifier == nil, let url = fields.url {
            identifier = await device.identifier(forURL: url, start: record.startDate, end: record.endDate)
        }
        guard let identifier, let updated = try? await device.update(identifier: identifier, with: fields) else { return false }
        remember(DIPCalendarEntryRecord(eventID: eventID, itemIdentifier: updated, startDate: fields.startDate, endDate: fields.endDate))
        return true
    }

    /// Leaving without removing (or without access): forget the record so the pill offers Add again later.
    func forget(_ eventID: String) {
        store?.removeRecord(for: eventID)
        memoryRecords[eventID] = nil
        recordsRevision += 1
    }

    private func remember(_ record: DIPCalendarEntryRecord) {
        if let store { store.save(record) } else { memoryRecords[record.eventID] = record }
        recordsRevision += 1
    }
}

extension DIPCalendarModel {
    /// Shared feature-off model: the environment default.
    @MainActor static let sharedDisabled = DIPCalendarModel.disabled()
}

extension EnvironmentValues {
    /// The signed-in member's calendar model; the default is feature-off (DIP-only conflicts, system editor).
    @Entry var dipCalendar: DIPCalendarModel = MainActor.assumeIsolated { DIPCalendarModel.sharedDisabled }
}

// MARK: - Composition

extension DIPCalendarModel {
    /// The production model for a signed-in member: EventKit device calendar when the build flag is on.
    /// Debug builds also accept `--calendar-conflicts` to force the feature on.
    static func live(uid: String, arguments: [String] = ProcessInfo.processInfo.arguments) -> DIPCalendarModel {
        var enabled = (Bundle.main.object(forInfoDictionaryKey: "DIPCalendarConflictsEnabled") as? String) == "YES"
        #if DEBUG
        if arguments.contains("--calendar-conflicts") { enabled = true }
        #endif
        let store = DIPCalendarLocalStore(uid: uid)
        guard enabled else { return DIPCalendarModel(featureEnabled: false, store: store, device: nil) }
        let adapter = DIPEventKitDeviceCalendar()
        let model = DIPCalendarModel(featureEnabled: true, store: store, device: adapter)
        adapter.onChange = { [weak model] in model?.calendarChanged() }
        return model
    }

    #if DEBUG
    /// `--calendar-fake=<state>` builds an in-memory device calendar (never EventKit) for UI tests and captures.
    /// States: free, conflict, added, off, denied. Returns nil without the argument.
    static func fake(uid: String, arguments: [String] = ProcessInfo.processInfo.arguments, now: Date = Date()) -> DIPCalendarModel? {
        let prefix = "--calendar-fake="
        guard let state = arguments.first(where: { $0.hasPrefix(prefix) }).map({ String($0.dropFirst(prefix.count)) }) else { return nil }
        // Fixture events start whole days from now; the fake entries straddle each upcoming start.
        let upcoming = DIPMockFixtures.v1Events(now: now).eventDetails.values
            .compactMap { event in event.metadata.map { (id: event.id, metadata: $0) } }
            .filter { $0.metadata.startTime > now }
            .sorted { $0.metadata.startTime < $1.metadata.startTime }
        let store = DIPCalendarLocalStore(uid: uid, defaults: UserDefaults(suiteName: "work.letsdip.calendar-fake") ?? .standard)
        store.removeAll()
        var access = DIPCalendarAccess.fullAccess
        var preferences = DIPCalendarPreferences(showsConflicts: true, teaserDismissed: true)
        var items: [DIPCalendarItem] = []
        switch state {
        case "conflict":
            for (index, entry) in upcoming.enumerated() {
                let start = entry.metadata.startTime
                func item(_ title: String, _ availability: DIPCalendarItem.Availability) -> DIPCalendarItem {
                    DIPCalendarItem(title: title, start: start.addingTimeInterval(-1_800), end: start.addingTimeInterval(1_800), availability: availability)
                }
                items.append(item(index == 0 ? "Team Lunch" : "Focus time", .busy))
                if index == 1 { items.append(item("Design Review", .tentative)) }
            }
        case "added":
            // Every upcoming fixture event is already in the calendar (dictionary order is not stable).
            for entry in upcoming {
                store.save(DIPCalendarEntryRecord(eventID: entry.id, itemIdentifier: nil,
                                                  startDate: entry.metadata.startTime, endDate: entry.metadata.endTime))
            }
        case "off":
            access = .notDetermined
            preferences = DIPCalendarPreferences()
        case "denied":
            access = .denied
            preferences = DIPCalendarPreferences(showsConflicts: false, teaserDismissed: true)
        default: break
        }
        store.preferences = preferences
        let device = DIPFakeDeviceCalendar(access: access, items: items)
        return DIPCalendarModel(featureEnabled: true, store: store, device: device)
    }
    #endif
}
