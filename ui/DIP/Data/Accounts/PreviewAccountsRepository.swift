import DIPAccounts
import DIPContracts
import Foundation

/// In-memory `AccountsRepository` for previews, tests and Debug builds without Firebase
/// configuration. "Continue with Google" signs in as `googleAccount` (nil = not configured)
/// and mimics resolveMembershipV1's domain rules closely enough to click through
/// onboarding. It is not evidence about Firebase behavior.
@MainActor
final class PreviewAccountsRepository: AccountsRepository, InterestCatalogRepository {
    static let companiesByDomain = ["example.invalid": "company-demo"]
    static let personalDomains: Set<String> = ["gmail.com", "icloud.com", "outlook.com", "yahoo.com"]

    private let googleAccount: String?
    private let delay: Duration
    private var signedInEmail: String?
    private var profiles: [String: AppUser] = [:]
    private var continuation: AsyncStream<AccountObservation>.Continuation?

    init(
        googleAccount: String? = "new@example.invalid", signedInEmail: String? = nil,
        delay: Duration = .milliseconds(600)
    ) {
        self.googleAccount = googleAccount
        self.signedInEmail = signedInEmail
        self.delay = delay
        profiles[Self.uid(for: "member@example.invalid")] = Self.profile(
            email: "member@example.invalid", name: "Sam Rivera", companyId: "company-demo")
    }

    func observations() -> AsyncStream<AccountObservation> {
        AsyncStream { continuation in
            self.continuation = continuation
            self.publish()
        }
    }

    func signInWithGoogle() async throws {
        guard let googleAccount else { throw AccountsFailure.notConfigured }
        try await pause()
        signedInEmail = googleAccount
        publish()
    }

    func signOut() async throws {
        signedInEmail = nil
        publish()
    }

    func refreshIdentity() async throws {
        guard signedInEmail != nil else { throw AccountsFailure.unauthenticated }
        publish()
    }

    func resolveMembership() async throws -> ResolveMembershipResponse {
        guard let email = signedInEmail else { throw AccountsFailure.unauthenticated }
        try await pause()
        let domain = String(email.split(separator: "@").last ?? "").lowercased()
        guard !Self.personalDomains.contains(domain) else { throw AccountsFailure.personalEmailDomain }
        guard let companyId = Self.companiesByDomain[domain] else { throw AccountsFailure.noCompanyForDomain }
        let uid = Self.uid(for: email)
        if let existing = profiles[uid], existing.companyId != companyId { throw AccountsFailure.membershipConflict }
        let profile = profiles[uid] ?? Self.profile(email: email, name: Self.name(for: email), companyId: companyId)
        profiles[uid] = profile
        // Like the real listener, membership arrives shortly after the acknowledgement.
        Task { @MainActor [weak self] in
            guard let self else { return }
            try? await self.pause()
            self.publish()
        }
        return .init(contractVersion: 1, companyId: companyId, role: profile.role)
    }

    func updateProfile(uid: String, _ profile: EditableProfile) async throws {
        guard let email = signedInEmail, Self.uid(for: email) == uid, let stored = profiles[uid] else {
            throw AccountsFailure.unauthenticated
        }
        try profile.validate()
        try await pause()
        profiles[uid] = profile.applied(to: stored)
        publish()
    }

    /// Synthetic catalog shaped like `tags/{tagId}`; ids are not real Firestore ids.
    static let interestCatalog: [InterestTag] = [
        .init(id: "tag-fitness", name: "Fitness", icon: "🏋️", sortOrder: 1),
        .init(id: "tag-outdoors", name: "Outdoors", icon: "🥾", sortOrder: 2),
        .init(id: "tag-social", name: "Social", icon: "🎉", sortOrder: 3),
        .init(id: "tag-food", name: "Food & Drink", icon: "🍜", sortOrder: 4),
        .init(id: "tag-arts", name: "Arts", icon: "🎨", sortOrder: 5),
        .init(id: "tag-wellness", name: "Wellness", icon: "🧘", sortOrder: 6),
    ]

    func interestTags() async throws -> [InterestTag] {
        guard signedInEmail != nil else { throw AccountsFailure.unauthenticated }
        try await pause()
        return Self.interestCatalog
    }

    private func publish() {
        guard let email = signedInEmail else {
            continuation?.yield(.identity(nil))
            return
        }
        let uid = Self.uid(for: email)
        continuation?.yield(.identity(AccountIdentity(uid: uid, isEmailVerified: true)))
        continuation?.yield(.profile(uid: uid, profiles[uid]))
    }

    private func pause() async throws {
        if delay > .zero { try await Task.sleep(for: delay) }
    }

    private static func uid(for email: String) -> String { "preview-" + email.lowercased() }
    /// Realistic synthetic names, as Google would supply (no real people).
    private static func name(for email: String) -> String {
        let names = ["new@example.invalid": "Jordan Lee", "pat@gmail.com": "Pat Kim", "pat@unknown.test": "Pat Kim"]
        return names[email.lowercased()] ?? "Sam Rivera"
    }
    private static func profile(email: String, name: String, companyId: String) -> AppUser {
        AppUser(id: uid(for: email), companyId: companyId, displayName: name, email: email, photoURL: "", avatarId: "",
                department: "", jobTitle: "", city: "", role: "member", interestTagIds: [], travelRadiusMiles: 20,
                availability: [], friendIds: [], favoritePhotoIds: [], pointsBalance: 0,
                createdAt: Date(timeIntervalSince1970: 0))
    }
}
