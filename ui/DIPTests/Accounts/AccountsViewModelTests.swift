import XCTest
@testable import DIP

/// State-transition tests for the accounts flow, against the in-memory fakes.
final class AccountsViewModelTests: XCTestCase {
    private struct Harness: Sendable {
        let auth: FakeAuthService
        let memberships: FakeMembershipService
        let viewModel: AccountsViewModel
    }

    @MainActor
    private func makeHarness(
        accounts: [String: FakeAuthService.Account] = [
            "member@example.invalid": .init(uid: "u-member", password: "secret1", isEmailVerified: true),
            "fresh@example.invalid": .init(uid: "u-fresh", password: "secret1", isEmailVerified: true),
            "unverified@example.invalid": .init(uid: "u-unverified", password: "secret1", isEmailVerified: false),
            "other@example.invalid": .init(uid: "u-other", password: "secret1", isEmailVerified: true),
        ],
        signedInEmail: String? = nil
    ) -> Harness {
        let auth = FakeAuthService(accounts: accounts, signedInEmail: signedInEmail)
        let memberships = FakeMembershipService(
            auth: auth,
            companiesByCode: ["DEMO-2026": "company-demo", "OTHER-1": "company-other"],
            memberships: [
                "u-member": Membership(companyId: "company-demo", role: .member),
                "u-other": Membership(companyId: "company-other", role: .admin),
            ]
        )
        return Harness(auth: auth, memberships: memberships, viewModel: AccountsViewModel(auth: auth, memberships: memberships))
    }

    /// Waits (bounded) until `condition` holds on the main actor.
    @MainActor
    private func eventually(_ condition: () async -> Bool, file: StaticString = #filePath, line: UInt = #line) async {
        for _ in 0..<1_000 {
            if await condition() { return }
            await Task.yield()
        }
        XCTFail("condition never became true", file: file, line: line)
    }

    // MARK: Restoring a session

    @MainActor
    func testStartsRestoringThenSignedOutWithNoSession() async {
        let h = makeHarness()
        XCTAssertEqual(h.viewModel.phase, .restoring)
        XCTAssertNil(h.viewModel.activeMembership)
        await h.viewModel.restoreSession()
        XCTAssertEqual(h.viewModel.phase, .signedOut)
        XCTAssertFalse(h.viewModel.isWorking)
    }

    @MainActor
    func testRestoresPersistedMemberSession() async {
        let h = makeHarness(signedInEmail: "member@example.invalid")
        await h.viewModel.restoreSession()
        let expected = ActiveMembership(uid: "u-member", companyId: "company-demo", role: .member)
        XCTAssertEqual(h.viewModel.phase, .member(expected))
        XCTAssertEqual(h.viewModel.activeMembership, expected)
    }

    @MainActor
    func testRestoresUnverifiedSessionToVerification() async {
        let h = makeHarness(signedInEmail: "unverified@example.invalid")
        await h.viewModel.restoreSession()
        XCTAssertEqual(h.viewModel.phase, .verificationRequired(email: "unverified@example.invalid"))
        XCTAssertNil(h.viewModel.activeMembership)
    }

    @MainActor
    func testMembershipLoadFailureIsRecoverable() async {
        let h = makeHarness(signedInEmail: "member@example.invalid")
        await h.memberships.setNextError(.network)
        await h.viewModel.restoreSession()
        guard case .membershipUnavailable(let user) = h.viewModel.phase else {
            return XCTFail("expected membershipUnavailable, got \(h.viewModel.phase)")
        }
        XCTAssertEqual(user.uid, "u-member")
        XCTAssertEqual(h.viewModel.error, .network)
        XCTAssertNil(h.viewModel.activeMembership)

        await h.viewModel.retryLoadingMembership()
        XCTAssertEqual(h.viewModel.phase, .member(ActiveMembership(uid: "u-member", companyId: "company-demo", role: .member)))
        XCTAssertNil(h.viewModel.error)
    }

