import DIPAccounts
import DIPContracts
@preconcurrency import FirebaseFirestore
import XCTest
@testable import DIP

final class ProfileDataTests: XCTestCase {
    // MARK: tags/{tagId} mapping

    @MainActor
    func testMapsWellFormedTagDocuments() {
        let tag = TagDocumentMapper.decode(id: "tag-fitness", fields: ["name": " Fitness ", "icon": "🏋️", "sortOrder": 1])
        XCTAssertEqual(tag, InterestTag(id: "tag-fitness", name: "Fitness", icon: "🏋️", sortOrder: 1))
    }

    @MainActor
    func testSkipsMalformedTagDocuments() {
        let bad: [[String: Any]] = [
            [:],
            ["name": "Fitness", "icon": "🏋️"],
            ["name": "", "icon": "🏋️", "sortOrder": 1],
            ["name": "Fitness", "icon": "🏋️", "sortOrder": "1"],
            ["name": "Fitness", "icon": "🏋️", "sortOrder": 1.5],
            ["name": "Fitness", "icon": "🏋️", "sortOrder": true],
            ["name": 7, "icon": "🏋️", "sortOrder": 1],
        ]
        for fields in bad { XCTAssertNil(TagDocumentMapper.decode(id: "tag", fields: fields), "\(fields)") }
        XCTAssertNil(TagDocumentMapper.decode(id: "", fields: ["name": "Fitness", "icon": "🏋️", "sortOrder": 1]))
    }

    // MARK: Preview repository (used by previews and Debug builds without Firebase)

    @MainActor
    private func signedInPreview() async throws -> (PreviewAccountsRepository, AccountsSession, MembershipContext) {
        let repository = PreviewAccountsRepository(googleAccount: "member@example.invalid", delay: .zero)
        let session = AccountsSession(repository: repository)
        session.start()
        await session.signInWithGoogle()
        for _ in 0..<50 { await Task.yield() }
        guard case .member(let context) = session.state else {
            XCTFail("preview did not reach member state"); throw CancellationError()
        }
        return (repository, session, context)
    }

    @MainActor
    func testLocaleSyncWritesTheAppLanguageThroughTheMembershipListenerOnce() async throws {
        let (repository, session, context) = try await signedInPreview()
        XCTAssertNil(context.profile.locale)
        let sync = MemberLocaleSync(repository: repository, appLanguage: { .es })
        let sent = await sync.sync(context)
        XCTAssertTrue(sent)
        for _ in 0..<50 { await Task.yield() }
        guard case .member(let updated) = session.state else { return XCTFail("left member state") }
        XCTAssertEqual(updated.profile.locale, "es")
        let again = await sync.sync(updated)   // foreground after the listener caught up: same language, no call
        XCTAssertFalse(again)
        XCTAssertEqual(repository.localeCalls, [.es])
        session.stop()
    }

    @MainActor
    func testProfileMapperReadsTheOptionalLocale() throws {
        func fields(_ extra: [String: Any]) -> [String: Any] {
            ["companyId": "c1", "displayName": "Sam", "email": "sam@example.test", "photoURL": "", "avatarId": "", "department": "",
             "jobTitle": "", "city": "", "role": "member", "interestTagIds": [String](), "travelRadiusMiles": 20,
             "availability": [String](), "friendIds": [String](), "favoritePhotoIds": [String](), "pointsBalance": 0,
             "createdAt": Timestamp(seconds: 0, nanoseconds: 0)].merging(extra) { $1 }
        }
        XCTAssertNil(try AccountDocumentMapper.decode(id: "u1", fields: fields([:]))?.locale)
        XCTAssertEqual(try AccountDocumentMapper.decode(id: "u1", fields: fields(["locale": "es"]))?.locale, "es")
        XCTAssertNil(try AccountDocumentMapper.decode(id: "u1", fields: fields(["locale": 7]))?.locale)   // malformed: English
        // Organizers and admins sign in to the app as full members; an unknown role fails closed.
        for role in ["member", "organizer", "admin"] {
            XCTAssertEqual(try AccountDocumentMapper.decode(id: "u1", fields: fields(["role": role]))?.role, role)
        }
        XCTAssertThrowsError(try AccountDocumentMapper.decode(id: "u1", fields: fields(["role": "owner"])))
    }

    @MainActor
    func testPreviewSavesEditsThroughTheMembershipListener() async throws {
        let (repository, session, context) = try await signedInPreview()
        let editor = ProfileEditor(context: context, repository: repository)
        editor.draft.department = "Research"
        editor.toggleInterest("tag-fitness")
        let saved = await editor.save()
        XCTAssertTrue(saved)
        for _ in 0..<50 { await Task.yield() }
        guard case .member(let updated) = session.state else { return XCTFail("left member state") }
        XCTAssertEqual(updated.profile.department, "Research")
        XCTAssertEqual(updated.profile.interestTagIds, ["tag-fitness"])
        XCTAssertEqual(updated.profile.displayName, context.profile.displayName)
        session.stop()
    }

    @MainActor
    func testPreviewRefusesWritesForAnotherAccount() async throws {
        let (repository, session, context) = try await signedInPreview()
        do {
            try await repository.updateProfile(uid: "someone-else", EditableProfile(context.profile))
            XCTFail("wrote another account's profile")
        } catch {
            XCTAssertEqual(error as? AccountsFailure, .unauthenticated)
        }
        session.stop()
    }

    @MainActor
    func testPreviewCatalogIsSortedAndCoversSampleInterests() async throws {
        let (repository, session, _) = try await signedInPreview()
        let catalog = InterestCatalog(repository: repository)
        await catalog.load()
        XCTAssertEqual(catalog.tags.map(\.sortOrder), catalog.tags.map(\.sortOrder).sorted())
        XCTAssertTrue(catalog.tags.contains { $0.id == "tag-social" })
        session.stop()
    }
}
