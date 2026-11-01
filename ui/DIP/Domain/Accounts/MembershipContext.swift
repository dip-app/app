import Foundation

/// The signed-in member's tenant context, for other features (events, My Events,
/// organizer). Read companyId and uid from here instead of hardcoding or asking
/// the user. UI may use `role` to show or hide organizer entry points, but the
/// server still authorizes every command: this is not an authorization check.
struct ActiveMembership: Equatable, Sendable {
    let uid: String
    let companyId: String
    let role: MembershipRole
}

/// Observable provider of the current membership. `nil` means not ready
/// (signed out, unverified, not yet joined, or still loading). Consumers must
/// drop tenant data and listeners when it changes to nil or to another uid.
@MainActor
protocol MembershipContext: AnyObject {
    var activeMembership: ActiveMembership? { get }
}
