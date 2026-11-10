import DIPCore
import XCTest

final class OnboardingRecordStoreTests: XCTestCase {
    private var suiteName = ""
    private var defaults: UserDefaults!
    private let date = Date(timeIntervalSinceReferenceDate: 800_000_123.456)

    override func setUpWithError() throws {
        suiteName = "dip.onboarding.tests.\(UUID().uuidString)"
        defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        defaults = nil
    }

    func testRoundTripUsesThePerUidKey() throws {
        let store = UserDefaultsOnboardingRecordStore(defaults: defaults)
        let record = OnboardingRecord(lastStep: .people, outcome: nil, updatedAt: date)
        XCTAssertNil(store.record(for: "uid-a"))
        store.save(record, for: "uid-a")
        XCTAssertEqual(store.record(for: "uid-a"), record)
        XCTAssertEqual(UserDefaultsOnboardingRecordStore.key(for: "uid-a"), "dip.onboarding.v1.uid-a")
        let data = try XCTUnwrap(defaults.data(forKey: "dip.onboarding.v1.uid-a"))
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(json["version"] as? Int, 1)
        XCTAssertEqual(json["lastStep"] as? String, "people")
        XCTAssertNil(json["outcome"])
        // A fresh store instance on the same defaults reads the same record.
        XCTAssertEqual(UserDefaultsOnboardingRecordStore(defaults: defaults).record(for: "uid-a"), record)
    }

    func testIsCompleteRequiresASupportedOutcome() {
        let store = UserDefaultsOnboardingRecordStore(defaults: defaults)
        XCTAssertFalse(store.isComplete(uid: "uid-a"))
        store.save(.init(lastStep: .memories, outcome: nil, updatedAt: date), for: "uid-a")
        XCTAssertFalse(store.isComplete(uid: "uid-a"))
        store.save(.init(lastStep: .memories, outcome: .skipped, updatedAt: date), for: "uid-a")
        XCTAssertTrue(store.isComplete(uid: "uid-a"))
        store.save(.init(lastStep: .interests, outcome: .finished, updatedAt: date), for: "uid-a")
        XCTAssertTrue(store.isComplete(uid: "uid-a"))
        store.save(.init(version: 2, lastStep: .interests, outcome: .finished, updatedAt: date), for: "uid-a")
        XCTAssertFalse(store.isComplete(uid: "uid-a"), "another version's record is ignored")
    }

    func testRecordsAreIsolatedPerUid() {
        let store = UserDefaultsOnboardingRecordStore(defaults: defaults)
        store.save(.init(lastStep: .interests, outcome: .finished, updatedAt: date), for: "uid-a")
        XCTAssertTrue(store.isComplete(uid: "uid-a"))
        XCTAssertNil(store.record(for: "uid-b"))
        XCTAssertFalse(store.isComplete(uid: "uid-b"))
        store.save(.init(lastStep: .discover, outcome: nil, updatedAt: date), for: "uid-b")
        XCTAssertEqual(store.record(for: "uid-a")?.outcome, .finished)
        store.removeRecord(for: "uid-b")
        XCTAssertNil(store.record(for: "uid-b"))
        XCTAssertNotNil(store.record(for: "uid-a"))
    }

    func testEmptyUidIsNeverStored() {
        let store = UserDefaultsOnboardingRecordStore(defaults: defaults)
        store.save(.init(lastStep: .discover, outcome: .finished, updatedAt: date), for: "")
        XCTAssertNil(store.record(for: ""))
        XCTAssertNil(defaults.object(forKey: "dip.onboarding.v1."))
    }

    func testCorruptDataReadsAsNoRecord() {
        let store = UserDefaultsOnboardingRecordStore(defaults: defaults)
        let key = UserDefaultsOnboardingRecordStore.key(for: "uid-a")
        defaults.set(Data("not json".utf8), forKey: key)
        XCTAssertNil(store.record(for: "uid-a"))
        XCTAssertFalse(store.isComplete(uid: "uid-a"))
        defaults.set("a string, not data", forKey: key)
        XCTAssertNil(store.record(for: "uid-a"))
        defaults.set(Data(#"{"version":1,"outcome":"abandoned","updatedAt":0}"#.utf8), forKey: key)
        XCTAssertNil(store.record(for: "uid-a"), "unknown outcome")
        defaults.set(Data(#"{"lastStep":"people"}"#.utf8), forKey: key)
        XCTAssertNil(store.record(for: "uid-a"), "missing required fields")
        // Saving over corrupt data recovers.
        store.save(.init(lastStep: .people, outcome: nil, updatedAt: date), for: "uid-a")
        XCTAssertEqual(store.record(for: "uid-a")?.lastStep, .people)
    }

    func testUnknownStepNameKeepsTheRestOfTheRecord() throws {
        let store = UserDefaultsOnboardingRecordStore(defaults: defaults)
        defaults.set(Data(#"{"version":1,"lastStep":"rewards","outcome":"finished","updatedAt":0}"#.utf8),
                     forKey: UserDefaultsOnboardingRecordStore.key(for: "uid-a"))
        let record = try XCTUnwrap(store.record(for: "uid-a"))
        XCTAssertNil(record.lastStep)
        XCTAssertEqual(record.outcome, .finished)
        XCTAssertTrue(store.isComplete(uid: "uid-a"))
    }

    func testApplyPersistsOnlyPersistEffectsFromAFlow() {
        let store = UserDefaultsOnboardingRecordStore(defaults: defaults)
        var flow = OnboardingFlow(mode: .firstRun, features: .all)
        for _ in 0..<2 {
            let transition = flow.next(at: date)
            store.apply(transition.effects, uid: "uid-a")
            flow = transition.flow
        }
        XCTAssertEqual(store.record(for: "uid-a"), .init(lastStep: .people, outcome: nil, updatedAt: date))
        store.apply(flow.skip(at: date).effects, uid: "uid-a")
        XCTAssertTrue(store.isComplete(uid: "uid-a"))
        XCTAssertEqual(OnboardingFlow.resume(record: store.record(for: "uid-a"), features: .all).phase, .handoff(.skipped))

        // Replay effects never reach the store.
        let replayStore = UserDefaultsOnboardingRecordStore(defaults: defaults)
        let replay = OnboardingFlow(mode: .replay, features: .all)
        replayStore.apply(replay.next(at: date).effects + replay.skip(at: date).effects, uid: "uid-r")
        XCTAssertNil(replayStore.record(for: "uid-r"))
    }
}
