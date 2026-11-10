import DIPCore
import XCTest

final class AnimationCurveTests: XCTestCase {
    private let specs: [AnimationSpec] = [
        OnboardingAnimation.stage, OnboardingAnimation.expand, OnboardingAnimation.hop,
        OnboardingAnimation.affordance, OnboardingAnimation.marker, OnboardingAnimation.copyOut,
        OnboardingAnimation.bar, OnboardingAnimation.ghost, .linear(duration: 0.5),
        .spring(response: 0.5, dampingFraction: 1), .spring(response: 0.5, dampingFraction: 1.4),
    ]

    func testProgressStartsAtZeroAndLandsAtOneBySettleTime() {
        for spec in specs {
            XCTAssertEqual(spec.progress(at: .zero), 0, "\(spec)")
            XCTAssertEqual(spec.progress(at: .milliseconds(-100)), 0, "\(spec)")
            // Critically damped springs carry a (1 + ω₀t) factor the settle envelope ignores, hence 2e-3.
            XCTAssertEqual(spec.progress(at: spec.settleTime), 1, accuracy: 2e-3, "\(spec)")
            XCTAssertEqual(spec.progress(at: spec.settleTime + .seconds(2)), 1, accuracy: 1e-4, "\(spec)")
        }
        XCTAssertEqual(AnimationSpec.none.progress(at: .milliseconds(1)), 1)
    }

    func testTimingCurvesAreMonotoneAndShaped() {
        for spec in [OnboardingAnimation.copyOut, OnboardingAnimation.bar, OnboardingAnimation.ghost] {
            let values = stride(from: 0, through: 500, by: 10).map { spec.progress(at: .milliseconds($0)) }
            XCTAssertEqual(values, values.sorted(), "\(spec)")
        }
        let half = Duration.milliseconds(150)
        XCTAssertLessThan(AnimationSpec.easeIn(duration: 0.3).progress(at: half), 0.5)
        XCTAssertGreaterThan(AnimationSpec.easeOut(duration: 0.3).progress(at: half), 0.5)
        XCTAssertEqual(AnimationSpec.easeInOut(duration: 0.3).progress(at: half), 0.5, accuracy: 1e-6)
        XCTAssertEqual(AnimationSpec.linear(duration: 0.4).progress(at: .milliseconds(100)), 0.25, accuracy: 1e-9)
    }

    func testUnderdampedSpringsOvershootAndCriticalOnesDoNot() {
        let samples = stride(from: 0, through: 2_000, by: 5).map { Duration.milliseconds($0) }
        XCTAssertGreaterThan(samples.map(OnboardingAnimation.hop.progress(at:)).max() ?? 0, 1)
        let critical = AnimationSpec.spring(response: 0.5, dampingFraction: 1)
        let values = samples.map(critical.progress(at:))
        XCTAssertEqual(values, values.sorted())
        XCTAssertLessThanOrEqual(values.max() ?? 2, 1)
    }
}