    // MARK: Sign in / sign up

    @MainActor
    func testSignInRoutesVerifiedUserWithoutCompanyToJoin() async {
        let h = makeHarness()
        await h.viewModel.signIn(email: "  fresh@example.invalid ", password: "secret1")
        guard case .needsMembership(let user) = h.viewModel.phase else {
            return XCTFail("expected needsMembership, got \(h.viewModel.phase)")
        }
        XCTAssertEqual(user.uid, "u-fresh")
        XCTAssertNil(h.viewModel.activeMembership)
    }

    @MainActor
    func testSignInWithWrongPasswordStaysSignedOutWithError() async {
        let h = makeHarness()
        await h.viewModel.restoreSession()
        await h.viewModel.signIn(email: "member@example.invalid", password: "wrong")
        XCTAssertEqual(h.viewModel.phase, .signedOut)
        XCTAssertEqual(h.viewModel.error, .invalidCredentials)
        XCTAssertFalse(h.viewModel.isWorking)
    }

    @MainActor
    func testSignInValidatesEmptyFieldsWithoutCallingAuth() async {
        let h = makeHarness()
        await h.viewModel.signIn(email: "   ", password: "secret1")
        XCTAssertEqual(h.viewModel.error, .validation(.email))
        await h.viewModel.signIn(email: "member@example.invalid", password: "")
        XCTAssertEqual(h.viewModel.error, .validation(.password))
        XCTAssertEqual(h.viewModel.phase, .restoring, "no request was made")
    }

    @MainActor
    func testSignUpRequiresVerificationAndSendsEmail() async {
        let h = makeHarness()
        await h.viewModel.signUp(email: "brand-new@example.invalid", password: "secret1")
        XCTAssertEqual(h.viewModel.phase, .verificationRequired(email: "brand-new@example.invalid"))
        let sent = await h.auth.verificationEmailsSent
        XCTAssertEqual(sent, 1)
        XCTAssertNil(h.viewModel.activeMembership)
    }

    @MainActor
    func testSignUpRejectsShortPasswordLocally() async {
        let h = makeHarness()
        await h.viewModel.signUp(email: "brand-new@example.invalid", password: "123")
        XCTAssertEqual(h.viewModel.error, .weakPassword)
        let user = await h.auth.currentUser()
        XCTAssertNil(user, "no account was created")
    }

    @MainActor
    func testSignUpWithExistingEmailShowsError() async {
        let h = makeHarness()
        await h.viewModel.signUp(email: "member@example.invalid", password: "secret1")
        XCTAssertEqual(h.viewModel.error, .emailAlreadyInUse)
        XCTAssertEqual(h.viewModel.phase, .restoring)
    }

    // MARK: Verification

    @MainActor
    func testCheckVerificationStaysUntilVerifiedThenRoutes() async {
        let h = makeHarness()
        await h.viewModel.signIn(email: "unverified@example.invalid", password: "secret1")
        XCTAssertEqual(h.viewModel.phase, .verificationRequired(email: "unverified@example.invalid"))

        await h.viewModel.checkVerification()
        XCTAssertEqual(h.viewModel.error, .emailNotVerified)
        XCTAssertEqual(h.viewModel.phase, .verificationRequired(email: "unverified@example.invalid"))

        await h.auth.markVerified(email: "unverified@example.invalid")
        await h.viewModel.checkVerification()
        XCTAssertNil(h.viewModel.error)
        guard case .needsMembership = h.viewModel.phase else {
            return XCTFail("expected needsMembership, got \(h.viewModel.phase)")
        }
    }

    @MainActor
    func testResendVerificationEmail() async {
        let h = makeHarness()
        await h.viewModel.signIn(email: "unverified@example.invalid", password: "secret1")
        await h.viewModel.resendVerificationEmail()
        let sent = await h.auth.verificationEmailsSent
        XCTAssertEqual(sent, 1)
    }

