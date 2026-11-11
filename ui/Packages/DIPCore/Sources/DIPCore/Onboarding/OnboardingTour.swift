import Foundation

// Pure rules for the tour shell (spec §2 Persistence, §3.0 layout, §3 H, §4.2 progress).
// The app's `OnboardingTourView` renders these; keeping them here makes them unit-testable
// without SwiftUI.

/// How the tour opens (spec §2 Resume, §4.1 "resume entrance").
public enum OnboardingEntrance: Equatable, Sendable {
    /// No record (or an unusable one): B0's fresh-member entrance.
    case fresh
    /// A stored `lastStep`: the A0 → B[n] resume entrance, with the stack pre-filled.
    case resume(OnboardingStep)
    /// "How DIP works" from Profile: starts at B1, never persists.
    case replay

    /// Builds the flow and picks the entrance. The resume entrance plays exactly when the flow
    /// came from `OnboardingFlow.resume` with a supported, unfinished record whose `lastStep != nil`.
    public static func start(
        mode: OnboardingFlow.Mode, record: OnboardingRecord?, features: OnboardingFeatures, catalogEmpty: Bool
    ) -> (flow: OnboardingFlow, entrance: OnboardingEntrance) {
        switch mode {
        case .replay:
            return (OnboardingFlow(mode: .replay, features: features, catalogEmpty: catalogEmpty), .replay)
        case .firstRun:
            let flow = OnboardingFlow.resume(record: record, features: features, catalogEmpty: catalogEmpty)
            guard let record, record.isSupported, record.outcome == nil, record.lastStep != nil,
                  let step = flow.currentStep else { return (flow, .fresh) }
            // Resuming at B0 uses B0's own fresh-member entrance (spec §4.1).
            return (flow, step == .arrival ? .fresh : .resume(step))
        }
    }
}

/// The Crew stack in the header (spec §4.2): at most three faces, then one "+n" disc.
public struct OnboardingCrewStack: Equatable, Sendable {
    public static let maximumFaces = 3
    public static let discSize = 28.0
    /// Centre-to-centre distance (28 pt discs overlapping by 10).
    public static let step = 18.0

    /// Members shown as faces (You first, then hosts in step order).
    public let faces: Int
    /// Members folded into the "+n" disc; 0 when there is no disc.
    public let overflow: Int

    public init(count: Int) {
        let count = max(0, count)
        faces = min(count, Self.maximumFaces)
        overflow = max(0, count - Self.maximumFaces)
    }

    /// Faces plus the "+n" disc.
    public var discs: Int { faces + (overflow > 0 ? 1 : 0) }

    /// Never wider than 82 pt (spec §3.0).
    public var width: Double { discs == 0 ? 0 : Self.discSize + Self.step * Double(discs - 1) }

    /// The x offset of disc `index` from the stack's leading edge.
    public static func offset(of index: Int) -> Double { step * Double(index) }
}

/// The header row's layout under the overflow rule (spec §3.0 "Header overflow rule").
public enum OnboardingHeaderLayout: Equatable, Sendable {
    /// Back, pill, stack and Skip on one row; the pill is capped at `pillMaxWidth` when set.
    case oneRow(pillMaxWidth: Double?)
    /// Back + Skip, then pill + stack (accessibility sizes, or nothing fits).
    case twoRows

    public static let pillLeading = 72.0
    public static let stackGap = 10.0
    public static let skipGap = 8.0
    public static let minimumPillWidth = 88.0

    /// Skip's hit area: `max(44, labelWidth + 16)`, trailing-aligned to `screenWidth − 20`.
    public static func skipWidth(labelWidth: Double) -> Double { max(44, labelWidth + 16) }

    public static func resolve(
        pillWidth: Double, stackWidth: Double, skipMinX: Double, isAccessibilitySize: Bool
    ) -> OnboardingHeaderLayout {
        if isAccessibilitySize { return .twoRows }
        let stack = stackWidth > 0 ? stackGap + stackWidth : 0
        let available = skipMinX - skipGap - pillLeading - stack
        if pillWidth <= available { return .oneRow(pillMaxWidth: nil) }
        if available >= minimumPillWidth { return .oneRow(pillMaxWidth: available) }
        return .twoRows
    }
}

