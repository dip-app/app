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
        let formatted = number(value, locale: locale)
        // One key per plural shape (not a plural variation) because the count is shown grouped, e.g. "1,234".
        return value == 1
            ? String(localized: "points.balance.one", defaultValue: "\(formatted) point", bundle: .module, comment: "Points balance for exactly 1 point; %@ = formatted number")
            : String(localized: "points.balance.other", defaultValue: "\(formatted) points", bundle: .module, comment: "Points balance for 0 or several points; %@ = formatted number such as 1,234")
    }

    /// Reward an event gives: "+50 points" ("+1 point"); nil at 0 or below, so callers hide the pill.
    public static func reward(_ points: Int, locale: Locale = .current) -> String? {
        guard points > 0 else { return nil }
        let formatted = number(points, locale: locale)
        return points == 1
            ? String(localized: "points.reward.one", defaultValue: "+\(formatted) point", bundle: .module, comment: "Event reward for exactly 1 point; %@ = formatted number")
            : String(localized: "points.reward.other", defaultValue: "+\(formatted) points", bundle: .module, comment: "Event reward for several points; %@ = formatted number such as 50")
    }

    /// VoiceOver text for the reward pill on every surface: "Worth 50 points"; nil at 0 or below.
    public static func rewardAccessibility(_ points: Int, locale: Locale = .current) -> String? {
        guard points > 0 else { return nil }
        let formatted = number(points, locale: locale)
        return points == 1
            ? String(localized: "points.worth.one", defaultValue: "Worth \(formatted) point", bundle: .module, comment: "VoiceOver for the reward pill, 1 point; %@ = formatted number")
            : String(localized: "points.worth.other", defaultValue: "Worth \(formatted) points", bundle: .module, comment: "VoiceOver for the reward pill, several points; %@ = formatted number such as 50")
    }

    /// Points row of an event page by the member's relationship to it: "Earned 50 points" once they attended
    /// (past and joined), "Worth 50 points" for a past event they did not join, "Earn 50 points" before it. nil at 0.
    /// Sign rule: a bare amount carries "+" (the "+50 pts" pills); after a verb (Earn, Earned, Worth) it never does.
    public static func eventRow(_ points: Int, isPast: Bool, attended: Bool, locale: Locale = .current) -> String? {
        guard points > 0 else { return nil }
        let formatted = number(points, locale: locale)
        let isOne = points == 1
        if isPast {
            if attended {
                return isOne
                    ? String(localized: "points.earned.one", defaultValue: "Earned \(formatted) point", bundle: .module, comment: "Event page points row once attended, 1 point; %@ = formatted number")
                    : String(localized: "points.earned.other", defaultValue: "Earned \(formatted) points", bundle: .module, comment: "Event page points row once attended; %@ = formatted number such as 50")
            }
            return isOne
                ? String(localized: "points.worthPast.one", defaultValue: "Worth \(formatted) point", bundle: .module, comment: "Event page points row for a past event the member did not join, 1 point; %@ = formatted number")
                : String(localized: "points.worthPast.other", defaultValue: "Worth \(formatted) points", bundle: .module, comment: "Event page points row for a past event the member did not join; %@ = formatted number such as 50")
        }
        return isOne
            ? String(localized: "points.earn.one", defaultValue: "Earn \(formatted) point", bundle: .module, comment: "Event page points row before the event, 1 point; %@ = formatted number")
            : String(localized: "points.earn.other", defaultValue: "Earn \(formatted) points", bundle: .module, comment: "Event page points row before the event; %@ = formatted number such as 50")
    }

    /// Compact card text: "+50 pts"; nil at 0 or below.
    public static func rewardShort(_ points: Int, locale: Locale = .current) -> String? {
        guard points > 0 else { return nil }
        return String(localized: "points.rewardShort", defaultValue: "+\(number(points, locale: locale)) pts", bundle: .module, comment: "Compact reward on an event card; %@ = formatted number such as 50")
    }
}
