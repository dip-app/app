import Testing
import Foundation
import DIPContracts
@testable import DIPAccounts

@MainActor private final class FakeRepository: AccountsRepository {
    var continuation: AsyncStream<AccountObservation>.Continuation?
    var nextFailure: AccountsFailure?
    var resolveFailure: AccountsFailure?
    var resolves = 0
    var googleSignIns = 0
    var terminated = false
    var suspendSignIn = false
    var suspendSignOut = false
    var pendingCommand: CheckedContinuation<Void, any Error>?
    func observations() -> AsyncStream<AccountObservation> {
        AsyncStream { continuation in
            self.continuation = continuation
            continuation.onTermination = { [weak self] _ in Task { @MainActor in self?.terminated = true } }
        }
    }
    func checked() throws { if let nextFailure { self.nextFailure = nil; throw nextFailure } }
    func signInWithGoogle() async throws {
        googleSignIns += 1
        if suspendSignIn { try await withCheckedThrowingContinuation { pendingCommand = $0 } }
        try checked()
    }
    func signOut() async throws {
        if suspendSignOut { try await withCheckedThrowingContinuation { pendingCommand = $0 } }
        try checked()
    }
    func refreshIdentity() async throws { try checked() }
    func updateProfile(uid: String, _ profile: EditableProfile) async throws { try profile.validate(); try checked() }
    func resolveMembership() async throws -> ResolveMembershipResponse {
        resolves += 1
        if let resolveFailure { throw resolveFailure }
        return .init(contractVersion: 1, companyId: "company", role: "member")
    }
    func emit(_ observation: AccountObservation) async { continuation?.yield(observation); await settle() }
    func settle() async { for _ in 0..<20 { await Task.yield() } }
}
private func profile(_ uid: String = "one", company: String = "company", role: String = "member") -> AppUser {
    .init(id: uid, companyId: company, displayName: "Person", email: "synthetic@example.test", photoURL: "", avatarId: "", department: "", jobTitle: "", city: "", role: role, interestTagIds: [], travelRadiusMiles: 20, availability: [], friendIds: [], favoritePhotoIds: [], pointsBalance: 0, createdAt: Date(timeIntervalSince1970: 0))
}
private let verified = AccountIdentity(uid: "one", isEmailVerified: true)