/// What `DIPMemberHome` shows underneath the tour (spec §3 H "What is underneath").
public enum OnboardingHomeSurface: String, CaseIterable, Equatable, Sendable {
    /// `ProgressView("Loading your company events…")` while the live repository is created. No bar.
    case shellLoading
    /// `ContentUnavailableView("Events unavailable")`. No bar.
    case shellUnavailable
    /// `DIPPrototypeApp` loading its first snapshot. Bar drawn.
    case activitiesLoading
    /// `DIPPrototypeApp` "Couldn't load your activities" with Retry. Bar drawn.
    case activitiesError
    /// `DIPPrototypeApp` with a snapshot. Bar drawn.
    case ready

    /// How the onboarding Bar leaves at handoff.
    public enum BarTreatment: Equatable, Sendable {
        /// The action dissolves into tabs with the marker on Home; the shell's bar is identical underneath.
        case dissolveToTabs
        /// No bar underneath: the onboarding Bar fades out (0.25 s).
        case fadeOut
    }

    /// Where VoiceOver focus lands once the tour layer is removed.
    public enum FocusTarget: Equatable, Sendable {
        case homeHeader, loadingLabel, retryButton, unavailableTitle
    }

    public var hasBarUnderneath: Bool {
        switch self {
        case .activitiesLoading, .activitiesError, .ready: true
        case .shellLoading, .shellUnavailable: false
        }
    }

    public var barTreatment: BarTreatment { hasBarUnderneath ? .dissolveToTabs : .fadeOut }

    /// Loading surfaces make the handoff wait (up to `OnboardingHandoff.waitLimit`).
    public var isLoading: Bool { self == .shellLoading || self == .activitiesLoading }

    public var focusTarget: FocusTarget {
        switch self {
        case .ready: .homeHeader
        case .activitiesLoading, .shellLoading: .loadingLabel
        case .activitiesError: .retryButton
        case .shellUnavailable: .unavailableTitle
        }
    }

    /// Whether You's flight ends on the Home header's profile button. Otherwise it ends at the
    /// same top-right position and fades, because there is no header there.
    public var hasProfileButton: Bool { self == .ready }
}

/// Handoff timing (spec §3 H "Window reveal"). t = 0 is the end of the wait, or the CTA tap.
public enum OnboardingHandoff {
    /// The longest the tour waits for a loading surface to change.
    public static let waitLimit = 2.0
    /// The Stage's contents fade so the surface shows through the window.
    public static let stageFadeAt = 0.10
    public static let stageFadeDuration = 0.2
    /// The window grows with `reveal`; You flies to the profile button with `stage`.
    public static let windowAt = 0.20
    /// The Bar dissolves to tabs, or fades out.
    public static let barAt = 0.30
    public static let barFadeDuration = 0.25
    /// The tour layer is removed and focus moves.
    public static let removeAt = 1.25
    /// Reduce Motion: one crossfade.
    public static let reducedCrossfade = 0.35

    /// The profile button's frame on Home (`DIPHomeScreen`: 20 pt sides, 60 pt top, 5 pt capsule padding).
    public static func profileButtonFrame(width: Double) -> (x: Double, y: Double, size: Double) {
        (width - 65, 65, 40)
    }

    /// Whether the reveal must wait for the surface underneath.
    public static func shouldWait(for surface: OnboardingHomeSurface?) -> Bool {
        surface.map(\.isLoading) ?? true
    }
}

/// Token names for each step's Stage fill (spec §4.3). Adjacent fills always differ.
public enum OnboardingStageFill: String, Equatable, Sendable {
    case challengeAccent, actionPrimary, notificationAccent, surfaceMuted

    public static func fill(for step: OnboardingStep) -> OnboardingStageFill {
        switch step {
        case .arrival: .notificationAccent
        case .discover: .actionPrimary
        case .people: .surfaceMuted
        case .challenges: .challengeAccent
        case .memories: .notificationAccent
        case .interests: .surfaceMuted
        }
    }
}

public extension OnboardingFlow {
    /// The hosts that have joined the stack before `step` (in step order), for the header and the
    /// resume entrance's pre-filled stack.
    func completedHosts(before step: OnboardingStep) -> [OnboardingStep] {
        guard let index = steps.firstIndex(of: step) else { return [] }
        return steps[..<index].filter(\.hasHostFace)
    }

    /// The header's Skip label: "Done" in replay.
    var skipTitle: String {
        mode == .replay
            ? String(localized: "onboarding.skip.replay", defaultValue: "Done")
            : String(localized: "onboarding.skip", defaultValue: "Skip")
    }
}
