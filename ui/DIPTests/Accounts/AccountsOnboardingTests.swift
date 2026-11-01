import DIPAccounts
import DIPContracts
import XCTest
@testable import DIP

final class AccountsOnboardingTests: XCTestCase {
    private func profile(uid: String = "u1", company: String = "company-demo") -> AppUser {
        AppUser(id: uid, companyId: company, displayName: "Pat", email: "pat@example.invalid", photoURL: "", avatarId: "",
                department: "", jobTitle: "", city: "", role: "member", interestTagIds: [], travelRadiusMiles: 20,
                availability: [], friendIds: [], favoritePhotoIds: [], pointsBalance: 0, createdAt: Date(timeIntervalSince1970: 0))
    }

    // MARK: Routing

    func testRoutesEverySessionState() throws {
        let verified = AccountIdentity(uid: "u1", isEmailVerified: true)
        let unverified = AccountIdentity(uid: "u1", isEmailVerified: false)
        let context = try MembershipContext(uid: "u1", profile: profile())

        XCTAssertEqual(AccountsRoute(.authenticationPending), .loading)
        XCTAssertEqual(AccountsRoute(.signedOut), .auth(error: nil))
        XCTAssertEqual(AccountsRoute(.verificationRequired(unverified)), .verifyEmail)
        XCTAssertEqual(AccountsRoute(.needsCompany(verified)), .joinCompany)
        XCTAssertEqual(AccountsRoute(.member(context)), .member(context))
    }

    func testSignInFailuresStayOnTheForm() {
        for failure in [AccountsFailure.invalidCredentials, .emailAlreadyInUse, .invalidInput, .unauthenticated] {
            XCTAssertEqual(AccountsRoute(.recoverableError(failure)), .auth(error: failure), "\(failure)")
        }
    }

    func testOtherFailuresShowTheProblemScreenNotMembership() {
        for failure in [AccountsFailure.unavailable, .invalidProfile, .permissionDenied, .rateLimited, .unknown] {
            XCTAssertEqual(AccountsRoute(.recoverableError(failure)), .problem(failure), "\(failure)")
        }
    }

    // MARK: Local validation

    func testSignInAndSignUpValidation() {
        XCTAssertEqual(OnboardingValidation.signIn(email: "  ", password: "x"), .missingEmail)
        XCTAssertEqual(OnboardingValidation.signIn(email: "a@b.c", password: ""), .missingPassword)
        XCTAssertNil(OnboardingValidation.signIn(email: "a@b.c", password: "x"))
        XCTAssertEqual(OnboardingValidation.signUp(email: "a@b.c", password: "12345"), .shortPassword)
        XCTAssertNil(OnboardingValidation.signUp(email: "a@b.c", password: "123456"))
    }

    func testJoinValidation() {
        XCTAssertEqual(OnboardingValidation.join(code: "   ", displayName: "Pat"), .missingJoinCode)
        XCTAssertEqual(OnboardingValidation.join(code: String(repeating: "X", count: 65), displayName: "Pat"), .joinCodeTooLong)
        XCTAssertEqual(OnboardingValidation.join(code: "DEMO-2026", displayName: "  "), .missingName)
        XCTAssertEqual(OnboardingValidation.join(code: "DEMO-2026", displayName: String(repeating: "n", count: 81)), .nameTooLong)
        XCTAssertNil(OnboardingValidation.join(code: " demo-2026 ", displayName: " Pat "))
    }

    // MARK: Messages

    func testEveryFailureAndProblemHasAMessage() {
        let failures: [AccountsFailure] = [.unauthenticated, .invalidCredentials, .emailAlreadyInUse, .invalidInput, .permissionDenied,
                                           .invalidJoinCode, .membershipConflict, .rateLimited, .unavailable, .invalidProfile, .unknown]
        for failure in failures { XCTAssertFalse(failure.message.isEmpty, "\(failure)") }
        let problems: [OnboardingValidation.Problem] = [.missingEmail, .missingPassword, .shortPassword, .missingJoinCode,
                                                        .joinCodeTooLong, .missingName, .nameTooLong]
        for problem in problems { XCTAssertFalse(problem.message.isEmpty, "\(problem)") }
    }

    // MARK: Preview repository + real AccountsSession

    @MainActor
    private func waitForRoute(_ session: AccountsSession, _ matches: (AccountsRoute) -> Bool,
                              file: StaticString = #filePath, line: UInt = #line) async {
        for _ in 0..<2_000 {
            if matches(AccountsRoute(session.state)) { return }
            await Task.yield()
        }
        XCTFail("unexpected route \(AccountsRoute(session.state))", file: file, line: line)
    }

    @MainActor
    func testPreviewFlowSignInJoinAndSignOut() async {
        let session = AccountsSession(repository: PreviewAccountsRepository(delay: .zero))
        session.start()
        await waitForRoute(session) { $0 == .auth(error: nil) }

        await session.signIn(email: "new@example.invalid", password: "wrong")
        await waitForRoute(session) { $0 == .auth(error: .invalidCredentials) }

        await session.signIn(email: "new@example.invalid", password: "password")
        await waitForRoute(session) { $0 == .joinCompany }

        await session.joinCompany(code: "nope", displayName: "Pat")
        XCTAssertEqual(session.commandError, .invalidJoinCode)
        XCTAssertEqual(AccountsRoute(session.state), .joinCompany)

        await session.joinCompany(code: " demo-2026 ", displayName: "Pat")
        XCTAssertNil(session.commandError)
        await waitForRoute(session) { if case .member(let context) = $0 { return context.companyID == "company-demo" }; return false }

        await session.signOut()
        await waitForRoute(session) { $0 == .auth(error: nil) }
        session.stop()
    }

    @MainActor
    func testPreviewFlowUnverifiedUserMustVerifyBeforeJoining() async {
        let session = AccountsSession(repository: PreviewAccountsRepository(signedInEmail: "unverified@example.invalid", delay: .zero))
        session.start()
        await waitForRoute(session) { $0 == .verifyEmail }
        await session.refreshIdentity()
        await waitForRoute(session) { $0 == .verifyEmail }
        await session.refreshIdentity()
        await waitForRoute(session) { $0 == .joinCompany }
        session.stop()
    }
}
