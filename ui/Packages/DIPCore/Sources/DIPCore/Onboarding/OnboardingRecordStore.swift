import Foundation

/// How the first-run tour ended.
public enum OnboardingOutcome: String, Codable, Sendable {
    case finished
    case skipped
}

/// The per-account, per-device tour record (spec §2 Persistence). Nothing is written to Firestore.
public struct OnboardingRecord: Codable, Equatable, Sendable {
    /// The only version this build reads. A record with another version is ignored.
    public static let currentVersion = 1

    public var version: Int
    /// The step the member was on when the record was last written; resume starts here.
    /// `nil` when the stored step name is unknown to this build.
    public var lastStep: OnboardingStep?
    /// Set the moment handoff starts. Any non-nil value means the tour is complete.
    public var outcome: OnboardingOutcome?
    public var updatedAt: Date

    public init(
        version: Int = OnboardingRecord.currentVersion, lastStep: OnboardingStep?,
        outcome: OnboardingOutcome?, updatedAt: Date
    ) {
        self.version = version
        self.lastStep = lastStep
        self.outcome = outcome
        self.updatedAt = updatedAt
    }

    /// Whether this build understands the record. Unsupported records behave as if absent.
    public var isSupported: Bool { version == Self.currentVersion }

    /// A supported record with an outcome.
    public var isComplete: Bool { isSupported && outcome != nil }

    private enum CodingKeys: String, CodingKey { case version, lastStep, outcome, updatedAt }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        version = try container.decode(Int.self, forKey: .version)
        // A step removed or renamed by a later build must not make the whole record unreadable.
        lastStep = (try? container.decodeIfPresent(String.self, forKey: .lastStep)).flatMap { $0 }
            .flatMap(OnboardingStep.init(rawValue:))
        outcome = try container.decodeIfPresent(OnboardingOutcome.self, forKey: .outcome)
        updatedAt = try container.decode(Date.self, forKey: .updatedAt)
    }
}

/// Reads and writes tour records. Keyed by Firebase Auth uid so accounts on one device are isolated.
public protocol OnboardingRecordStore: Sendable {
    func record(for uid: String) -> OnboardingRecord?
    func save(_ record: OnboardingRecord, for uid: String)
    /// True when the uid has a supported record with an outcome; the tour is then never shown.
    func isComplete(uid: String) -> Bool
}

public extension OnboardingRecordStore {
    func isComplete(uid: String) -> Bool {
        record(for: uid)?.isComplete ?? false
    }

    /// Applies the `.persist` effects of a flow transition; other effects are ignored.
    func apply(_ effects: [OnboardingFlow.Effect], uid: String) {
        for case .persist(let record) in effects {
            save(record, for: uid)
        }
    }
}

/// Stores each record as JSON under `dip.onboarding.v1.<uid>`.
///
/// Sign-out keeps records; reinstalling the app clears them (accepted in the spec).
/// Unreadable data is treated as no record, so the worst case is seeing the tour again.
public struct UserDefaultsOnboardingRecordStore: OnboardingRecordStore, @unchecked Sendable {
    // UserDefaults is documented as thread-safe.
    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public static func key(for uid: String) -> String {
        "dip.onboarding.v1.\(uid)"
    }

    public func record(for uid: String) -> OnboardingRecord? {
        guard !uid.isEmpty, let data = defaults.data(forKey: Self.key(for: uid)) else { return nil }
        return try? JSONDecoder().decode(OnboardingRecord.self, from: data)
    }

    public func save(_ record: OnboardingRecord, for uid: String) {
        guard !uid.isEmpty, let data = try? JSONEncoder().encode(record) else { return }
        defaults.set(data, forKey: Self.key(for: uid))
    }

    /// Removes one uid's record (the Debug `-onboarding.reset` launch argument).
    public func removeRecord(for uid: String) {
        guard !uid.isEmpty else { return }
        defaults.removeObject(forKey: Self.key(for: uid))
    }
}
