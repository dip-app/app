import Foundation

/// Which upcoming events Home lists. `all` is the default: browsing everything is never lost.
public enum DIPHomeEventScope: String, Equatable, Sendable, CaseIterable {
    case matching
    case all
}

/// Client-side interest filtering of the events already loaded on Home. Pure, order-preserving and free
/// of reads: events come in sorted (start time, then id) and leave in the same order.
public enum DIPInterestFilter {
    /// The member's stored interest ids that the catalog still knows, in stored order without repeats.
    /// Retired or unknown ids are ignored for matching (they stay stored; only the filter skips them).
    /// With no catalog loaded (nil) nothing can be named or trusted, so there are no active interests.
    public static func activeInterests(storedIDs: [String], catalog: [DIPInterest]?) -> [DIPInterest] {
        guard let catalog else { return [] }
        var byID: [String: DIPInterest] = [:]
        for interest in catalog where byID[interest.id] == nil { byID[interest.id] = interest }
        var seen = Set<String>()
        return storedIDs.compactMap { id in
            guard seen.insert(id).inserted, let interest = byID[id] else { return nil }
            return interest
        }
    }

    /// Events carrying at least one of the interest ids (any-match). An event with no tags never
    /// matches an interest filter (it is still listed under All events). Order is preserved.
    public static func matching(_ events: [DIPEventSummary], interestIDs: Set<String>) -> [DIPEventSummary] {
        guard !interestIDs.isEmpty else { return [] }
        return events.filter { event in event.tagIDs.contains { interestIDs.contains($0) } }
    }

    /// What Home shows for a scope. With no active interests the filter cannot apply and everything is shown.
    public static func visibleEvents(
        _ events: [DIPEventSummary], scope: DIPHomeEventScope, activeInterests: [DIPInterest]
    ) -> (events: [DIPEventSummary], isFiltering: Bool) {
        guard scope == .matching, !activeInterests.isEmpty else { return (events, false) }
        return (matching(events, interestIDs: Set(activeInterests.map(\.id))), true)
    }
}

/// The member's last chosen scope, kept on this device per user (never written to a server).
public struct DIPHomeScopeStore {
    private let defaults: UserDefaults
    public init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    static func key(uid: String) -> String { "dip.home.scope.\(uid)" }

    /// `all` when nothing was saved, the value is unknown, or the uid is empty.
    public func scope(uid: String) -> DIPHomeEventScope {
        guard !uid.isEmpty, let raw = defaults.string(forKey: Self.key(uid: uid)),
              let scope = DIPHomeEventScope(rawValue: raw) else { return .all }
        return scope
    }

    public func save(_ scope: DIPHomeEventScope, uid: String) {
        guard !uid.isEmpty else { return }
        defaults.set(scope.rawValue, forKey: Self.key(uid: uid))
    }
}
