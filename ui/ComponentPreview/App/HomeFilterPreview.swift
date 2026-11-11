import DIPCore
import DIPMockData
import SwiftUI

/// Review states for Home's interest filter and the points balance, `--home-filter=match|nomatch|unknown`
/// (optionally `--points=<n>`). The fixture member's own interests are replaced so the states are reachable:
/// `match` keeps fitness/outdoors (events tagged for them match), `nomatch` only carpentry (nothing matches),
/// `unknown` only ids the catalog does not know (the control is hidden). The saved scope is a launch
/// default, e.g. `-dip.home.scope.elissa-woode matching`.
struct HomeFilterPreview: View {
    let mode: String

    static func launchMode() -> String? {
        ProcessInfo.processInfo.arguments.first { $0.hasPrefix("--home-filter=") }
            .map { String($0.dropFirst("--home-filter=".count)) }
    }

    private var profile: DIPProfile {
        var profile = DIPMockFixtures.reference.profile
        switch mode {
        case "nomatch": profile.interestTagIDs = ["tag-carpentry"]
        case "unknown": profile.interestTagIDs = ["tag-retired", "tag-gone"]
        default: profile.interestTagIDs = ["tag-fitness", "tag-outdoors"]
        }
        if let points = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix("--points=") }),
           let value = Int(points.dropFirst("--points=".count)) {
            profile.pointsBalance = value
        }
        return profile
    }

    var body: some View {
        DIPPrototypeApp(accountProfile: profile)
    }
}
