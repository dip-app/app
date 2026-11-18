import DIPCore
import Foundation
import XCTest

final class CalendarConflictsTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_800_000_000)
    private let utc = TimeZone(secondsFromGMT: 0)!
    private let posix = Locale(identifier: "en_US_POSIX")

    private func at(_ minutes: Double) -> Date { t0.addingTimeInterval(minutes * 60) }

    private func item(_ title: String, _ s: Double, _ e: Double, allDay: Bool = false,
                      availability: DIPCalendarItem.Availability = .busy, declined: Bool = false,
                      canceled: Bool = false, url: URL? = nil) -> DIPCalendarItem {
        .init(title: title, start: at(s), end: at(e), isAllDay: allDay, availability: availability,
              isDeclined: declined, isCanceled: canceled, url: url)
    }

    private func conflict(_ title: String, _ s: Double, _ e: Double, soft: Bool = false,
                          source: DIPCalendarConflict.Source = .device) -> DIPCalendarConflict {
        .init(title: title, start: at(s), end: at(e), isSoft: soft, source: source)
    }

    private func metadata(_ s: Double, _ e: Double, status: DIPEventStatus = .scheduled) -> DIPEventMetadata {
        .init(startTime: at(s), endTime: at(e), venueName: "V", address: "A", locality: "L", costCents: 0, capacity: 10, status: status)
    }

    private func detail(_ id: String, _ title: String = "T", joined: Bool = true, past: Bool = false,
                        metadata: DIPEventMetadata?) -> DIPEventDetail {
        .init(id: id, title: title, image: .asset("x"), timing: "", description: "", tags: [], isJoined: joined,
              attendeeAvatars: [], isPast: past, metadata: metadata)
    }

    // MARK: overlaps

    func testOverlapsAdjacentIsNotAConflict() {
        XCTAssertFalse(DIPCalendarOverlap.overlaps(at(0), at(60), at(60), at(120)))
        XCTAssertFalse(DIPCalendarOverlap.overlaps(at(60), at(120), at(0), at(60)))
    }

    func testOverlapsNestedPartialIdenticalAndMultiDay() {
        XCTAssertTrue(DIPCalendarOverlap.overlaps(at(0), at(120), at(30), at(60)))
        XCTAssertTrue(DIPCalendarOverlap.overlaps(at(30), at(60), at(0), at(120)))
        XCTAssertTrue(DIPCalendarOverlap.overlaps(at(0), at(60), at(30), at(90)))
        XCTAssertTrue(DIPCalendarOverlap.overlaps(at(30), at(90), at(0), at(60)))
        XCTAssertTrue(DIPCalendarOverlap.overlaps(at(0), at(60), at(0), at(60)))
        XCTAssertTrue(DIPCalendarOverlap.overlaps(at(0), at(3 * 1_440), at(1_440 + 10), at(1_440 + 20)))
        XCTAssertFalse(DIPCalendarOverlap.overlaps(at(0), at(1_440), at(2 * 1_440), at(3 * 1_440)))
    }

    func testOverlapsZeroLengthEntries() {
        // Inside and at the start edge: counts. At the end edge (half-open): does not.
        XCTAssertTrue(DIPCalendarOverlap.overlaps(at(0), at(60), at(30), at(30)))
        XCTAssertTrue(DIPCalendarOverlap.overlaps(at(0), at(60), at(0), at(0)))
        XCTAssertFalse(DIPCalendarOverlap.overlaps(at(0), at(60), at(60), at(60)))
        XCTAssertFalse(DIPCalendarOverlap.overlaps(at(0), at(60), at(-1), at(-1)))
        // Symmetric when the first interval is the zero-length one.
        XCTAssertTrue(DIPCalendarOverlap.overlaps(at(30), at(30), at(0), at(60)))
        XCTAssertFalse(DIPCalendarOverlap.overlaps(at(60), at(60), at(0), at(60)))
        // An inverted end is treated as zero length.
        XCTAssertTrue(DIPCalendarOverlap.overlaps(at(0), at(60), at(30), at(10)))
    }

    // MARK: conflicts(start:end:items:rules:excluding:)

    func testConflictsIgnoreCanceledDeclinedAndFree() {
        let items = [
            item("canceled", 0, 60, canceled: true),
            item("declined", 0, 60, declined: true),
            item("free", 0, 60, availability: .free),
            item("busy", 0, 60),
        ]
        let result = DIPCalendarOverlap.conflicts(start: at(10), end: at(50), items: items)
        XCTAssertEqual(result.map(\.title), ["busy"])
        XCTAssertEqual(result.first?.source, .device)
        XCTAssertEqual(result.first?.isSoft, false)
    }

    func testAllDayIgnoredByDefaultAndCountedWhenTreatedAsBusy() {
        let items = [item("Holiday", 0, 1_440, allDay: true)]
        XCTAssertTrue(DIPCalendarOverlap.conflicts(start: at(10), end: at(50), items: items).isEmpty)
        XCTAssertEqual(DIPCalendarOverlap.conflicts(start: at(10), end: at(50), items: items,
                                                    rules: .init(treatsAllDayAsBusy: true)).map(\.title), ["Holiday"])
    }

    func testTentativeIsSoft() {
        let result = DIPCalendarOverlap.conflicts(start: at(0), end: at(60), items: [item("Maybe", 10, 20, availability: .tentative)])
        XCTAssertEqual(result.map(\.isSoft), [true])
    }

    func testExcludedURLIsIgnored() throws {
        let own = try XCTUnwrap(DIPShareLink.url(forEventID: "evt1"))
        let other = try XCTUnwrap(DIPShareLink.url(forEventID: "evt2"))
        let items = [item("Mine", 0, 60, url: own), item("Other event", 0, 60, url: other), item("Plain", 0, 60)]
        let result = DIPCalendarOverlap.conflicts(start: at(0), end: at(60), items: items, excluding: [own])
        XCTAssertEqual(Set(result.map(\.title)), ["Other event", "Plain"])
    }

    func testConflictsSortedByStartThenHardBeforeSoftThenTitle() {
        let items = [
            item("Zulu", 10, 40),
            item("Soft early", 0, 40, availability: .tentative),
            item("Beta", 10, 40),
            item("Alpha soft", 10, 40, availability: .tentative),
            item("Alpha", 10, 40),
        ]
        let result = DIPCalendarOverlap.conflicts(start: at(0), end: at(60), items: items)
        XCTAssertEqual(result.map(\.title), ["Soft early", "Alpha", "Beta", "Zulu", "Alpha soft"])
    }

    func testTitleOrderIsNaturalNumeric() {
        let items = [item("Room 10", 0, 30), item("Room 2", 0, 30)]
        XCTAssertEqual(DIPCalendarOverlap.conflicts(start: at(0), end: at(60), items: items).map(\.title), ["Room 2", "Room 10"])
    }

    // MARK: dipConflicts

    func testDipConflictsOnlyJoinedScheduledFutureOtherOverlapping() {
        let now = at(-60)
        let me = detail("me", metadata: metadata(0, 60))
        let ok = detail("ok", "Overlapping", metadata: metadata(30, 90))
        let result = DIPCalendarOverlap.dipConflicts(for: me, among: [
            me,
            ok,
            detail("notJoined", joined: false, metadata: metadata(30, 90)),
            detail("past", past: true, metadata: metadata(30, 90)),
            detail("noMeta", metadata: nil),
            detail("adjacent", metadata: metadata(60, 120)),
            detail("elsewhere", metadata: metadata(300, 360)),
            detail("cancelled", metadata: metadata(30, 90, status: .cancelled)),
            detail("completed", metadata: metadata(30, 90, status: .completed)),
        ], now: now)
        XCTAssertEqual(result, [DIPCalendarConflict(title: "Overlapping", start: at(30), end: at(90), source: .dip(eventID: "ok"))])
    }

    func testDipConflictsIgnoresEventsThatAlreadyEnded() {
        let me = detail("me", metadata: metadata(0, 60))
        let ended = detail("ended", metadata: metadata(10, 20))
        XCTAssertTrue(DIPCalendarOverlap.dipConflicts(for: me, among: [ended], now: at(30)).isEmpty)
    }

    func testDipConflictsUsesOneHourDefaultWhenEndNotAfterStart() {
        // Mine ends at its start, so it spans 0..<60 by default; theirs 30..<(30 + 60) the same way.
        let me = detail("me", metadata: metadata(0, 0))
        let their = detail("their", "Theirs", metadata: metadata(30, 10))
        let result = DIPCalendarOverlap.dipConflicts(for: me, among: [their], now: at(-1))
        XCTAssertEqual(result.map(\.end), [at(90)])
        let after = detail("after", metadata: metadata(60, 60))
        XCTAssertTrue(DIPCalendarOverlap.dipConflicts(for: me, among: [after], now: at(-1)).isEmpty)
    }

    func testDipConflictsEventWithoutMetadataHasNone() {
        let me = detail("me", metadata: nil)
        XCTAssertTrue(DIPCalendarOverlap.dipConflicts(for: me, among: [detail("a", metadata: metadata(0, 60))], now: at(-1)).isEmpty)
    }

    func testDipConflictsSorted() {
        let me = detail("me", metadata: metadata(0, 240))
        let result = DIPCalendarOverlap.dipConflicts(for: me, among: [
            detail("b", "B", metadata: metadata(60, 90)), detail("a", "A", metadata: metadata(30, 90)),
        ], now: at(-1))
        XCTAssertEqual(result.map(\.title), ["A", "B"])
    }

    // MARK: merged / ownEntryURLs

    func testMergedDropsDeviceCopiesOfDipEventsAndSorts() {
        let dip = [conflict("Kayaking", 60, 120, source: .dip(eventID: "k"))]
        let device = [
            conflict("Kayaking", 60, 120),
            conflict("Kayaking", 60, 130),
            conflict("Dentist", 0, 30),
        ]
        let merged = DIPCalendarOverlap.merged(dip: dip, device: device)
        XCTAssertEqual(merged.map(\.title), ["Dentist", "Kayaking", "Kayaking"])
        XCTAssertEqual(merged[1].source, .dip(eventID: "k"))
        XCTAssertEqual(merged[2].end, at(130))
        XCTAssertEqual(DIPCalendarOverlap.merged(dip: [], device: []), [])
    }

    func testOwnEntryURLsAreShareLinks() {
        let urls = DIPCalendarOverlap.ownEntryURLs(eventIDs: ["abc", "def", "bad/id", ""])
        XCTAssertEqual(urls, [URL(string: "https://letsdip.work/e/abc")!, URL(string: "https://letsdip.work/e/def")!])
        XCTAssertTrue(DIPCalendarOverlap.ownEntryURLs(eventIDs: []).isEmpty)
    }

    // MARK: index

    private struct SeededGenerator {
        var state: UInt64
        mutating func next() -> UInt64 {
            state = state &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
            return state >> 33
        }
        mutating func int(_ range: ClosedRange<Int>) -> Int { range.lowerBound + Int(next() % UInt64(range.count)) }
    }

    func testIndexMatchesBruteForce() {
        var rng = SeededGenerator(state: 42)
        var items: [DIPCalendarItem] = []
        for i in 0..<300 {
            let start = Double(rng.int(0...20_000))
            let length = Double(rng.int(0...3) == 0 ? 0 : rng.int(5...240))
            let availability: DIPCalendarItem.Availability = [.busy, .busy, .tentative, .free][rng.int(0...3)]
            items.append(item("Item \(i)", start, start + length, allDay: rng.int(0...9) == 0, availability: availability,
                              declined: rng.int(0...14) == 0, canceled: rng.int(0...14) == 0))
        }
        // A long entry that started well before the window, and a multi-day one.
        items.append(item("Long haul", -10_000, 10_000))
        items.append(item("Conference", 5_000, 5_000 + 3 * 1_440))
        let index = DIPCalendarIndex(items)
        XCTAssertEqual(index.items.count, items.count)
        XCTAssertEqual(index.items.map(\.start), index.items.map(\.start).sorted())

        for rules in [DIPCalendarConflictRules(), .init(treatsAllDayAsBusy: true)] {
            for _ in 0..<60 {
                let start = Double(rng.int(-500...20_500))
                let end = start + Double(rng.int(0...600))
                let expected = DIPCalendarOverlap.conflicts(start: at(start), end: at(end), items: items, rules: rules)
                let actual = index.conflicts(start: at(start), end: at(end), rules: rules)
                XCTAssertEqual(actual, expected, "window \(start)..<\(end)")
            }
        }
        // Candidates include the long entry for a window deep inside it, and are a superset of the brute-force overlaps.
        XCTAssertTrue(index.candidates(start: at(9_000), end: at(9_030)).contains { $0.title == "Long haul" })
        let brute = items.filter { DIPCalendarOverlap.overlaps(at(5_100), at(5_200), $0.start, $0.end) }
        XCTAssertEqual(Set(index.candidates(start: at(5_100), end: at(5_200)).map(\.title)), Set(brute.map(\.title)))
    }

    func testIndexEmptyAndExcluding() throws {
        XCTAssertTrue(DIPCalendarIndex([]).conflicts(start: at(0), end: at(60)).isEmpty)
        let own = try XCTUnwrap(DIPShareLink.url(forEventID: "x"))
        let index = DIPCalendarIndex([item("Mine", 0, 60, url: own), item("Other", 0, 60)])
        XCTAssertEqual(index.conflicts(start: at(0), end: at(60), excluding: [own]).map(\.title), ["Other"])
    }

    // MARK: overlap text

    func testOverlapTitleByCount() {
        let c = (0..<5).map { conflict(["A", "B", "C", "D", "E"][$0], 0, 60) }
        XCTAssertEqual(DIPCalendarOverlapText.title([]), "")
        XCTAssertEqual(DIPCalendarOverlapText.title(Array(c.prefix(1))), "Overlaps with A")
        XCTAssertEqual(DIPCalendarOverlapText.title(Array(c.prefix(2))), "Overlaps with A and B")
        XCTAssertEqual(DIPCalendarOverlapText.title(Array(c.prefix(3))), "Overlaps with A, B and 1 more")
        XCTAssertEqual(DIPCalendarOverlapText.title(c), "Overlaps with A, B and 3 more")
        XCTAssertEqual(DIPCalendarOverlapText.names([]), "")
    }

    func testOverlapTitleSoftAndBlank() {
        XCTAssertEqual(DIPCalendarOverlapText.title([conflict("A", 0, 60, soft: true), conflict("B", 0, 60, soft: true)]), "May overlap with A and B")
        XCTAssertEqual(DIPCalendarOverlapText.title([conflict("A", 0, 60, soft: true), conflict("B", 0, 60)]), "Overlaps with A and B")
        XCTAssertEqual(DIPCalendarOverlapText.title([conflict("", 0, 60)]), "Overlaps with a busy time")
        XCTAssertEqual(DIPCalendarOverlapText.title([conflict("   \n", 0, 60)]), "Overlaps with a busy time")
        XCTAssertEqual(DIPCalendarOverlapText.title([conflict("  Padded  ", 0, 60)]), "Overlaps with Padded")
    }

    func testMessageLinesTimesTentativeAndMore() {
        let one = DIPCalendarOverlapText.message([conflict("Standup", 0, 30)], locale: posix, timeZone: utc)
        // One conflict: the alert title already names it, so the body is the time only.
        XCTAssertFalse(one.contains("Standup"), one)
        XCTAssertFalse(one.contains("tentative"))
        XCTAssertFalse(one.contains("\n"))
        // 1_800_000_000 is 2027-01-15 08:00:00 UTC; the formatted range names the start and end hours.
        XCTAssertTrue(one.contains("8:00") && one.contains("8:30"), one)

        let soft = DIPCalendarOverlapText.message([conflict("Maybe", 0, 30, soft: true), conflict("", 0, 30)], locale: posix, timeZone: utc)
        let lines = soft.components(separatedBy: "\n")
        XCTAssertEqual(lines.count, 2)
        XCTAssertTrue(lines[0].hasPrefix("Maybe: ") && lines[0].hasSuffix(" (tentative)"), soft)
        XCTAssertTrue(lines[1].hasPrefix("a busy time: "), soft)

        let many = (0..<5).map { conflict("E\($0)", 0, 30) }
        let text = DIPCalendarOverlapText.message(many, locale: posix, timeZone: utc).components(separatedBy: "\n")
        XCTAssertEqual(text.count, 4)
        XCTAssertEqual(text.last, "and 2 more")
        XCTAssertEqual(DIPCalendarOverlapText.message([], locale: posix, timeZone: utc), "")

        // The zone is honored: three hours ahead shows 11:00.
        let shifted = DIPCalendarOverlapText.message([conflict("Standup", 0, 30)], locale: posix, timeZone: TimeZone(secondsFromGMT: 3 * 3_600)!)
        XCTAssertTrue(shifted.contains("11:00"), shifted)
    }

    // MARK: pill state

    func testPillResolveEveryState() {
        let c = [conflict("A", 0, 60, source: .dip(eventID: "x"))]
        func resolve(canAdd: Bool = true, added: Bool = false, adding: Bool = false, direct: Bool = false,
                     conflicts: [DIPCalendarConflict] = []) -> DIPCalendarPillState {
            .resolve(canAdd: canAdd, isAdded: added, isAdding: adding, direct: direct, conflicts: conflicts)
        }
        XCTAssertEqual(resolve(canAdd: false, added: true, conflicts: c), .hidden)
        XCTAssertEqual(resolve(added: true, adding: true, conflicts: c), .added)
        XCTAssertEqual(resolve(adding: true, conflicts: c), .adding)
        XCTAssertEqual(resolve(), .free(direct: false))
        XCTAssertEqual(resolve(direct: true), .free(direct: true))
        XCTAssertEqual(resolve(direct: true, conflicts: c), .conflict(c, direct: true))
        XCTAssertEqual(resolve(conflicts: c), .conflict(c, direct: false))
    }

    func testPillEnabledAndAccessibilityLabels() {
        let c = [conflict("Dentist", 0, 60, source: .dip(eventID: "x"))]
        XCTAssertFalse(DIPCalendarPillState.hidden.isEnabled)
        XCTAssertTrue(DIPCalendarPillState.free(direct: true).isEnabled)
        XCTAssertTrue(DIPCalendarPillState.conflict(c, direct: false).isEnabled)
        XCTAssertFalse(DIPCalendarPillState.adding.isEnabled)
        XCTAssertFalse(DIPCalendarPillState.added.isEnabled)

        XCTAssertEqual(DIPCalendarPillState.hidden.accessibilityLabel, "")
        XCTAssertEqual(DIPCalendarPillState.free(direct: false).accessibilityLabel, "Add to calendar")
        XCTAssertEqual(DIPCalendarPillState.free(direct: true).accessibilityLabel, "Add to calendar")
        XCTAssertEqual(DIPCalendarPillState.conflict(c, direct: false).accessibilityLabel, "Add to calendar. Overlaps with Dentist")
        XCTAssertEqual(DIPCalendarPillState.adding.accessibilityLabel, "Adding to calendar")
        XCTAssertEqual(DIPCalendarPillState.added.accessibilityLabel, "Added to your calendar")
    }

    // MARK: fit

    func testPrioritizedKeepsStableOrderAndNeverDrops() {
        let ids = ["a", "b", "c", "d", "e"]
        let result = DIPCalendarFit.prioritized(ids, id: { $0 }, conflicted: ["a", "c"])
        XCTAssertEqual(result, ["b", "d", "e", "a", "c"])
        XCTAssertEqual(Set(result), Set(ids))
        XCTAssertEqual(DIPCalendarFit.prioritized(ids, id: { $0 }, conflicted: []), ids)
        XCTAssertEqual(DIPCalendarFit.prioritized(ids, id: { $0 }, conflicted: Set(ids)), ids)
        XCTAssertEqual(DIPCalendarFit.prioritized(ids, id: { $0 }, conflicted: ["zzz"]), ids)
        XCTAssertEqual(DIPCalendarFit.prioritized([String](), id: { $0 }, conflicted: ["a"]), [])
    }

    // MARK: entry record

    func testEntryRecordIsOutdated() {
        let fields = metadata(0, 60).calendarFields(title: "T", description: "", timeZone: utc)
        let record = DIPCalendarEntryRecord(eventID: "e", itemIdentifier: "id", startDate: at(0), endDate: at(60))
        XCTAssertFalse(record.isOutdated(for: fields))
        var moved = record; moved.startDate = at(5)
        XCTAssertTrue(moved.isOutdated(for: fields))
        var longer = record; longer.endDate = at(90)
        XCTAssertTrue(longer.isOutdated(for: fields))
    }

    // MARK: share-link entry URL (eventID parameter)

    func testCalendarFieldsEventIDUsesShareLinkAndKeepsVenueInLocation() {
        let fields = metadata(0, 60).calendarFields(title: "T", description: "", eventID: "evt42", timeZone: utc)
        XCTAssertEqual(fields.url, URL(string: "https://letsdip.work/e/evt42"))
        XCTAssertEqual(fields.location, "V, A, L")
        // Without an id, or with an unusable one, the maps URL is kept.
        let maps = metadata(0, 60).mapsURL
        XCTAssertNotNil(maps)
        XCTAssertEqual(metadata(0, 60).calendarFields(title: "T", description: "", timeZone: utc).url, maps)
        XCTAssertEqual(metadata(0, 60).calendarFields(title: "T", description: "", eventID: "a/b", timeZone: utc).url, maps)
    }

    // MARK: local store

    private var suites: [String] = []

    private func makeDefaults() -> UserDefaults {
        let name = "dip.tests.calendar.\(UUID().uuidString)"
        suites.append(name)
        return UserDefaults(suiteName: name)!
    }

    override func tearDown() {
        for name in suites { UserDefaults().removePersistentDomain(forName: name) }
        suites = []
        super.tearDown()
    }

    func testStoreDefaultsAndKeyFormat() {
        let defaults = makeDefaults()
        let store = DIPCalendarLocalStore(uid: "u1", defaults: defaults)
        XCTAssertEqual(store.preferences, DIPCalendarPreferences())
        XCTAssertFalse(store.preferences.showsConflicts)
        XCTAssertFalse(store.preferences.teaserDismissed)
        XCTAssertFalse(store.preferences.treatsAllDayAsBusy)
        XCTAssertNil(store.record(for: "e"))
        XCTAssertEqual(DIPCalendarLocalStore.key(for: "u1"), "dip.calendar.v1.u1")
        XCTAssertNil(defaults.data(forKey: "dip.calendar.v1.u1"), "reading must not write")
        store.preferences.showsConflicts = true
        XCTAssertNotNil(defaults.data(forKey: "dip.calendar.v1.u1"))
    }

    func testStorePersistsPerUidAndAcrossInstances() {
        let defaults = makeDefaults()
        let a = DIPCalendarLocalStore(uid: "a", defaults: defaults)
        let b = DIPCalendarLocalStore(uid: "b", defaults: defaults)
        a.preferences = .init(showsConflicts: true, teaserDismissed: true, treatsAllDayAsBusy: true)
        let record = DIPCalendarEntryRecord(eventID: "e1", itemIdentifier: "x", startDate: at(0), endDate: at(60))
        a.save(record)
        XCTAssertEqual(DIPCalendarLocalStore(uid: "a", defaults: defaults).preferences,
                       .init(showsConflicts: true, teaserDismissed: true, treatsAllDayAsBusy: true))
        XCTAssertEqual(DIPCalendarLocalStore(uid: "a", defaults: defaults).record(for: "e1"), record)
        XCTAssertEqual(b.preferences, DIPCalendarPreferences())
        XCTAssertNil(b.record(for: "e1"))
    }

    func testStoreSaveReplaceRemoveAndRemoveAll() {
        let defaults = makeDefaults()
        let store = DIPCalendarLocalStore(uid: "u", defaults: defaults)
        let other = DIPCalendarLocalStore(uid: "v", defaults: defaults)
        other.preferences.showsConflicts = true
        store.preferences.showsConflicts = true
        store.save(.init(eventID: "e1", itemIdentifier: nil, startDate: at(0), endDate: at(60)))
        store.save(.init(eventID: "e2", itemIdentifier: "id2", startDate: at(10), endDate: at(70)))
        store.save(.init(eventID: "e1", itemIdentifier: "new", startDate: at(5), endDate: at(65)))
        XCTAssertEqual(store.record(for: "e1")?.itemIdentifier, "new")
        XCTAssertEqual(store.record(for: "e2")?.itemIdentifier, "id2")
        store.removeRecord(for: "e1")
        XCTAssertNil(store.record(for: "e1"))
        XCTAssertNotNil(store.record(for: "e2"))
        XCTAssertTrue(store.preferences.showsConflicts, "removing a record keeps preferences")
        store.removeAll()
        XCTAssertNil(defaults.data(forKey: DIPCalendarLocalStore.key(for: "u")))
        XCTAssertEqual(store.preferences, DIPCalendarPreferences())
        XCTAssertNil(store.record(for: "e2"))
        XCTAssertTrue(other.preferences.showsConflicts, "other uids are untouched")
    }

    func testStoreIgnoresCorruptData() {
        let defaults = makeDefaults()
        defaults.set(Data("not json".utf8), forKey: DIPCalendarLocalStore.key(for: "u"))
        let store = DIPCalendarLocalStore(uid: "u", defaults: defaults)
        XCTAssertEqual(store.preferences, DIPCalendarPreferences())
        store.preferences.showsConflicts = true
        XCTAssertTrue(DIPCalendarLocalStore(uid: "u", defaults: defaults).preferences.showsConflicts)
    }
}

