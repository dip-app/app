import Foundation

/// How fresh Home's event list is. Presentation only; the data source decides which applies.
public enum DIPHomeEventsPhase: Equatable, Sendable {
    /// Loaded (or never gated).
    case ready
    /// First read in flight and nothing to show yet.
    case loading
    /// The read failed and there is nothing cached to show.
    case failed(String)
    /// The read failed but the last loaded events are still shown (read-only, possibly out of date).
    case offline
}

/// What Home's events area shows. Pure so every combination is unit tested.
public enum DIPHomeEventsContent: Equatable, Sendable {
    case skeleton
    case failure(String)
    case list
    /// The filter matched nothing in the pages loaded so far; `canLoadMore` says more pages may exist.
    case emptyFiltered(canLoadMore: Bool)
    case emptyAll

    public static func resolve(
        phase: DIPHomeEventsPhase, filterActive: Bool, scope: DIPHomeEventScope, visibleCount: Int, totalCount: Int,
        canLoadMore: Bool
    ) -> DIPHomeEventsContent {
        if visibleCount > 0 { return .list }
        switch phase {
        case .loading: return .skeleton
        case .failed(let message): return .failure(message)
        case .ready, .offline:
            if filterActive, scope == .matching, totalCount > 0 { return .emptyFiltered(canLoadMore: canLoadMore) }
            return .emptyAll
        }
    }

    /// Stable key for the area: a change of key is what animates (cards out, new cards in).
    public func key(scope: DIPHomeEventScope) -> String {
        switch self {
        case .skeleton: "skeleton"
        case .failure: "failure"
        case .list: "list.\(scope.rawValue)"
        case .emptyFiltered: "empty.filtered"
        case .emptyAll: "empty.all"
        }
    }
}

/// Card widths for Home's horizontal event row. Exactly two cards share the row in equal columns; any other
/// count keeps the reference card width and scrolls.
public enum DIPHomeCardLayout {
    public static func equalColumnWidth(count: Int, available: Double, spacing: Double = 10) -> Double? {
        guard count == 2, available > spacing * 2 else { return nil }
        return ((available - spacing) / 2).rounded(.down)
    }
}

/// VoiceOver text posted when the filter scope changes.
public enum DIPHomeFilterAnnouncement {
    public static func text(scope: DIPHomeEventScope, shown: Int, total: Int) -> String {
        switch scope {
        case .all:
            return total == 1 ? "All events. 1 event." : "All events. \(total) events."
        case .matching:
            if shown == 0 { return "Matching your interests. No events match." }
            return "Matching your interests. Showing \(shown) of \(total) events."
        }
    }
}

/// The points pill on Rewards. Display only; the client never writes points.
public enum DIPPointsDisplay: Equatable, Sendable {
    case loading
    /// No value could be read and nothing is cached.
    case unavailable
    case balance(Int)
    /// A cached value while offline: shown, but flagged as possibly out of date.
    case stale(Int)

    public func accessibilityLabel(locale: Locale = .current) -> String {
        switch self {
        case .loading: "Loading your points"
        case .unavailable: "Your points are unavailable right now"
        case .balance(let value): "Your balance: \(DIPPointsFormat.balance(value, locale: locale))"
        case .stale(let value):
            "Your balance: \(DIPPointsFormat.balance(value, locale: locale)). Offline, this may be out of date."
        }
    }

    /// The zero-points nudge ("join an event to earn points") only for a confirmed zero balance.
    public var showsZeroNudge: Bool {
        if case .balance(let value) = self { return value <= 0 }
        return false
    }
}
