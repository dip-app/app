import Foundation
import SwiftUI
import DIPAccounts
import DIPContracts

/// SDK-free fixture for the configured-member composition path, never a real Firebase session.
@MainActor struct MemberEventsPreview: View {
    private let context: MembershipContext
    private let accounts = PreviewAccountsRepository(delay: .zero)
    private let source = MemberEventsPreviewSource()
    init() {
        let profile = AppUser(id: "member-events-preview", companyId: "preview-company", displayName: "Preview Member", email: "member@example.test", photoURL: "", avatarId: "", department: "", jobTitle: "", city: "", role: "member", interestTagIds: [], travelRadiusMiles: 20, availability: [], friendIds: [], favoritePhotoIds: [], pointsBalance: 0, createdAt: .distantPast)
        context = try! MembershipContext(uid: profile.id!, profile: profile)
    }
    var body: some View {
        DIPMemberHome(context: context, repository: accounts, eventReadFactory: { _ in
            MemberEventsRepository(scope: EventReadScope(uid: context.uid, companyID: context.companyID), source: source, currentUID: { context.uid })
        }, onSignOut: {})
    }
}
@MainActor private final class MemberEventsPreviewSource: EventReadSource {
    private let start = Date().addingTimeInterval(86400)
    private func event(_ number: Int) -> DIPContracts.Event {
        DIPContracts.Event(id: "company-event-\(number)", companyId: "preview-company", title: number == 1 ? "Company lunch" : "Company walk", description: "Synthetic company event for member read navigation tests.", tagIds: [], coverImageURL: number == 1 ? "catalog://default/cooking" : "catalog://default/games", startTime: start.addingTimeInterval(Double(number) * 100), endTime: start.addingTimeInterval(3600 + Double(number) * 100), venue: Venue(name: "Company Cafe", address: "1 Test Street", locality: "Pittsburgh", latitude: 40, longitude: -79), costCents: 0, costNote: "", capacity: 20, pointsValue: 0, isOutdoor: false, status: "scheduled", attendeeCount: 0, createdBy: "preview-host", createdAt: .distantPast, revision: 1)
    }
    func feed(scope: EventReadScope, query: EventFeedQuery, after: EventFeedCursor?) async throws -> [DIPContracts.Event] { after == nil ? [event(1), event(2)] : [] }
    func detail(scope: EventReadScope, eventID: String) async throws -> DIPContracts.Event? { [event(1), event(2)].first { $0.id == eventID } }
    func observeDetail(scope: EventReadScope, eventID: String) -> AsyncThrowingStream<DIPContracts.Event?, Error> {
        AsyncThrowingStream { continuation in continuation.yield([event(1), event(2)].first { $0.id == eventID }) }
    }
    func stop() {}
}
