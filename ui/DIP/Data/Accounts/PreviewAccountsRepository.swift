#if DEBUG
import DIPAccounts
import DIPContracts
import Foundation

/// In-memory `AccountsRepository` for SwiftUI previews only. It mimics the
/// observation flow (identity, then the own-profile listener) closely enough to
/// click through onboarding. It is not evidence about Firebase behavior.
@MainActor
final class PreviewAccountsRepository: AccountsRepository {
    private struct Account {
        let uid: String
        let password: String
        var verified: Bool
        var verificationChecks = 0
    }

    private var accounts: [String: Account] = [
        "member@example.invalid": .init(uid: "member-demo", password: "password", verified: true),
        "new@example.invalid": .init(uid: "new-demo", password: "password", verified: true),
        "unverified@example.invalid": .init(uid: "unverified-demo", password: "password", verified: false),
    ]
    private var profiles: [String: AppUser] = [:]
    private var signedInEmail: String?
    private var continuation: AsyncStream<AccountObservation>.Continuation?
    private let companiesByCode = ["DEMO-2026": "company-demo"]
    private let delay: Duration

    /// `delay` makes loading states visible in previews; tests pass `.zero`.
    init(signedInEmail: String? = nil, delay: Duration = .milliseconds(500)) {
        self.signedInEmail = signedInEmail
        self.delay = delay
        profiles["member-demo"] = Self.profile(uid: "member-demo", companyId: "company-demo", name: "Demo Member", email: "member@example.invalid")
    }

    func observations() -> AsyncStream<AccountObservation> {
        AsyncStream { continuation in
            self.continuation = continuation
            self.publish()
        }
    }

    func signUp(email: String, password: String) async throws {
        try await pause()
        guard email.contains("@"), password.count >= 6 else { throw AccountsFailure.invalidInput }
        guard accounts[email] == nil else { throw AccountsFailure.emailAlreadyInUse }
        accounts[email] = .init(uid: "preview-\(accounts.count + 1)", password: password, verified: false)
        signedInEmail = email
        publish()
    }

    func signIn(email: String, password: String) async throws {
        try await pause()
        guard let account = accounts[email], account.password == password else { throw AccountsFailure.invalidCredentials }
        signedInEmail = email
        publish()
    }

    func signOut() async throws {
        signedInEmail = nil
        publish()
    }

    func sendVerification() async throws {
        try await pause()
        guard signedInEmail != nil else { throw AccountsFailure.unauthenticated }
    }

    /// Simulates the user opening the link: the second check succeeds.
    func refreshIdentity() async throws {
        try await pause()
        guard let email = signedInEmail, var account = accounts[email] else { throw AccountsFailure.unauthenticated }
        account.verificationChecks += 1
        if account.verificationChecks >= 2 { account.verified = true }
        accounts[email] = account
        publish()
    }

    func joinCompany(_ request: JoinCompanyRequest) async throws -> JoinCompanyResponse {
        try await pause()
        guard let email = signedInEmail, let account = accounts[email] else { throw AccountsFailure.unauthenticated }
        guard account.verified else { throw AccountsFailure.permissionDenied }
        guard let companyId = companiesByCode[request.joinCode] else { throw AccountsFailure.invalidJoinCode }
        if let existing = profiles[account.uid], existing.companyId != companyId { throw AccountsFailure.membershipConflict }
        let profile = profiles[account.uid] ?? Self.profile(uid: account.uid, companyId: companyId, name: request.displayName, email: email)
        profiles[account.uid] = profile
        // Like the real listener, membership arrives shortly after the acknowledgement.
        Task { @MainActor [weak self] in
            guard let self else { return }
            try? await Task.sleep(for: self.delay)
            self.publish()
        }
        return .init(contractVersion: 1, companyId: companyId, role: profile.role)
    }

    func updateProfile(_ profile: EditableProfile) async throws {
        try profile.validate()
    }

    private func publish() {
        guard let email = signedInEmail, let account = accounts[email] else {
            continuation?.yield(.identity(nil))
            return
        }
        continuation?.yield(.identity(AccountIdentity(uid: account.uid, isEmailVerified: account.verified)))
        if account.verified {
            continuation?.yield(.profile(uid: account.uid, profiles[account.uid]))
        }
    }

    private func pause() async throws {
        if delay > .zero { try await Task.sleep(for: delay) }
    }

    private static func profile(uid: String, companyId: String, name: String, email: String) -> AppUser {
        AppUser(
            id: uid, companyId: companyId, displayName: name, email: email, photoURL: "", avatarId: "",
            department: "", jobTitle: "", city: "", role: "member", interestTagIds: [], travelRadiusMiles: 20,
            availability: [], friendIds: [], favoritePhotoIds: [], pointsBalance: 0, createdAt: Date(timeIntervalSince1970: 0)
        )
    }
}
#endif
