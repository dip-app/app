import Foundation

/// A step of the post-membership tour (spec `docs/milestones/v2/ONBOARDING_SPEC.md`, B0–B5).
///
/// The sign-in routes (A0–A4) are driven by the accounts session state, not by this
/// machine, and the handoff (H) is a phase of `OnboardingFlow`, not a step. Raw values
/// are stored in `OnboardingRecord.lastStep`; never rename them without a record version bump.
public enum OnboardingStep: String, CaseIterable, Codable, Sendable {
    /// B0: "You're in". First run only; replay starts at `.discover`.
    case arrival
    /// B1: Discover & Join. Always available.
    case discover
    /// B2: People & Invites. Always available; the invite beats need `.invites`.
    case people
    /// B3: Challenges & Points. Needs `.challenges`; the points beat needs `.points`.
    case challenges
    /// B4: Memories. Always available; the upload beat needs `.albums` (or the mock album).
    case memories
    /// B5: Interests. Dropped only when the interest catalog is known to be empty.
    case interests

    /// The spec's step ID (B0...B5), for logs, test names and `freezeAt` captures.
    public var specID: String {
        "B\(Self.allCases.firstIndex(of: self)!)"
    }

    /// Whether the step hosts a crew face on the Stage's top edge (B1–B4).
    public var hasHostFace: Bool {
        switch self {
        case .discover, .people, .challenges, .memories: true
        case .arrival, .interests: false
        }
    }

    /// The tour steps that can be shown, in order, for the given feature flags.
    ///
    /// - Parameters:
    ///   - features: the feature flags that are switched on in this build.
    ///   - catalogEmpty: `true` only when the interest catalog loaded and is empty. A loading
    ///     or failed catalog keeps B5, which then shows its loading or failed state.
    ///   - includeArrival: `false` for replay, which starts at B1.
    public static func availableSteps(
        features: OnboardingFeatures, catalogEmpty: Bool, includeArrival: Bool = true
    ) -> [OnboardingStep] {
        allCases.filter { step in
            switch step {
            case .arrival: includeArrival
            case .discover, .people, .memories: true
            case .challenges: features.contains(.challenges)
            case .interests: !catalogEmpty
            }
        }
    }
}

/// Feature flags that change which tour steps and demo beats exist.
///
/// Only `.challenges` and an empty catalog remove whole steps; the other flags
/// switch beats inside a step's demo (spec §2 flow map, §3 storyboards).
public struct OnboardingFeatures: OptionSet, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    /// F4 invitations: B2 invite sheet, Priya's view and the "7 of 12" count.
    public static let invites = OnboardingFeatures(rawValue: 1 << 0)
    /// F3 challenges: the whole B3 step.
    public static let challenges = OnboardingFeatures(rawValue: 1 << 1)
    /// F2 points balance: B3's balance roll.
    public static let points = OnboardingFeatures(rawValue: 1 << 2)
    /// F5 live albums: B4's upload beat against real album UI.
    public static let albums = OnboardingFeatures(rawValue: 1 << 3)
    /// F1 interest filtering: B5's live reshape (chip row and cards).
    public static let interestFilter = OnboardingFeatures(rawValue: 1 << 4)

    public static let all: OnboardingFeatures = [.invites, .challenges, .points, .albums, .interestFilter]
}
