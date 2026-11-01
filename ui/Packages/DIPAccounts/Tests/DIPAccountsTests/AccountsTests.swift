import Testing
import Foundation
import DIPContracts
@testable import DIPAccounts

@MainActor private final class FakeRepository: AccountsRepository {
    var continuation: AsyncStream<AccountObservation>.Continuation?
    var nextFailure: AccountsFailure?
    var joins: [JoinCompanyRequest] = []
    var terminated = false
    func observations() -> AsyncStream<AccountObservation> {
        AsyncStream { continuation in
            self.continuation = continuation
            continuation.onTermination = { [weak self] _ in Task { @MainActor in self?.terminated = true } }
        }
    }
    func checked() throws { if let nextFailure { self.nextFailure = nil; throw nextFailure } }
    func signUp(email: String, password: String) async throws { try checked() }
    func signIn(email: String, password: String) async throws { try checked() }
    func signOut() async throws { try checked() }
    func sendVerification() async throws { try checked() }
    func refreshIdentity() async throws { try checked() }
    func updateProfile(_ profile: EditableProfile) async throws { try profile.validate(); try checked() }
    func joinCompany(_ request: JoinCompanyRequest) async throws -> JoinCompanyResponse {
        joins.append(request); try checked()
        return .init(contractVersion: 1, companyId: "company", role: "member")
    }
    func emit(_ observation: AccountObservation) async { continuation?.yield(observation); for _ in 0..<10 { await Task.yield() } }
}
private func profile(_ uid: String = "one", company: String = "company", role: String = "member") -> AppUser {
    .init(id: uid, companyId: company, displayName: "Person", email: "synthetic@example.test", photoURL: "", avatarId: "", department: "", jobTitle: "", city: "", role: role, interestTagIds: [], travelRadiusMiles: 20, availability: [], friendIds: [], favoritePhotoIds: [], pointsBalance: 0, createdAt: Date(timeIntervalSince1970: 0))
}
@Test @MainActor func observedMembershipAndIdentityChanges() async {
    let fake = FakeRepository(); let session = AccountsSession(repository: fake); session.start()
    #expect(session.state == .authenticationPending)
    await fake.emit(.identity(nil)); #expect(session.state == .signedOut)
    let unverified = AccountIdentity(uid: "one", isEmailVerified: false)
    await fake.emit(.identity(unverified)); #expect(session.state == .verificationRequired(unverified))
    await session.joinCompany(code: " code ", displayName: "Person"); #expect(fake.joins.isEmpty)
    let verified = AccountIdentity(uid: "one", isEmailVerified: true)
    await fake.emit(.identity(verified)); #expect(session.state == .authenticationPending)
    await fake.emit(.profile(uid: "one", nil)); #expect(session.state == .needsCompany(verified))
    await session.joinCompany(code: " code ", displayName: "Person")
    #expect(fake.joins.first?.joinCode == "CODE")
    #expect(session.state == .needsCompany(verified)) // acknowledgement is not membership
    await fake.emit(.profile(uid: "one", profile()))
    #expect(session.state == .member(try! MembershipContext(uid: "one", profile: profile())))
    await fake.emit(.identity(.init(uid: "two", isEmailVerified: true)))
    #expect(session.state == .authenticationPending)
    await fake.emit(.profile(uid: "one", profile())); #expect(session.state == .authenticationPending)
    await fake.emit(.failure(uid: "one", .permissionDenied)); #expect(session.state == .authenticationPending)
    await fake.emit(.failure(uid: "two", .unavailable)); #expect(session.state == .recoverableError(.unavailable))
    await fake.emit(.identity(nil)); #expect(session.state == .signedOut)
    session.stop()
}
@Test @MainActor func commandFailuresRetryWithoutFabricatingState() async {
    let fake = FakeRepository(); let session = AccountsSession(repository: fake); session.start()
    let identity = AccountIdentity(uid: "one", isEmailVerified: true)
    await fake.emit(.identity(identity)); await fake.emit(.profile(uid: "one", nil))
    fake.nextFailure = .invalidJoinCode
    await session.joinCompany(code: "bad", displayName: "Person")
    #expect(session.commandError == .invalidJoinCode); #expect(session.state == .needsCompany(identity))
    await session.joinCompany(code: "good", displayName: "Person")
    #expect(session.commandError == nil); #expect(fake.joins.count == 2)
    fake.nextFailure = .invalidCredentials
    await session.signIn(email: "synthetic@example.test", password: "test")
    #expect(session.commandError == .invalidCredentials)
    await session.signIn(email: "synthetic@example.test", password: "test"); #expect(session.commandError == nil)
    await session.signUp(email: "synthetic@example.test", password: "test")
    await session.sendVerification(); await session.refreshIdentity()
    session.stop()
}
@Test @MainActor func malformedProfileAndListenerFailureClearTenant() async {
    let fake = FakeRepository(); let session = AccountsSession(repository: fake); session.start()
    await fake.emit(.identity(.init(uid: "one", isEmailVerified: true)))
    await fake.emit(.profile(uid: "one", profile()))
    await fake.emit(.failure(uid: "one", .permissionDenied))
    #expect(session.state == .recoverableError(.permissionDenied))
    await fake.emit(.profile(uid: "one", profile(role: "owner")))
    #expect(session.state == .recoverableError(.invalidProfile))
    await fake.emit(.profile(uid: "one", profile("two")))
    #expect(session.state == .recoverableError(.invalidProfile))
    await fake.emit(.profile(uid: "one", profile()))
    fake.nextFailure = .unavailable; await session.signOut()
    #expect(session.state == .recoverableError(.unavailable))
    await fake.emit(.profile(uid: "one", profile()))
    #expect(session.state == .recoverableError(.unavailable))
    session.stop(); for _ in 0..<20 { await Task.yield() }; #expect(fake.terminated)
}
@Test func editableFieldValidation() throws {
    var edit = EditableProfile(displayName: "Name", photoURL: "", avatarId: "", department: "", jobTitle: "", city: "", interestTagIds: ["tag"], travelRadiusMiles: 20, availability: [])
    try edit.validate()
    edit.travelRadiusMiles = 501; #expect(throws: AccountsFailure.invalidInput) { try edit.validate() }
    edit.travelRadiusMiles = 0; edit.displayName = " "; #expect(throws: AccountsFailure.invalidInput) { try edit.validate() }
    edit.displayName = "Name"; edit.interestTagIds = [""]; #expect(throws: AccountsFailure.invalidInput) { try edit.validate() }
}

