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
    /// Set by `invalidate()` (sign-out): in-flight work finishes quietly without reading, remembering or forgetting.
    private(set) var isInvalidated = false
    /// Releases what the composition wired to the model (the device observer); run once by `invalidate()`.
    @ObservationIgnored var teardown: (@MainActor () -> Void)?
    /// A record younger than this is never reconciled away: the system editor may still be saving the entry.
    @ObservationIgnored static let reconcileGrace: TimeInterval = 10

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
    var readsCalendar: Bool { !isInvalidated && featureEnabled && preferences.showsConflicts && access == .fullAccess }

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
    func calendarChanged() { guard !isInvalidated else { return }; revision += 1 }

    /// The member signed out (or the account changed): stop reading, drop the device observer and make every
    /// in-flight remember/forget a no-op, so a late result cannot write into the next account's records.
    func invalidate() {
        guard !isInvalidated else { return }
        isInvalidated = true
        teardown?()
        teardown = nil
        revision += 1
    }

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
        let ids = [event.id] + events.filter(\.isJoined).map(\.id)
        let own = DIPCalendarOverlap.ownEntryURLs(eventIDs: ids)
        let ownIdentifiers = ownEntryIdentifiers(eventIDs: ids)
        let fields = metadata.calendarFields(title: event.title, description: "", eventID: event.id)
        let deviceConflicts = await device.conflicts(
            start: fields.startDate, end: fields.endDate,
            rules: DIPCalendarConflictRules(treatsAllDayAsBusy: preferences.treatsAllDayAsBusy),
            excluding: own, excludingIdentifiers: ownIdentifiers)
        // The member may have signed out or turned conflicts off while the calendar was read.
        guard readsCalendar else { return dip }
        return DIPCalendarOverlap.merged(dip: dip, device: deviceConflicts)
    }

    /// Home: which of `candidates` overlap another joined DIP event (amber) or only the member's own calendar
    /// (grey), with ONE device read over their whole span.
    func homeOverlaps(_ candidates: [DIPEventDetail], among events: [DIPEventDetail], now: Date = Date()) async -> DIPCalendarOverlaps {
        let dip = Set(candidates.filter { !DIPCalendarOverlap.dipConflicts(for: $0, among: events, now: now).isEmpty }.map(\.id))
        var ids = Set<String>()
        guard readsCalendar, let device else { return DIPCalendarOverlaps(dip: dip) }
        let windows = candidates.compactMap { event -> (String, Date, Date)? in
            guard let fields = event.metadata?.calendarFields(title: event.title, description: "", eventID: event.id) else { return nil }
            return (event.id, fields.startDate, fields.endDate)
        }
        guard let start = windows.map(\.1).min(), let end = windows.map(\.2).max() else { return DIPCalendarOverlaps(dip: dip) }
        let index = DIPCalendarIndex(await device.items(start: start, end: end))
        guard readsCalendar else { return DIPCalendarOverlaps(dip: dip) }
        let allIDs = events.filter(\.isJoined).map(\.id) + candidates.map(\.id)
        let own = DIPCalendarOverlap.ownEntryURLs(eventIDs: allIDs)
        let ownIdentifiers = ownEntryIdentifiers(eventIDs: allIDs)
        let rules = DIPCalendarConflictRules(treatsAllDayAsBusy: preferences.treatsAllDayAsBusy)
        for (id, start, end) in windows
        where !index.conflicts(start: start, end: end, rules: rules, excluding: own, excludingIdentifiers: ownIdentifiers).isEmpty {
            ids.insert(id)
        }
        return DIPCalendarOverlaps(dip: dip, personal: ids)
    }

    // MARK: Entries DIP created

    func record(for eventID: String) -> DIPCalendarEntryRecord? {
        _ = recordsRevision
        return store?.record(for: eventID) ?? memoryRecords[eventID]
    }

    /// Calendar identifiers of the entries DIP created for these events, so they never conflict with themselves
    /// even when the member edited the entry's URL.
    func ownEntryIdentifiers(eventIDs: [String]) -> Set<String> {
        Set(eventIDs.compactMap { record(for: $0)?.itemIdentifier })
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

    /// Checks DIP's record against the calendar (full access only): an entry the member deleted in Calendar is
    /// forgotten, so the pill offers Add again instead of a stale "Added". An entry that moved identifiers is
    /// re-found by its share link. Returns true when the entry exists and DIP can remove it.
    @discardableResult func reconcileEntry(eventID: String, fields: DIPCalendarEventFields, now: Date = Date()) async -> Bool {
        guard !isInvalidated, let record = record(for: eventID), let device, access == .fullAccess else { return false }
        if let identifier = record.itemIdentifier, await device.entryExists(identifier: identifier) { return !isInvalidated }
        // The identifier is gone (or never known). Looking an entry up by its link scans the calendar, so only with opt-in.
        var found: String?
        if readsCalendar, let url = fields.url {
            found = await device.identifier(forURL: url, start: record.startDate, end: record.endDate)
        }
        guard !isInvalidated, self.record(for: eventID) == record else { return false }
        if let found {
            if found != record.itemIdentifier {
                var adopted = record
                adopted.itemIdentifier = found
                remember(adopted)
            }
            return true
        }
        if record.itemIdentifier != nil || readsCalendar {
            // Only an editor-saved record (no identifier yet) gets the grace: the store may not show that entry yet.
            let isFresh = record.itemIdentifier == nil && (record.savedAt.map { now.timeIntervalSince($0) < Self.reconcileGrace } ?? false)
            if !isFresh { forget(eventID) }
        }
        return false
    }

    /// Direct save (opted-in members). Callers use the system editor when `savesDirectly` is false and then
    /// call `markAddedThroughEditor`. An entry that already carries this event's share link (added before, then the
    /// app was reinstalled or the member signed out and in) is adopted instead of duplicated.
    func addDirectly(_ fields: DIPCalendarEventFields, eventID: String, now: Date = Date()) async -> DIPCalendarAddResult {
        guard savesDirectly, let device else { return .failed(String(localized: "calendar.error.accessOff", defaultValue: "Calendar access is off.", comment: "Error shown in an alert when adding an activity to the calendar but calendar access is off")) }
        func entry(_ identifier: String) -> DIPCalendarEntryRecord {
            DIPCalendarEntryRecord(eventID: eventID, itemIdentifier: identifier, startDate: fields.startDate, endDate: fields.endDate, savedAt: now)
        }
        if let known = record(for: eventID)?.itemIdentifier, await device.entryExists(identifier: known) {
            _ = try? await device.update(identifier: known, with: fields)
            remember(entry(known))
            return .added
        }
        if let url = fields.url, let existing = await device.identifier(forURL: url, start: fields.startDate, end: fields.endDate) {
            _ = try? await device.update(identifier: existing, with: fields)
            remember(entry(existing))
            return .added
        }
        do {
            let identifier = try await device.save(fields)
            remember(entry(identifier))
            return .added
        } catch DIPCalendarWriteError.noDefaultCalendar {
            return .failed(String(localized: "calendar.error.noDefault", defaultValue: "No calendar is set up for new events. Choose a default calendar in Settings > Calendar.", comment: "Error shown in an alert when the device has no default calendar for new events"))
        } catch {
            return .failed(String(localized: "calendar.error.saveFailed", defaultValue: "Couldn’t save to your calendar. Try again, or check calendar access in Settings.", comment: "Error shown in an alert when saving an activity to the calendar failed"))
        }
    }

    /// The system editor saved the entry. DIP cannot see it, but with full access it can re-find it by its URL; the
    /// editor can finish before the store shows the entry, so the lookup is retried once shortly after.
    func markAddedThroughEditor(_ fields: DIPCalendarEventFields, eventID: String, retryAfter: Duration = .milliseconds(500),
                                now: Date = Date()) async {
        let identifier = await findEditorEntry(fields)
        remember(DIPCalendarEntryRecord(eventID: eventID, itemIdentifier: identifier, startDate: fields.startDate,
                                        endDate: fields.endDate, savedAt: now))
        calendarChanged()
        guard identifier == nil, readsCalendar else { return }
        Task { [weak self] in
            try? await Task.sleep(for: retryAfter)
            guard let self, !isInvalidated, let late = await findEditorEntry(fields), var current = record(for: eventID),
                  current.itemIdentifier == nil else { return }
            current.itemIdentifier = late
            remember(current)
        }
    }

    private func findEditorEntry(_ fields: DIPCalendarEventFields) async -> String? {
        guard readsCalendar, let device, let url = fields.url else { return nil }
        return await device.identifier(forURL: url, start: fields.startDate, end: fields.endDate)
    }

    /// What `removeEntry` did.
    enum Removal: Equatable {
        /// DIP's entry was deleted.
        case removed
        /// Nothing to delete: the member already removed it (or there was no record). The record is cleared.
        case alreadyGone
        /// The entry could not be deleted; the record is kept so the member can try again or delete it in Calendar.
        case failed
    }

    /// Undo after a direct save, and "Remove from your calendar" after leaving. Only touches the entry DIP
    /// created (its stored identifier, or the entry carrying this event's share link).
    @discardableResult func removeEntry(eventID: String, fields: DIPCalendarEventFields) async -> Removal {
        guard let record = record(for: eventID) else { return .alreadyGone }
        guard let device, access == .fullAccess else {
            // Nothing DIP can delete right now. Without an identifier there is nothing to come back to either.
            if record.itemIdentifier == nil { forget(eventID) }
            return .failed
        }
        var identifier = record.itemIdentifier
        if identifier == nil, let url = fields.url {
            identifier = await device.identifier(forURL: url, start: record.startDate, end: record.endDate)
        }
        guard let identifier else { forget(eventID); return .alreadyGone }
        do {
            try await device.remove(identifier: identifier, eventID: eventID)
            forget(eventID)
            return .removed
        } catch DIPCalendarWriteError.notFound {
            // The identifier may be stale (the calendar re-synced): retry with the entry carrying the share link.
            if let url = fields.url,
               let current = await device.identifier(forURL: url, start: record.startDate, end: record.endDate), current != identifier {
                do {
                    try await device.remove(identifier: current, eventID: eventID)
                    forget(eventID)
                    return .removed
                } catch { return .failed }
            }
            // Still there but not DIP's to delete: keep the record. Gone: nothing left to remove.
            if await device.entryExists(identifier: identifier) { return .failed }
            forget(eventID)
            return .alreadyGone
        } catch {
            return .failed
        }
    }

    /// Cheap gate for "Remove from your calendar": DIP made an entry and may delete it. The screen confirms with
    /// `reconcileEntry` before offering it, so the option never promises a removal that cannot happen.
    func canRemoveEntry(eventID: String) -> Bool {
        guard !isInvalidated, access == .fullAccess, let record = record(for: eventID) else { return false }
        return readsCalendar || record.itemIdentifier != nil
    }

    /// Moves DIP's entry to the event's new times.
    @discardableResult func updateEntry(eventID: String, fields: DIPCalendarEventFields, now: Date = Date()) async -> Bool {
        guard readsCalendar, let device, let record = record(for: eventID) else { return false }
        var identifier = record.itemIdentifier
        if identifier == nil, let url = fields.url {
            identifier = await device.identifier(forURL: url, start: record.startDate, end: record.endDate)
        }
        guard let identifier, let updated = try? await device.update(identifier: identifier, with: fields) else { return false }
        remember(DIPCalendarEntryRecord(eventID: eventID, itemIdentifier: updated, startDate: fields.startDate,
                                        endDate: fields.endDate, savedAt: now))
        return true
    }

    /// Leaving without removing (or without access): forget the record so the pill offers Add again later.
    func forget(_ eventID: String) {
        guard !isInvalidated else { return }
        store?.removeRecord(for: eventID)
        memoryRecords[eventID] = nil
        recordsRevision += 1
    }

    private func remember(_ record: DIPCalendarEntryRecord) {
        guard !isInvalidated else { return }
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
        model.teardown = { [weak adapter] in adapter?.onChange = nil }
        return model
    }

    #if DEBUG
    /// The value of `--calendar-fake=<state>`, if present.
    nonisolated static func fakeState(_ arguments: [String] = ProcessInfo.processInfo.arguments) -> String? {
        let prefix = "--calendar-fake="
        return arguments.first(where: { $0.hasPrefix(prefix) }).map { String($0.dropFirst(prefix.count)) }
    }

    /// For the DIP-overlap states (`conflict`, `both`) the first upcoming event the member has not joined is moved to
    /// start 30 minutes into the first event the member has joined, so the event page shows another DIP event overlap.
    /// Other states return the snapshot unchanged.
    nonisolated static func alignedFixtures(_ snapshot: DIPAppSnapshot, state: String) -> DIPAppSnapshot {
        guard state == "conflict" || state == "both" else { return snapshot }
        var snapshot = snapshot
        let now = Date()
        let upcoming = snapshot.eventDetails.values
            .filter { $0.metadata.map { $0.startTime > now } ?? false }
            .sorted { ($0.metadata?.startTime ?? .distantFuture) < ($1.metadata?.startTime ?? .distantFuture) }
        guard let joined = upcoming.first(where: \.isJoined)?.metadata,
              let target = upcoming.first(where: { !$0.isJoined }), var metadata = target.metadata else { return snapshot }
        metadata.startTime = joined.startTime.addingTimeInterval(1_800)
        metadata.endTime = metadata.startTime.addingTimeInterval(5_400)
        var moved = target
        moved.metadata = metadata
        moved.timing = metadata.startTime.formatted(date: .abbreviated, time: .shortened)
        snapshot.eventDetails[target.id] = moved
        return snapshot
    }

    /// `--calendar-fake=<state>` builds an in-memory device calendar (never EventKit) for UI tests and captures.
    /// States: free, busy (personal calendar only, grey), busy-untitled (titles hidden, reads "Busy"), conflict (another
    /// joined DIP event, amber), both, added, off, denied. Returns nil without the argument.
    static func fake(uid: String, arguments: [String] = ProcessInfo.processInfo.arguments, now: Date = Date()) -> DIPCalendarModel? {
        guard let state = fakeState(arguments) else { return nil }
        // Fixture events start whole days from now; the fake entries straddle each upcoming start.
        let upcoming = alignedFixtures(DIPMockFixtures.v1Events(now: now), state: state).eventDetails.values
            .compactMap { event in event.metadata.map { (id: event.id, title: event.title, metadata: $0) } }
            .filter { $0.metadata.startTime > now }
            .sorted { $0.metadata.startTime < $1.metadata.startTime }
        let store = DIPCalendarLocalStore(uid: uid, defaults: UserDefaults(suiteName: "work.letsdip.calendar-fake") ?? .standard)
        store.removeAll()
        var access = DIPCalendarAccess.fullAccess
        var preferences = DIPCalendarPreferences(showsConflicts: true, teaserDismissed: true)
        var items: [DIPCalendarItem] = []
        var seeded: [(id: String, fields: DIPCalendarEventFields)] = []
        switch state {
        case "busy", "busy-untitled", "both":
            for (index, entry) in upcoming.enumerated() {
                let start = entry.metadata.startTime
                func item(_ title: String, _ availability: DIPCalendarItem.Availability) -> DIPCalendarItem {
                    DIPCalendarItem(title: state == "busy-untitled" ? "" : title, start: start.addingTimeInterval(-1_800),
                                    end: start.addingTimeInterval(1_800), availability: availability)
                }
                items.append(item(index == 0 ? "Team Lunch" : "Focus time", .busy))
            }
        case "added":
            // Every upcoming fixture event is already in the calendar (dictionary order is not stable).
            // The fake calendar holds the entries too, so reconciliation keeps them.
            for entry in upcoming {
                seeded.append((entry.id, entry.metadata.calendarFields(title: entry.title, description: "", eventID: entry.id)))
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
        for entry in seeded {
            let identifier = device.insert(entry.fields)
            store.save(DIPCalendarEntryRecord(eventID: entry.id, itemIdentifier: identifier,
                                              startDate: entry.fields.startDate, endDate: entry.fields.endDate))
        }
        return DIPCalendarModel(featureEnabled: true, store: store, device: device)
    }
    #endif
}