    // MARK: Joining a company

    @MainActor
    func testJoinWithValidCodeBecomesMember() async {
        let h = makeHarness()
        await h.viewModel.signIn(email: "fresh@example.invalid", password: "secret1")
        await h.viewModel.joinCompany(joinCode: " demo-2026 ", displayName: " Pat Lee ")
        XCTAssertEqual(h.viewModel.phase, .member(ActiveMembership(uid: "u-fresh", companyId: "company-demo", role: .member)))
        XCTAssertNil(h.viewModel.error)
        XCTAssertFalse(h.viewModel.isWorking)
    }

    @MainActor
    func testFailedJoinIsNeverMarkedJoined() async {
        let h = makeHarness()
        await h.viewModel.signIn(email: "fresh@example.invalid", password: "secret1")
        for (failure, expected) in [(nil, AccountsError.invalidJoinCode), (.network, .network), (.rateLimited, .rateLimited)] as [(AccountsError?, AccountsError)] {
            await h.memberships.setNextError(failure)
            await h.viewModel.joinCompany(joinCode: failure == nil ? "WRONG" : "DEMO-2026", displayName: "Pat")
            XCTAssertEqual(h.viewModel.error, expected)
            XCTAssertNil(h.viewModel.activeMembership)
            guard case .needsMembership = h.viewModel.phase else {
                return XCTFail("expected needsMembership after \(expected), got \(h.viewModel.phase)")
            }
        }
    }

    @MainActor
    func testJoinConflictLeavesUserOnJoinStep() async {
        // The server refuses when the account already belongs to another company
        // (e.g. a stale screen); the app must surface it and not become a member.
        let h = makeHarness()
        await h.viewModel.signIn(email: "fresh@example.invalid", password: "secret1")
        await h.memberships.setNextError(.membershipConflict)
        await h.viewModel.joinCompany(joinCode: "DEMO-2026", displayName: "Pat")
        XCTAssertEqual(h.viewModel.error, .membershipConflict)
        XCTAssertNil(h.viewModel.activeMembership)
        guard case .needsMembership = h.viewModel.phase else {
            return XCTFail("expected needsMembership, got \(h.viewModel.phase)")
        }
    }

    @MainActor
    func testServerUnverifiedResponseReturnsToVerification() async {
        let h = makeHarness()
        await h.viewModel.signIn(email: "fresh@example.invalid", password: "secret1")
        await h.memberships.setNextError(.emailNotVerified)
        await h.viewModel.joinCompany(joinCode: "DEMO-2026", displayName: "Pat")
        XCTAssertEqual(h.viewModel.phase, .verificationRequired(email: "fresh@example.invalid"))
        XCTAssertEqual(h.viewModel.error, .emailNotVerified)
    }

    @MainActor
    func testJoinValidatesInputWithoutCallingServer() async {
        let h = makeHarness()
        await h.viewModel.signIn(email: "fresh@example.invalid", password: "secret1")
        await h.viewModel.joinCompany(joinCode: "   ", displayName: "Pat")
        XCTAssertEqual(h.viewModel.error, .validation(.joinCode))
        await h.viewModel.joinCompany(joinCode: String(repeating: "X", count: 65), displayName: "Pat")
        XCTAssertEqual(h.viewModel.error, .validation(.joinCode))
        await h.viewModel.joinCompany(joinCode: "DEMO-2026", displayName: "  ")
        XCTAssertEqual(h.viewModel.error, .validation(.displayName))
        await h.viewModel.joinCompany(joinCode: "DEMO-2026", displayName: String(repeating: "n", count: 81))
        XCTAssertEqual(h.viewModel.error, .validation(.displayName))
        let calls = await h.memberships.joinCallCount
        XCTAssertEqual(calls, 0)
    }

