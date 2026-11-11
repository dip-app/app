import Foundation

/// Decides whether a shake may open the report sheet. Pure and clock-injected.
public struct ShakeGate: Sendable {
    public static let enabledKey = "dip.shakeToReport.enabled"
    public static let debounce: TimeInterval = 1.5
    public static let suppressionAfterClose: TimeInterval = 10

    public struct Conditions: Sendable {
        public var isEnabled: Bool
        public var isSheetPresented: Bool
        public var isAppActive: Bool
        public var isOtherModalUp: Bool
        public var isSuppressedByHost: Bool
        public init(
            isEnabled: Bool = true, isSheetPresented: Bool = false, isAppActive: Bool = true,
            isOtherModalUp: Bool = false, isSuppressedByHost: Bool = false
        ) {
            self.isEnabled = isEnabled; self.isSheetPresented = isSheetPresented; self.isAppActive = isAppActive
            self.isOtherModalUp = isOtherModalUp; self.isSuppressedByHost = isSuppressedByHost
        }
    }

    private var lastAccepted: Date?
    private var closedAt: Date?

    public init() {}

    /// Default on when the key was never written.
    public static func isEnabled(_ defaults: UserDefaults = .standard) -> Bool {
        defaults.object(forKey: enabledKey) as? Bool ?? true
    }

    /// True when the shake should present the sheet; records the trigger time.
    public mutating func accept(at now: Date, _ c: Conditions) -> Bool {
        guard c.isEnabled, !c.isSheetPresented, c.isAppActive, !c.isOtherModalUp, !c.isSuppressedByHost
        else { return false }
        if let lastAccepted, now.timeIntervalSince(lastAccepted) < Self.debounce { return false }
        if let closedAt, now.timeIntervalSince(closedAt) < Self.suppressionAfterClose { return false }
        lastAccepted = now
        return true
    }

    /// Call when the sheet closes (sent or cancelled); suppresses further shakes for ten seconds.
    public mutating func sheetClosed(at now: Date) { closedAt = now }
}
