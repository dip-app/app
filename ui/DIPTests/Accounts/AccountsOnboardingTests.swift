import DIPAccounts
import DIPContracts
import XCTest
@testable import DIP

final class AccountsOnboardingTests: XCTestCase {
    private func profile(uid: String = "u1") -> AppUser {
        AppUser(id: uid, companyId: "company-demo", displayName: "Pat", email: "pat@example.invalid", photoURL: "", avatarId: "",
                department: "", jobTitle: "", city: "", role: "member", interestTagIds: [], travelRadiusMiles: 20,
                availability: [], friendIds: [], favoritePhotoIds: [], pointsBalance: 0, createdAt: Date(timeIntervalSince1970: 0))
    }
    private let allFailures: [AccountsFailure] = [.cancelled, .notConfigured, .unauthenticated, .invalidInput, .permissionDenied,
                                                  .personalEmailDomain, .noCompanyForDomain, .membershipConflict, .rateLimited,
                                                  .unavailable, .invalidProfile, .unknown]

    // MARK: Routing

    func testRoutesEverySessionState() throws {
        let identity = AccountIdentity(uid: "u1", isEmailVerified: true)
        let context = try MembershipContext(uid: "u1", profile: profile())
        XCTAssertEqual(AccountsRoute(.authenticationPending), .progress("Just a moment…"))
        XCTAssertEqual(AccountsRoute(.signedOut), .welcome)
        XCTAssertEqual(AccountsRoute(.resolvingCompany(identity)), .progress("Finding your company…"))
        XCTAssertEqual(AccountsRoute(.noCompany(identity, .personalEmailDomain)), .noCompany(.personalEmailDomain))
        XCTAssertEqual(AccountsRoute(.recoverableError(.unavailable)), .problem(.unavailable))
        XCTAssertEqual(AccountsRoute(.member(context)), .member(context))
    }

    func testOnlyMemberStateRendersMemberContent() {
        let identity = AccountIdentity(uid: "u1", isEmailVerified: true)
        for failure in allFailures {
            for state in [AccountsState.noCompany(identity, failure), .recoverableError(failure)] {
                if case .member = AccountsRoute(state) { XCTFail("\(state) must not render member content") }
            }
        }
    }

    // MARK: Notices

    func testPersonalAccountExplainsWorkAccountAndOffersAnotherAccount() {
        let notice = AccountsNotice.noCompany(.personalEmailDomain)
        XCTAssertEqual(notice.title, "Use your work account")
        XCTAssertTrue(notice.message.contains("Gmail"))
        XCTAssertEqual(notice.primary.action, .signOut)
        XCTAssertNil(notice.secondary)
    }

    func testUnmappedCompanyOffersRetryThenAnotherAccount() {
        let notice = AccountsNotice.noCompany(.noCompanyForDomain)
        XCTAssertEqual(notice.title, "Your company isn't here yet")
        XCTAssertEqual(notice.primary.action, .retryMembership)
        XCTAssertEqual(notice.secondary?.action, .signOut)
    }

    func testNotConfiguredOnlyGoesBack() {
        let notice = AccountsNotice.problem(.notConfigured)
        XCTAssertEqual(notice.primary.action, .restart)
        XCTAssertNil(notice.secondary)
    }

    func testEveryFailureHasUsableCopyAndAnAction() {
        for failure in allFailures {
            for notice in [AccountsNotice.noCompany(failure), .problem(failure)] {
                XCTAssertFalse(notice.title.isEmpty, "\(failure)")
                XCTAssertFalse(notice.message.isEmpty, "\(failure)")
                XCTAssertFalse(notice.primary.title.isEmpty, "\(failure)")
                XCTAssertFalse(notice.message.localizedCaseInsensitiveContains("firebase error"), "\(failure)")
            }
        }
    }

    // MARK: Real AccountsSession over the preview repository

    @MainActor
    private func makeSession(_ repository: PreviewAccountsRepository) -> AccountsSession {
        let session = AccountsSession(repository: repository)
        session.start()
        return session
    }

    @MainActor
    private func waitFor(_ session: AccountsSession, _ matches: (AccountsRoute) -> Bool,
                         file: StaticString = #filePath, line: UInt = #line) async {
        for _ in 0..<2_000 {
            if matches(AccountsRoute(session.state)) { return }
            await Task.yield()
        }
        XCTFail("unexpected route \(AccountsRoute(session.state))", file: file, line: line)
    }

    @MainActor
    func testWorkAccountSignsInResolvesAndSignsOut() async {
        let session = makeSession(PreviewAccountsRepository(googleAccount: "new@example.invalid", delay: .zero))
        await waitFor(session) { $0 == .welcome }
        await session.signInWithGoogle()
        await waitFor(session) { if case .member(let context) = $0 { return context.companyID == "company-demo" }; return false }
        await session.signOut()
        await waitFor(session) { $0 == .welcome }
        session.stop()
    }

    @MainActor
    func testPersonalAccountNeverReachesMember() async {
        let session = makeSession(PreviewAccountsRepository(googleAccount: "pat@gmail.com", delay: .zero))
        await waitFor(session) { $0 == .welcome }
        await session.signInWithGoogle()
        await waitFor(session) { $0 == .noCompany(.personalEmailDomain) }
        await session.signOut()
        await waitFor(session) { $0 == .welcome }
        session.stop()
    }

    @MainActor
    func testUnmappedCompanyStaysOutAfterRetry() async {
        let session = makeSession(PreviewAccountsRepository(googleAccount: "pat@unknown.test", delay: .zero))
        await waitFor(session) { $0 == .welcome }
        await session.signInWithGoogle()
        await waitFor(session) { $0 == .noCompany(.noCompanyForDomain) }
        await session.retryMembership()
        await waitFor(session) { $0 == .noCompany(.noCompanyForDomain) }
        session.stop()
    }

    @MainActor
    func testNotConfiguredShowsProblemThenReturnsToWelcome() async {
        let session = makeSession(PreviewAccountsRepository(googleAccount: nil, delay: .zero))
        await waitFor(session) { $0 == .welcome }
        await session.signInWithGoogle()
        XCTAssertEqual(AccountsRoute(session.state), .problem(.notConfigured))
        session.start()
        await waitFor(session) { $0 == .welcome }
        session.stop()
    }

    @MainActor
    func testExistingMemberRestoresDirectly() async {
        let session = makeSession(PreviewAccountsRepository(signedInEmail: "member@example.invalid", delay: .zero))
        await waitFor(session) { if case .member = $0 { return true }; return false }
        session.stop()
    }
}
