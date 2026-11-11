import DIPCore
import Foundation

/// How a member host shows the tour: where records live and which debug overrides apply.
/// `DIPMemberHome` shows nothing when it gets no settings (previews and UI tests that predate the tour).
struct OnboardingTourSettings {
    var store: any OnboardingRecordStore
    var configuration: OnboardingTourConfiguration = .standard
    /// Debug: forget this uid's record before deciding whether to show the tour.
    var resetRecord = false
    /// Debug: pretend the member last settled on this step (`-onboarding.resumeAt <step>`).
    var resumeAt: OnboardingStep?

    /// Applies the debug overrides for `uid`, then reports whether the first-run tour should show.
    func prepare(uid: String) -> Bool {
        if resetRecord || resumeAt != nil, let defaults = store as? UserDefaultsOnboardingRecordStore {
            defaults.removeRecord(for: uid)
        }
        if let resumeAt {
            store.save(OnboardingRecord(lastStep: resumeAt, outcome: nil, updatedAt: Date()), for: uid)
        }
        return !store.isComplete(uid: uid)
    }

    /// The app's settings: UserDefaults records keyed `dip.onboarding.v1.<uid>`, plus Debug launch
    /// arguments (spec §5 UI tests): `-onboarding.reset`, `-onboarding.timeScale <n>`,
    /// `-onboarding.reduceMotion`, `-onboarding.resumeAt <step>`, `-onboarding.freezeAt <scene>@<seconds|final>`
    /// and `-onboarding.features all|none`.
    @MainActor static func standard(
        defaults: UserDefaults = .standard, arguments: [String] = ProcessInfo.processInfo.arguments
    ) -> OnboardingTourSettings {
        var settings = OnboardingTourSettings(store: UserDefaultsOnboardingRecordStore(defaults: defaults))
        #if DEBUG
        settings.apply(arguments: arguments)
        if arguments.contains("--reset-onboarding") { Self.resetAllRecordsOnce(defaults) }
        #endif
        return settings
    }

    #if DEBUG
    /// `--reset-onboarding`: forget every account's tour record (`dip.onboarding.v1.*`) once per launch, so the
    /// full tour plays again. Once, because hosts rebuild these settings on every view update.
    @MainActor private static var didResetThisLaunch = false

    @MainActor static func resetAllRecordsOnce(_ defaults: UserDefaults) {
        guard !didResetThisLaunch else { return }
        didResetThisLaunch = true
        let prefix = UserDefaultsOnboardingRecordStore.key(for: "")
        for key in defaults.dictionaryRepresentation().keys where key.hasPrefix(prefix) {
            defaults.removeObject(forKey: key)
        }
    }
    #endif

    mutating func apply(arguments: [String]) {
        func value(after flag: String) -> String? {
            guard let index = arguments.firstIndex(of: flag), arguments.indices.contains(index + 1) else { return nil }
            return arguments[index + 1]
        }
        func flag(_ name: String) -> Bool {
            guard let index = arguments.firstIndex(of: name) else { return false }
            let next = arguments.indices.contains(index + 1) ? arguments[index + 1].uppercased() : ""
            return !["NO", "0", "FALSE"].contains(next)
        }
        resetRecord = flag("-onboarding.reset")
        if let scale = value(after: "-onboarding.timeScale").flatMap(Double.init), scale > 0 {
            configuration.timeScale = scale
        }
        configuration.forceReduceMotion = flag("-onboarding.reduceMotion")
        resumeAt = value(after: "-onboarding.resumeAt").flatMap(Self.step(named:))
        switch value(after: "-onboarding.features") {
        case "all": configuration.features = .all
        case "none": configuration.features = []
        default: break
        }
        if let freeze = value(after: "-onboarding.freezeAt") {
            let parts = freeze.split(separator: "@", maxSplits: 1).map(String.init)
            if parts.count == 2 {
                let time: Duration? = parts[1] == "final" ? .seconds(1_000) : Double(parts[1]).map { .seconds($0) }
                if let time { configuration.freezeAt = (parts[0], time) }
            }
        }
    }

    /// Accepts raw values ("people") and spec IDs ("B2").
    static func step(named name: String) -> OnboardingStep? {
        OnboardingStep(rawValue: name) ?? OnboardingStep.allCases.first { $0.specID.caseInsensitiveCompare(name) == .orderedSame }
    }
}
