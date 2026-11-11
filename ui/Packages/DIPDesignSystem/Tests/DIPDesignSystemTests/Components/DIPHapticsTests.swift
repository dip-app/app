import XCTest
@testable import DIPDesignSystem

final class DIPHapticsTests: XCTestCase {
    private let t0 = Date(timeIntervalSinceReferenceDate: 1_000)

    func testNavigationIsSilentAndCommitsAreFelt() {
        XCTAssertEqual(DIPHapticTuning.pattern(for: .navigate), .none)
        XCTAssertEqual(DIPHapticTuning.pattern(for: .select), .selection)
        guard case .impact(let style, let intensity) = DIPHapticTuning.pattern(for: .commit) else {
            return XCTFail("commit must be an impact")
        }
        XCTAssertEqual(style, .light)
        XCTAssertLessThanOrEqual(intensity, 1)
        XCTAssertGreaterThan(intensity, 0.3, "felt, but slight")
        XCTAssertEqual(DIPHapticTuning.pattern(for: .success), .notification(.success))
        XCTAssertEqual(DIPHapticTuning.pattern(for: .failure), .notification(.warning))
        XCTAssertEqual(Set(DIPHapticTuning.table.keys), Set(DIPHapticEvent.allCases), "every event is tuned")
    }

    func testGateThrottlesTheSameEventFor80ms() {
        var gate = DIPHapticGate()
        XCTAssertNotNil(gate.admit(.commit, at: t0, enabled: true))
        XCTAssertNil(gate.admit(.commit, at: t0.addingTimeInterval(0.05), enabled: true))
        XCTAssertNil(gate.admit(.commit, at: t0.addingTimeInterval(0.079), enabled: true))
        XCTAssertNotNil(gate.admit(.commit, at: t0.addingTimeInterval(0.081), enabled: true))
        // Different events don't throttle each other.
        XCTAssertNotNil(gate.admit(.success, at: t0.addingTimeInterval(0.082), enabled: true))
    }

    func testGateHonoursTheSwitchAndSilentEvents() {
        var gate = DIPHapticGate()
        XCTAssertNil(gate.admit(.commit, at: t0, enabled: false))
        XCTAssertNil(gate.admit(.navigate, at: t0, enabled: true))
        // A switched-off attempt does not start the throttle window.
        XCTAssertNotNil(gate.admit(.commit, at: t0.addingTimeInterval(0.01), enabled: true))
    }

    func testEnabledFlagDefaultsOn() throws {
        let suite = "dip.haptics.tests"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defaults.removePersistentDomain(forName: suite)
        XCTAssertTrue(DIPHapticGate.isEnabled(defaults))
        defaults.set(false, forKey: DIPHapticGate.enabledKey)
        XCTAssertFalse(DIPHapticGate.isEnabled(defaults))
        defaults.removePersistentDomain(forName: suite)
    }
}
