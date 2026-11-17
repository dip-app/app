import DIPCore
import XCTest
@testable import DIP

/// The calendar model over the in-memory device calendar: Undo, reconciliation, adoption, revoke and sign-out.
@MainActor
final class CalendarModelTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_800_000_000)
    private let utc = TimeZone(secondsFromGMT: 0)!

    private func suite() -> UserDefaults {
        let name = "work.letsdip.tests.calendarmodel.\(UUID().uuidString)"
        addTeardownBlock { UserDefaults(suiteName: name)?.removePersistentDomain(forName: name) }
        return UserDefaults(suiteName: name)!
    }

    private func makeModel(items: [DIPCalendarItem] = [], defaults: UserDefaults? = nil)
        async -> (model: DIPCalendarModel, fake: DIPFakeDeviceCalendar, store: DIPCalendarLocalStore) {
        let fake = DIPFakeDeviceCalendar(items: items)
        let store = DIPCalendarLocalStore(uid: "u", defaults: defaults ?? suite())
        let model = DIPCalendarModel(featureEnabled: true, store: store, device: fake)
        await model.setShowsConflicts(true)
        return (model, fake, store)
    }

    private func metadata() -> DIPEventMetadata {
        .init(startTime: t0, endTime: t0.addingTimeInterval(3_600), venueName: "V", address: "A", locality: "L", costCents: 0, capacity: 5)
    }

    private func fields(_ id: String = "e1") -> DIPCalendarEventFields {
        metadata().calendarFields(title: "Paddle", description: "", eventID: id, timeZone: utc)
    }

    private func detail(_ id: String = "e1") -> DIPEventDetail {
        .init(id: id, title: "Paddle", image: .asset("x"), timing: "", description: "", tags: [], isJoined: false,
              attendeeAvatars: [], isPast: false, metadata: metadata())
    }

    private func foreign(_ title: String = "Dentist") -> DIPCalendarItem {
        .init(title: title, start: t0, end: t0.addingTimeInterval(3_600))
    }

    // MARK: Undo

    func testUndoRemovesOnlyDIPsOwnEntry() async throws {
        let (model, fake, _) = await makeModel(items: [foreign()])
        let result = await model.addDirectly(fields(), eventID: "e1")
        XCTAssertEqual(result, .added)
        XCTAssertEqual(fake.entries.count, 2)
        let removal = await model.removeEntry(eventID: "e1", fields: fields())
        XCTAssertEqual(removal, .removed)
        XCTAssertEqual(fake.entries.values.map { $0.item.title }, ["Dentist"], "the member's own entry is untouched")
        XCTAssertNil(model.record(for: "e1"))
    }

    func testUndoReportsFailureWhenTheEntryCannotBeRemoved() async throws {
        let (model, fake, store) = await makeModel(items: [foreign()])
        // A record pointing at an entry that is not DIP's (stale or reused identifier): the adapter refuses.
        let foreignID = try XCTUnwrap(fake.entries.keys.first)
        store.save(DIPCalendarEntryRecord(eventID: "e1", itemIdentifier: foreignID, startDate: t0, endDate: t0.addingTimeInterval(3_600)))
        let removal = await model.removeEntry(eventID: "e1", fields: fields())
        XCTAssertEqual(removal, .failed)
        XCTAssertNotNil(model.record(for: "e1"), "state is kept so the member can try again")
        XCTAssertEqual(fake.entries.count, 1, "the foreign entry survives")
    }

    func testUndoWhenTheMemberAlreadyDeletedItIsAlreadyGone() async {
        let (model, fake, _) = await makeModel()
        _ = await model.addDirectly(fields(), eventID: "e1")
        fake.delete(identifier: fake.entries.keys.first!)
        let removal = await model.removeEntry(eventID: "e1", fields: fields())
        XCTAssertEqual(removal, .alreadyGone)
        XCTAssertNil(model.record(for: "e1"))
    }

    func testUndoRetriesByShareLinkWhenTheIdentifierWentStale() async {
        let (model, fake, _) = await makeModel()
        _ = await model.addDirectly(fields(), eventID: "e1")
        // The calendar re-synced: same entry, new identifier.
        fake.delete(identifier: fake.entries.keys.first!)
        fake.insert(fields())
        let removal = await model.removeEntry(eventID: "e1", fields: fields())
        XCTAssertEqual(removal, .removed)
        XCTAssertTrue(fake.entries.isEmpty)
    }

    // MARK: Revoke and reads

    func testRevokeMidSessionStopsDeviceReads() async {
        let (model, fake, _) = await makeModel(items: [foreign()])
        let before = await model.conflicts(for: detail(), among: [])
        XCTAssertEqual(before.map(\.title), ["Dentist"])
        let readsBefore = fake.readWindows.count
        fake.revoke()
        model.refreshAccess()
        XCTAssertFalse(model.readsCalendar)
        let after = await model.conflicts(for: detail(), among: [])
        XCTAssertTrue(after.isEmpty)
        XCTAssertEqual(fake.readWindows.count, readsBefore, "no read after the revoke")
    }

    func testOwnEntryIsExcludedByIdentifierWhenItsURLWasEdited() async {
        let (model, fake, store) = await makeModel()
        var edited = fields()
        edited.url = nil
        let identifier = fake.insert(edited)
        store.save(DIPCalendarEntryRecord(eventID: "e1", itemIdentifier: identifier, startDate: t0, endDate: t0.addingTimeInterval(3_600)))
        let conflicts = await model.conflicts(for: detail(), among: [])
        XCTAssertTrue(conflicts.isEmpty)
    }

    // MARK: Adding

    func testAddingDirectlyTwiceAdoptsInsteadOfDuplicating() async {
        let (model, fake, _) = await makeModel()
        let first = await model.addDirectly(fields(), eventID: "e1")
        let second = await model.addDirectly(fields(), eventID: "e1")
        XCTAssertEqual([first, second], [.added, .added])
        XCTAssertEqual(fake.entries.count, 1)
    }

    func testAddingAfterTheRecordsWereWipedAdoptsTheEntryAlreadyInTheCalendar() async {
        let defaults = suite()
        let (model, fake, store) = await makeModel(defaults: defaults)
        _ = await model.addDirectly(fields(), eventID: "e1")
        // Reinstall or sign-out and back in: the local record is gone, the calendar entry is not.
        store.removeAll()
        XCTAssertNil(model.record(for: "e1"))
        await model.setShowsConflicts(true)
        let again = await model.addDirectly(fields(), eventID: "e1")
        XCTAssertEqual(again, .added)
        XCTAssertEqual(fake.entries.count, 1)
        XCTAssertNotNil(model.record(for: "e1")?.itemIdentifier)
    }

    // MARK: Reconcile

    func testReconcileForgetsAnEntryTheMemberDeleted() async {
        let (model, fake, _) = await makeModel()
        _ = await model.addDirectly(fields(), eventID: "e1")
        XCTAssertTrue(model.isAdded(eventID: "e1", fields: fields()))
        let kept = await model.reconcileEntry(eventID: "e1", fields: fields())
        XCTAssertTrue(kept)
        fake.delete(identifier: fake.entries.keys.first!)
        let afterDelete = await model.reconcileEntry(eventID: "e1", fields: fields())
        XCTAssertFalse(afterDelete)
        XCTAssertFalse(model.isAdded(eventID: "e1", fields: fields()), "the pill offers Add again")
    }

    func testReconcileAdoptsAnEditorSavedEntryAndLeavesFreshRecordsAlone() async {
        let (model, fake, store) = await makeModel()
        store.save(DIPCalendarEntryRecord(eventID: "e1", itemIdentifier: nil, startDate: t0, endDate: t0.addingTimeInterval(3_600), savedAt: Date()))
        // The editor has not shown the entry yet: a young record stays.
        let early = await model.reconcileEntry(eventID: "e1", fields: fields())
        XCTAssertFalse(early)
        XCTAssertNotNil(model.record(for: "e1"))
        // Once the entry is visible its identifier is adopted.
        let identifier = fake.insert(fields())
        let adopted = await model.reconcileEntry(eventID: "e1", fields: fields())
        XCTAssertTrue(adopted)
        XCTAssertEqual(model.record(for: "e1")?.itemIdentifier, identifier)
    }

    func testReconcileForgetsAnOldEditorRecordWhoseEntryIsGone() async {
        let (model, _, store) = await makeModel()
        store.save(DIPCalendarEntryRecord(eventID: "e1", itemIdentifier: nil, startDate: t0, endDate: t0.addingTimeInterval(3_600),
                                          savedAt: Date().addingTimeInterval(-600)))
        let kept = await model.reconcileEntry(eventID: "e1", fields: fields())
        XCTAssertFalse(kept)
        XCTAssertNil(model.record(for: "e1"))
    }

    // MARK: Sign-out

    func testInvalidateStopsRememberForgetAndReads() async {
        let (model, fake, store) = await makeModel(items: [foreign()])
        _ = await model.addDirectly(fields("e1"), eventID: "e1")
        model.invalidate()
        XCTAssertTrue(model.isInvalidated)
        XCTAssertFalse(model.readsCalendar)
        // Late results from before the sign-out cannot write or erase records.
        await model.markAddedThroughEditor(fields("e2"), eventID: "e2")
        XCTAssertNil(store.record(for: "e2"))
        model.forget("e1")
        XCTAssertNotNil(store.record(for: "e1"), "forget is a no-op after invalidate")
        let late = await model.addDirectly(fields("e3"), eventID: "e3")
        XCTAssertEqual(late, .failed("Calendar access is off."))
        let conflicts = await model.conflicts(for: detail("e4"), among: [])
        XCTAssertTrue(conflicts.isEmpty)
        XCTAssertEqual(fake.entries.count, 2)
    }

    func testInvalidateRunsTheTeardownOnce() {
        let model = DIPCalendarModel.disabled()
        var runs = 0
        model.teardown = { runs += 1 }
        model.invalidate()
        model.invalidate()
        XCTAssertEqual(runs, 1)
    }
}