    @MainActor
    func testJoinIsIgnoredOutsideTheJoinStep() async {
        let h = makeHarness()
        await h.viewModel.restoreSession() // signed out
        await h.viewModel.joinCompany(joinCode: "DEMO-2026", displayName: "Pat")
        XCTAssertEqual(h.viewModel.phase, .signedOut)
        let calls = await h.memberships.joinCallCount
        XCTAssertEqual(calls, 0)
    }

    @MainActor
    func testDoubleSubmitWhileJoinInFlightSendsOneRequest() async {
        let h = makeHarness()
        await h.viewModel.signIn(email: "fresh@example.invalid", password: "secret1")
        await h.memberships.holdJoins()

        let viewModel = h.viewModel
        let first = Task { await viewModel.joinCompany(joinCode: "DEMO-2026", displayName: "Pat") }
        await eventually { await h.memberships.joinCallCount == 1 }
        XCTAssertTrue(h.viewModel.isWorking)

        await h.viewModel.joinCompany(joinCode: "DEMO-2026", displayName: "Pat")
        let callsWhileHeld = await h.memberships.joinCallCount
        XCTAssertEqual(callsWhileHeld, 1, "second tap is ignored while the first request is in flight")

        await h.memberships.releaseJoins()
        await first.value
        XCTAssertEqual(h.viewModel.activeMembership?.companyId, "company-demo")
        XCTAssertFalse(h.viewModel.isWorking)
    }

    // MARK: Sign out

    @MainActor
    func testSignOutClearsMembershipAndErrors() async {
        let h = makeHarness(signedInEmail: "member@example.invalid")
        await h.viewModel.restoreSession()
        XCTAssertNotNil(h.viewModel.activeMembership)
        await h.viewModel.signOut()
        XCTAssertEqual(h.viewModel.phase, .signedOut)
        XCTAssertNil(h.viewModel.activeMembership)
        XCTAssertNil(h.viewModel.error)
        let user = await h.auth.currentUser()
        XCTAssertNil(user)
    }

    @MainActor
    func testResultOfJoinStartedBeforeSignOutIsDiscarded() async {
        let h = makeHarness()
        await h.viewModel.signIn(email: "fresh@example.invalid", password: "secret1")
        await h.memberships.holdJoins()
        let viewModel = h.viewModel
        let join = Task { await viewModel.joinCompany(joinCode: "DEMO-2026", displayName: "Pat") }
        await eventually { await h.memberships.joinCallCount == 1 }

        await h.viewModel.signOut()
        await h.memberships.releaseJoins()
        await join.value

        XCTAssertEqual(h.viewModel.phase, .signedOut, "a late join result must not resurrect the old session")
        XCTAssertNil(h.viewModel.activeMembership)
        XCTAssertFalse(h.viewModel.isWorking)
    }

    @MainActor
    func testNextAccountDoesNotSeePreviousMembership() async {
        let h = makeHarness(signedInEmail: "member@example.invalid")
        await h.viewModel.restoreSession()
        await h.viewModel.signOut()
        await h.viewModel.signIn(email: "fresh@example.invalid", password: "secret1")
        XCTAssertNil(h.viewModel.activeMembership)
        guard case .needsMembership(let user) = h.viewModel.phase else {
            return XCTFail("expected needsMembership, got \(h.viewModel.phase)")
        }
        XCTAssertEqual(user.uid, "u-fresh")
    }

    // MARK: Messages

    func testEveryErrorHasAUserFacingMessage() {
        let all: [AccountsError] = [
            .validation(.email), .validation(.password), .validation(.joinCode), .validation(.displayName),
            .invalidCredentials, .emailAlreadyInUse, .weakPassword, .invalidEmail, .emailNotVerified,
            .invalidJoinCode, .membershipConflict, .rateLimited, .network, .unknown,
        ]
        for error in all {
            XCTAssertFalse(error.message.isEmpty, "\(error)")
        }
        XCTAssertTrue(AccountsError.weakPassword.message.contains("6"))
    }
}