@Test @MainActor func observedMembershipAndIdentityChanges() async {
    let fake = FakeRepository(); let session = AccountsSession(repository: fake); session.start()
    #expect(session.state == .authenticationPending)
    await fake.emit(.identity(nil)); #expect(session.state == .signedOut)
    let unverified = AccountIdentity(uid: "one", isEmailVerified: false)
    await fake.emit(.identity(unverified)); #expect(session.state == .noCompany(unverified, .permissionDenied))
    await fake.emit(.profile(uid: "one", nil)); #expect(fake.resolves == 0) // unverified never resolves
    await fake.emit(.identity(verified)); #expect(session.state == .authenticationPending)
    await fake.emit(.profile(uid: "one", nil))
    #expect(fake.resolves == 1)
    #expect(session.state == .resolvingCompany(verified)) // acknowledgement is not membership
    await fake.emit(.profile(uid: "one", nil)); #expect(fake.resolves == 1) // no repeat for the same identity
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
@Test @MainActor func domainFailuresBecomeNoCompanyAndNeverMembership() async {
    for failure in [AccountsFailure.personalEmailDomain, .noCompanyForDomain, .membershipConflict, .permissionDenied] {
        let fake = FakeRepository(); fake.resolveFailure = failure
        let session = AccountsSession(repository: fake); session.start()
        await fake.emit(.identity(verified)); await fake.emit(.profile(uid: "one", nil))
        #expect(session.state == .noCompany(verified, failure))
        await fake.emit(.profile(uid: "one", nil)) // listener repeats must not flap or re-resolve
        #expect(session.state == .noCompany(verified, failure)); #expect(fake.resolves == 1)
        session.stop()
    }
    let fake = FakeRepository(); fake.resolveFailure = .unavailable
    let session = AccountsSession(repository: fake); session.start()
    await fake.emit(.identity(verified)); await fake.emit(.profile(uid: "one", nil))
    #expect(session.state == .recoverableError(.unavailable))
    session.stop()
}
@Test @MainActor func retryMembershipResolvesAgain() async {
    let fake = FakeRepository(); fake.resolveFailure = .noCompanyForDomain
    let session = AccountsSession(repository: fake); session.start()
    await fake.emit(.identity(verified)); await fake.emit(.profile(uid: "one", nil))
    #expect(session.state == .noCompany(verified, .noCompanyForDomain))
    fake.resolveFailure = nil
    await session.retryMembership(); await fake.settle()
    #expect(fake.resolves == 2); #expect(session.state == .resolvingCompany(verified))
    await fake.emit(.profile(uid: "one", profile()))
    #expect(session.state == .member(try! MembershipContext(uid: "one", profile: profile())))
    session.stop()
}
@Test @MainActor func googleSignInCancelIsNotAnError() async {
    let fake = FakeRepository(); let session = AccountsSession(repository: fake); session.start()
    await fake.emit(.identity(nil))
    fake.nextFailure = .cancelled
    await session.signInWithGoogle()
    #expect(session.commandError == nil); #expect(session.state == .signedOut); #expect(fake.googleSignIns == 1)
    fake.nextFailure = .notConfigured
    await session.signInWithGoogle()
    #expect(session.commandError == .notConfigured); #expect(session.state == .recoverableError(.notConfigured))
    await session.signInWithGoogle(); #expect(session.commandError == nil)
    session.stop()
}
@Test @MainActor func malformedProfileAndListenerFailureClearTenant() async {
    let fake = FakeRepository(); let session = AccountsSession(repository: fake); session.start()
    await fake.emit(.identity(verified))
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
    session.stop(); await fake.settle(); #expect(fake.terminated)
}
@Test func editableFieldValidation() throws {
    var edit = EditableProfile(photoURL: "", avatarId: "", department: "", jobTitle: "", city: "", interestTagIds: ["tag"], travelRadiusMiles: 20, availability: [])
    try edit.validate()
    edit.travelRadiusMiles = 501; #expect(throws: AccountsFailure.invalidInput) { try edit.validate() }
    edit.travelRadiusMiles = 0; edit.city = String(repeating: "c", count: 121); #expect(throws: AccountsFailure.invalidInput) { try edit.validate() }
    edit.city = ""; edit.interestTagIds = [""]; #expect(throws: AccountsFailure.invalidInput) { try edit.validate() }
}
@Test @MainActor func successfulSignOutAndObservationRestart() async {
    let fake = FakeRepository(); let session = AccountsSession(repository: fake); session.start()
    await fake.emit(.identity(verified))
    await fake.emit(.profile(uid: "one", profile()))
    await session.signOut(); #expect(session.state == .signedOut)
    await fake.emit(.profile(uid: "one", profile())); #expect(session.state == .signedOut)
    session.stop(); await fake.settle(); #expect(fake.terminated)
    fake.terminated = false; session.start()
    let two = AccountIdentity(uid: "two", isEmailVerified: true)
    await fake.emit(.identity(two))
    await fake.emit(.profile(uid: "two", nil))
    #expect(session.state == .resolvingCompany(two))
    session.stop()
}
@Test func profileListLimitsAndMembershipScope() throws {
    var edit = EditableProfile(photoURL: "", avatarId: "", department: "", jobTitle: "", city: "", interestTagIds: Array(repeating: "tag", count: 10), travelRadiusMiles: 500, availability: Array(repeating: "day", count: 10))
    try edit.validate()
    edit.interestTagIds.append("extra"); #expect(throws: AccountsFailure.invalidInput) { try edit.validate() }
    edit.interestTagIds = []; edit.availability.append("extra"); #expect(throws: AccountsFailure.invalidInput) { try edit.validate() }
    #expect(throws: AccountsFailure.invalidProfile) { try MembershipContext(uid: "one", profile: profile(company: " ")) }
    #expect(throws: AccountsFailure.invalidProfile) { try MembershipContext(uid: "", profile: profile("")) }
}
@Test @MainActor func unexpectedStreamCompletionClearsMemberAndRestartSurvivesOldCompletion() async {
    let fake = FakeRepository(); let session = AccountsSession(repository: fake); session.start()
    await fake.emit(.identity(verified))
    await fake.emit(.profile(uid: "one", profile()))
    fake.continuation?.finish()
    await fake.settle()
    #expect(session.state == .recoverableError(.unavailable))
    session.start()
    let oldContinuation = fake.continuation
    session.start()
    oldContinuation?.finish()
    await fake.emit(.identity(.init(uid: "two", isEmailVerified: true)))
    await fake.emit(.profile(uid: "two", profile("two")))
    #expect(session.state == .member(try! MembershipContext(uid: "two", profile: profile("two"))))
    session.stop()
    await fake.settle()
    #expect(session.state == .signedOut)
}
@Test @MainActor func oldCommandFailureCannotOverrideRestartedSession() async {
    let fake = FakeRepository(); let session = AccountsSession(repository: fake); session.start()
    fake.suspendSignIn = true
    let oldCommand = Task { await session.signInWithGoogle() }
    while fake.pendingCommand == nil { await Task.yield() }
    #expect(session.isSubmitting)
    session.stop(); session.start()
    await fake.emit(.identity(.init(uid: "two", isEmailVerified: true)))
    await fake.emit(.profile(uid: "two", profile("two")))
    fake.pendingCommand?.resume(throwing: AccountsFailure.unavailable); fake.pendingCommand = nil
    await oldCommand.value
    #expect(session.commandError == nil); #expect(!session.isSubmitting)
    #expect(session.state == .member(try! MembershipContext(uid: "two", profile: profile("two"))))
    session.stop()
}
@Test @MainActor func oldSignOutSuccessCannotClearNewMemberOrNewSubmission() async {
    let fake = FakeRepository(); let session = AccountsSession(repository: fake); session.start()
    fake.suspendSignOut = true
    let oldCommand = Task { await session.signOut() }
    while fake.pendingCommand == nil { await Task.yield() }
    let oldContinuation = fake.pendingCommand; fake.pendingCommand = nil
    session.stop(); session.start()
    await fake.emit(.identity(.init(uid: "two", isEmailVerified: true)))
    await fake.emit(.profile(uid: "two", profile("two")))
    fake.suspendSignIn = true
    let newCommand = Task { await session.signInWithGoogle() }
    while fake.pendingCommand == nil { await Task.yield() }
    oldContinuation?.resume()
    await oldCommand.value
    #expect(session.isSubmitting)
    #expect(session.state == .member(try! MembershipContext(uid: "two", profile: profile("two"))))
    fake.pendingCommand?.resume(); fake.pendingCommand = nil
    await newCommand.value
    #expect(session.commandError == nil); #expect(!session.isSubmitting)
    session.stop()
}
@Test @MainActor func staleResolutionFailureCannotAffectNewIdentity() async {
    let fake = FakeRepository(); fake.resolveFailure = .noCompanyForDomain
    let session = AccountsSession(repository: fake); session.start()
    await fake.emit(.identity(verified))
    fake.continuation?.yield(.profile(uid: "one", nil)) // starts resolution without settling
    let two = AccountIdentity(uid: "two", isEmailVerified: true)
    await fake.emit(.identity(two))
    await fake.emit(.profile(uid: "two", profile("two")))
    #expect(session.state == .member(try! MembershipContext(uid: "two", profile: profile("two"))))
    session.stop()
}