@Test @MainActor func successfulSignOutAndObservationRestart() async {
    let fake = FakeRepository(); let session = AccountsSession(repository: fake); session.start()
    await fake.emit(.identity(.init(uid: "one", isEmailVerified: true)))
    await fake.emit(.profile(uid: "one", profile()))
    await session.signOut(); #expect(session.state == .signedOut)
    await fake.emit(.profile(uid: "one", profile())); #expect(session.state == .signedOut)
    session.stop(); for _ in 0..<20 { await Task.yield() }; #expect(fake.terminated)
    fake.terminated = false; session.start()
    await fake.emit(.identity(.init(uid: "two", isEmailVerified: true)))
    await fake.emit(.profile(uid: "two", nil))
    #expect(session.state == .needsCompany(.init(uid: "two", isEmailVerified: true)))
    session.stop()
}
@Test func profileListLimitsAndMembershipScope() throws {
    var edit = EditableProfile(displayName: "Name", photoURL: "", avatarId: "", department: "", jobTitle: "", city: "", interestTagIds: Array(repeating: "tag", count: 10), travelRadiusMiles: 500, availability: Array(repeating: "day", count: 10))
    try edit.validate()
    edit.interestTagIds.append("extra"); #expect(throws: AccountsFailure.invalidInput) { try edit.validate() }
    edit.interestTagIds = []; edit.availability.append("extra"); #expect(throws: AccountsFailure.invalidInput) { try edit.validate() }
    #expect(throws: AccountsFailure.invalidProfile) { try MembershipContext(uid: "one", profile: profile(company: " ")) }
    #expect(throws: AccountsFailure.invalidProfile) { try MembershipContext(uid: "", profile: profile("")) }
}
