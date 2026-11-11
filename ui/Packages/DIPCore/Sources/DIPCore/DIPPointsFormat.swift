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
}
