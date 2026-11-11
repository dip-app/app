import Foundation

/// Display text for a points balance. Display only: the client never writes points.
public enum DIPPointsFormat {
    /// "0", "1", "1,234" (grouping follows the locale). Negative values show as 0.
    public static func number(_ balance: Int, locale: Locale = .current) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        return formatter.string(from: NSNumber(value: max(0, balance))) ?? "\(max(0, balance))"
    }

    /// "0 points", "1 point", "1,234 points".
    public static func balance(_ balance: Int, locale: Locale = .current) -> String {
        let value = max(0, balance)
        return "\(number(value, locale: locale)) \(value == 1 ? "point" : "points")"
    }

    /// Reward an event gives: "+50 points" ("+1 point"); nil at 0 or below, so callers hide the pill.
    public static func reward(_ points: Int, locale: Locale = .current) -> String? {
        guard points > 0 else { return nil }
        return "+\(balance(points, locale: locale))"
    }

    /// VoiceOver text for the reward pill on every surface: "Worth 50 points"; nil at 0 or below.
    public static func rewardAccessibility(_ points: Int, locale: Locale = .current) -> String? {
        guard points > 0 else { return nil }
        return "Worth \(balance(points, locale: locale))"
    }

    /// Compact card text: "+50 pts"; nil at 0 or below.
    public static func rewardShort(_ points: Int, locale: Locale = .current) -> String? {
        guard points > 0 else { return nil }
        return "+\(number(points, locale: locale)) pts"
    }
}
