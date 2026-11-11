import Foundation

/// Slight, semantic haptics for DIP (owner direction, Nov 10).
///
/// Haptics mark *commits*, not movement:
/// - `navigate`: tab switches, opening pages and sheets, back. **No haptic** (the owner leans to none; the
///   screen change is feedback enough).
/// - `select`: choosing an option in a list or chip set (interest picker rows). The lightest selection tick.
/// - `commit`: a press that changes something (Join, Save and start, Send, Accept, Redeem, the sign-in button).
///   A clearly felt but slight impact.
/// - `success`: the change was confirmed (RSVP stored, interests saved, membership resolved).
/// - `failure`: it was refused or failed (save failed, blocked account).
///
/// Every intensity lives in `DIPHapticTuning.table`, so tuning happens in one place. The single switch is the
/// `dip.haptics.enabled` UserDefaults flag (default on). Reduce Motion does not silence haptics: they are not
/// motion, and the commit and outcome cues carry information.
public enum DIPHapticEvent: String, CaseIterable, Hashable, Sendable {
    case navigate, select, commit, success, failure
}

/// What a generator plays for an event.
public enum DIPHapticPattern: Equatable, Sendable {
    case none
    case selection
    /// `UIImpactFeedbackGenerator` style (`light`, `soft`, `medium`, `rigid`) at an intensity 0…1.
    case impact(style: ImpactStyle, intensity: Double)
    case notification(NotificationKind)

    public enum ImpactStyle: String, Sendable { case light, soft, medium, rigid }
    public enum NotificationKind: String, Sendable { case success, warning, error }
}

/// The tuning table: one place to adjust every intensity (the owner's HapticsPrototype values go here).
public enum DIPHapticTuning {
    public static let table: [DIPHapticEvent: DIPHapticPattern] = [
        .navigate: .none,
        .select: .selection,
        .commit: .impact(style: .light, intensity: 0.7),
        .success: .notification(.success),
        .failure: .notification(.warning),
    ]

    /// The same event never plays twice within this interval (no spam from repeated taps or rebuilt views).
    public static let minimumInterval: TimeInterval = 0.08

    public static func pattern(for event: DIPHapticEvent) -> DIPHapticPattern {
        table[event] ?? .none
    }
}

/// Pure throttle and switch logic, unit-tested without UIKit.
public struct DIPHapticGate: Sendable {
    public static let enabledKey = "dip.haptics.enabled"
    private var lastPlayed: [DIPHapticEvent: Date] = [:]

    public init() {}

    /// Whether haptics are switched on (default on when the key was never written).
    public static func isEnabled(_ defaults: UserDefaults = .standard) -> Bool {
        defaults.object(forKey: enabledKey) as? Bool ?? true
    }

    /// Returns the pattern to play now, or nil (switched off, `.none`, or throttled). Records the play.
    public mutating func admit(_ event: DIPHapticEvent, at now: Date, enabled: Bool) -> DIPHapticPattern? {
        guard enabled else { return nil }
        let pattern = DIPHapticTuning.pattern(for: event)
        guard pattern != .none else { return nil }
        if let last = lastPlayed[event], now.timeIntervalSince(last) < DIPHapticTuning.minimumInterval { return nil }
        lastPlayed[event] = now
        return pattern
    }
}

#if canImport(UIKit)
    import UIKit

    /// Plays DIP's haptics. Generators are created lazily and prepared; on the simulator and on devices without
    /// a Taptic Engine UIKit makes them no-ops.
    @MainActor
    public enum DIPHaptics {
        private static var gate = DIPHapticGate()
        private static var impacts: [DIPHapticPattern.ImpactStyle: UIImpactFeedbackGenerator] = [:]
        private static let selection = UISelectionFeedbackGenerator()
        private static let notification = UINotificationFeedbackGenerator()

        public static func navigate() { play(.navigate) }
        public static func select() { play(.select) }
        public static func commit() { play(.commit) }
        public static func success() { play(.success) }
        public static func failure() { play(.failure) }

        /// Warms the generator for an event that is about to happen (e.g. on touch-down).
        public static func prepare(_ event: DIPHapticEvent) {
            switch DIPHapticTuning.pattern(for: event) {
            case .none: break
            case .selection: selection.prepare()
            case .impact(let style, _): impact(style).prepare()
            case .notification: notification.prepare()
            }
        }

        public static func play(_ event: DIPHapticEvent, defaults: UserDefaults = .standard) {
            guard let pattern = gate.admit(event, at: Date(), enabled: DIPHapticGate.isEnabled(defaults)) else { return }
            switch pattern {
            case .none: break
            case .selection: selection.selectionChanged()
            case .impact(let style, let intensity): impact(style).impactOccurred(intensity: CGFloat(intensity))
            case .notification(let kind):
                switch kind {
                case .success: notification.notificationOccurred(.success)
                case .warning: notification.notificationOccurred(.warning)
                case .error: notification.notificationOccurred(.error)
                }
            }
        }

        private static func impact(_ style: DIPHapticPattern.ImpactStyle) -> UIImpactFeedbackGenerator {
            if let generator = impacts[style] { return generator }
            let generator: UIImpactFeedbackGenerator
            switch style {
            case .light: generator = UIImpactFeedbackGenerator(style: .light)
            case .soft: generator = UIImpactFeedbackGenerator(style: .soft)
            case .medium: generator = UIImpactFeedbackGenerator(style: .medium)
            case .rigid: generator = UIImpactFeedbackGenerator(style: .rigid)
            }
            impacts[style] = generator
            return generator
        }
    }
#else
    /// No haptics without UIKit (the package's macOS test host): the same API, all no-ops.
    @MainActor
    public enum DIPHaptics {
        public static func navigate() {}
        public static func select() {}
        public static func commit() {}
        public static func success() {}
        public static func failure() {}
        public static func prepare(_ event: DIPHapticEvent) {}
        public static func play(_ event: DIPHapticEvent, defaults: UserDefaults = .standard) {}
    }
#endif
