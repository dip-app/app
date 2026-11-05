import XCTest
import DIPAccounts
import DIPContracts
import DIPCore
@preconcurrency import FirebaseCore
@preconcurrency import FirebaseAuth
@preconcurrency import FirebaseFirestore
@testable import DIP

/// Run only through the documented Auth + Firestore emulator command and synthetic seed.
@MainActor final class LiveMemberEventReadTests: XCTestCase {
    func testAuthenticatedEmulatorReadsReachAppProjectionAndDetailUpdates() async throws {
        let root = "http://127.0.0.1:8080/v1/projects/demo-dip/databases/(default)/documents/"
        var probe = URLRequest(url: URL(string: root + "testRuns/member-event-reads")!)
        probe.setValue("Bearer owner", forHTTPHeaderField: "Authorization"); probe.timeoutInterval = 2
        let seeded: Bool
        do {
            let (bytes, response) = try await URLSession.shared.data(for: probe)
            let body = try JSONSerialization.jsonObject(with: bytes) as? [String: Any]
            let fields = body?["fields"] as? [String: [String: Any]]
            seeded = (response as? HTTPURLResponse)?.statusCode == 200 && fields?["kind"]?["stringValue"] as? String == "member-event-read-e2e"
        } catch { throw XCTSkip("Run the dedicated Auth/Firestore emulator seed command first.") }
        guard seeded else { throw XCTSkip("Synthetic event-read emulator seed is not present.") }
        let options = FirebaseOptions(googleAppID: "1:1234567890:ios:abcdef1234567890", gcmSenderID: "1234567890")
        options.projectID = "demo-dip"; options.apiKey = "emulator-only-key"
        let name = "EventReadTests-" + UUID().uuidString
        FirebaseApp.configure(name: name, options: options)
        let app = FirebaseApp.app(name: name)!
        let auth = Auth.auth(app: app); auth.useEmulator(withHost: "127.0.0.1", port: 9099)
        let db = Firestore.firestore(app: app)
        let settings = db.settings; settings.host = "127.0.0.1:8080"; settings.isSSLEnabled = false
        settings.cacheSettings = MemoryCacheSettings(); db.settings = settings
        let identity = try await auth.signIn(withEmail: "event-reader@example.test", password: "emulator-only-password")
        XCTAssertEqual(identity.user.uid, "event-read-member")
        let user = AppUser(id: identity.user.uid, companyId: "read-demo", displayName: "Event Reader", email: "event-reader@example.test", photoURL: "", avatarId: "", department: "", jobTitle: "", city: "", role: "member", interestTagIds: [], travelRadiusMiles: 20, availability: [], friendIds: [], favoritePhotoIds: [], pointsBalance: 0, createdAt: .distantPast)
        let context = try MembershipContext(uid: identity.user.uid, profile: user)
        let reads = FirebaseEventReadSource.repository(context: context, auth: auth, firestore: db)
        let query = EventFeedQuery(startsAtOrAfter: Date(), pageSize: 1)
        let first = try await reads.feed(query)
        XCTAssertEqual(first.events.first?.id, "event-a")
        let second = try await reads.feed(query, after: first.nextCursor)
        XCTAssertEqual(second.events.first?.id, "event-b")
        let profile = DIPProfile(id: context.uid, displayName: user.displayName, department: "", city: "", interestTagIDs: [], interestCatalog: [], photo: .data(Data()), avatar: .data(Data()), favoriteMemories: [])
        let bridge = MemberEventAppRepository(reads: reads, profile: profile)
        defer { bridge.stop(); try? auth.signOut(); app.delete { _ in } }
        let initial = XCTestExpectation(description: "Real company events projected into Home")
        let updated = XCTestExpectation(description: "Firestore detail change observed in app projection")
        let stream = await bridge.observe()
        var snapshots: [DIPAppSnapshot] = []
        let consumer = Task {
            do {
                for try await snapshot in stream {
                    snapshots.append(snapshot)
                    if snapshots.count == 1 { initial.fulfill() }
                    if snapshot.eventDetails["event-a"]?.title == "Updated emulator lunch" { updated.fulfill(); return }
                }
            } catch { }
        }
        defer { consumer.cancel() }
        let loaded = await XCTWaiter.fulfillment(of: [initial], timeout: 15)
        XCTAssertEqual(loaded, .completed)
        XCTAssertEqual(snapshots.first?.home.events.map(\.id), ["event-a", "event-b"])
        XCTAssertNil(snapshots.first?.eventDetails["puppy-yoga"])
        bridge.selectDetail("event-a")
        var patch = URLRequest(url: URL(string: root + "companies/read-demo/events/event-a?updateMask.fieldPaths=title")!)
        patch.httpMethod = "PATCH"; patch.setValue("Bearer owner", forHTTPHeaderField: "Authorization")
        patch.setValue("application/json", forHTTPHeaderField: "Content-Type")
        patch.httpBody = try JSONSerialization.data(withJSONObject: ["fields": ["title": ["stringValue": "Updated emulator lunch"]]])
        let (_, response) = try await URLSession.shared.data(for: patch)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        let changed = await XCTWaiter.fulfillment(of: [updated], timeout: 15)
        XCTAssertEqual(changed, .completed)
        XCTAssertEqual(snapshots.last?.eventDetails["event-a"]?.metadata?.address, "1 Main")
        try auth.signOut()
        do { _ = try await reads.detail("event-a"); XCTFail("Signed-out repository must reject old tenant reads") }
        catch { XCTAssertEqual(error as? EventReadFailure, .unauthenticated) }
    }
}