@MainActor
final class FakeDeviceCalendarTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_800_000_000)
    private func at(_ minutes: Double) -> Date { t0.addingTimeInterval(minutes * 60) }
    private func item(_ title: String, _ s: Double, _ e: Double, url: URL? = nil) -> DIPCalendarItem {
        .init(title: title, start: at(s), end: at(e), url: url)
    }
    private func fields(_ title: String = "DIP", _ s: Double = 0, _ e: Double = 60, url: URL? = nil) -> DIPCalendarEventFields {
        let meta = DIPEventMetadata(startTime: at(s), endTime: at(e), venueName: "", address: "", locality: "", costCents: 0, capacity: 1)
        var result = meta.calendarFields(title: title, description: "", timeZone: TimeZone(secondsFromGMT: 0)!)
        result.url = url
        return result
    }

    func testReadsEmptyUnlessFullAccess() async {
        for access in [DIPCalendarAccess.notDetermined, .denied, .restricted, .writeOnly] {
            let fake = DIPFakeDeviceCalendar(access: access, items: [item("Busy", 0, 60)])
            let items = await fake.items(start: at(0), end: at(60))
            let conflicts = await fake.conflicts(start: at(0), end: at(60), rules: .init(), excluding: [])
            XCTAssertTrue(items.isEmpty, "\(access)")
            XCTAssertTrue(conflicts.isEmpty, "\(access)")
            XCTAssertTrue(fake.readWindows.isEmpty, "\(access)")
        }
        let full = DIPFakeDeviceCalendar(items: [item("Busy", 0, 60)])
        let items = await full.items(start: at(0), end: at(60))
        let conflicts = await full.conflicts(start: at(30), end: at(90), rules: .init(), excluding: [])
        XCTAssertEqual(items.map(\.title), ["Busy"])
        XCTAssertEqual(conflicts.map(\.title), ["Busy"])
    }

    func testRequestFullAccessFlipsOnlyFromNotDetermined() async {
        let fake = DIPFakeDeviceCalendar(access: .notDetermined, grantOnRequest: .fullAccess)
        let granted = await fake.requestFullAccess()
        XCTAssertEqual(granted, .fullAccess)
        XCTAssertEqual(fake.access, .fullAccess)
        XCTAssertEqual(fake.requestCount, 1)

        let denying = DIPFakeDeviceCalendar(access: .notDetermined, grantOnRequest: .denied)
        let denied = await denying.requestFullAccess()
        XCTAssertEqual(denied, .denied)

        let already = DIPFakeDeviceCalendar(access: .denied, grantOnRequest: .fullAccess)
        let stays = await already.requestFullAccess()
        XCTAssertEqual(stays, .denied, "a prior denial is not re-asked")
        XCTAssertEqual(already.requestCount, 1)
    }

    func testSaveUpdateRemoveAndIdentifierForURL() async throws {
        let fake = DIPFakeDeviceCalendar()
        let url = try XCTUnwrap(DIPShareLink.url(forEventID: "e1"))
        let id = try await fake.save(fields(url: url))
        var found = await fake.identifier(forURL: url, start: at(0), end: at(60))
        XCTAssertEqual(found, id)
        let outside = await fake.identifier(forURL: url, start: at(600), end: at(660))
        XCTAssertNil(outside)
        let otherURL = try XCTUnwrap(DIPShareLink.url(forEventID: "e2"))
        let none = await fake.identifier(forURL: otherURL, start: at(0), end: at(60))
        XCTAssertNil(none)

        let updated = try await fake.update(identifier: id, with: fields(url: url).moved(to: at(120), end: at(180)))
        XCTAssertEqual(updated, id)
        found = await fake.identifier(forURL: url, start: at(120), end: at(180))
        XCTAssertEqual(found, id)
        let oldWindow = await fake.items(start: at(0), end: at(60))
        XCTAssertTrue(oldWindow.isEmpty)

        try await fake.remove(identifier: id)
        let afterRemove = await fake.items(start: at(0), end: at(600))
        XCTAssertTrue(afterRemove.isEmpty)
        let missing = await fake.identifier(forURL: url, start: at(0), end: at(600))
        XCTAssertNil(missing)
    }

    func testNeverTouchesEntriesDIPDidNotCreate() async throws {
        let fake = DIPFakeDeviceCalendar(items: [item("Dentist", 0, 60)])
        let foreign = try XCTUnwrap(fake.entries.keys.first)
        do { _ = try await fake.update(identifier: foreign, with: fields()); XCTFail("expected notFound") }
        catch { XCTAssertEqual(error as? DIPCalendarWriteError, .notFound) }
        do { try await fake.remove(identifier: foreign); XCTFail("expected notFound") }
        catch { XCTAssertEqual(error as? DIPCalendarWriteError, .notFound) }
        do { _ = try await fake.update(identifier: "unknown", with: fields()); XCTFail("expected notFound") }
        catch { XCTAssertEqual(error as? DIPCalendarWriteError, .notFound) }
        let items = await fake.items(start: at(0), end: at(60))
        XCTAssertEqual(items.map(\.title), ["Dentist"], "the foreign entry is unchanged")
    }

    func testWritesNeedAccess() async throws {
        let none = DIPFakeDeviceCalendar(access: .denied)
        do { _ = try await none.save(fields()); XCTFail("expected noAccess") }
        catch { XCTAssertEqual(error as? DIPCalendarWriteError, .noAccess) }
        // Write-only access can save but not update, remove or look up.
        let writeOnly = DIPFakeDeviceCalendar(access: .writeOnly)
        let id = try await writeOnly.save(fields())
        do { _ = try await writeOnly.update(identifier: id, with: fields()); XCTFail("expected noAccess") }
        catch { XCTAssertEqual(error as? DIPCalendarWriteError, .noAccess) }
        do { try await writeOnly.remove(identifier: id); XCTFail("expected noAccess") }
        catch { XCTAssertEqual(error as? DIPCalendarWriteError, .noAccess) }
    }

    func testRevokeStopsReads() async throws {
        let fake = DIPFakeDeviceCalendar(items: [item("Busy", 0, 60)])
        let before = await fake.items(start: at(0), end: at(60))
        XCTAssertEqual(before.count, 1)
        fake.revoke()
        XCTAssertEqual(fake.access, .denied)
        let after = await fake.items(start: at(0), end: at(60))
        let conflicts = await fake.conflicts(start: at(0), end: at(60), rules: .init(), excluding: [])
        XCTAssertTrue(after.isEmpty)
        XCTAssertTrue(conflicts.isEmpty)
        do { _ = try await fake.save(fields()); XCTFail("expected noAccess") }
        catch { XCTAssertEqual(error as? DIPCalendarWriteError, .noAccess) }
    }

    func testReadsOnlyTheRequestedWindow() async {
        let fake = DIPFakeDeviceCalendar(items: [item("In", 0, 60), item("Out", 1_000, 1_060)])
        let items = await fake.items(start: at(30), end: at(90))
        XCTAssertEqual(items.map(\.title), ["In"])
        _ = await fake.conflicts(start: at(1_010), end: at(1_020), rules: .init(), excluding: [])
        XCTAssertEqual(fake.readWindows.count, 2)
        XCTAssertEqual(fake.readWindows[0].start, at(30))
        XCTAssertEqual(fake.readWindows[0].end, at(90))
        XCTAssertEqual(fake.readWindows[1].start, at(1_010))
        XCTAssertEqual(fake.readWindows[1].end, at(1_020))
    }
}

private extension DIPCalendarEventFields {
    func moved(to start: Date, end: Date) -> DIPCalendarEventFields {
        var copy = self
        copy.startDate = start
        copy.endDate = end
        return copy
    }
}
