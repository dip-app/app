import Testing
import Foundation
import DIPContracts
@testable import DIPAccounts

@MainActor private final class FakeLocaleRepository: MemberLocaleRepository {
    var calls: [MemberLanguage] = []
    var failure: (any Error)?
    struct Offline: Error {}
    func setMyLocale(_ language: MemberLanguage) async throws {
        calls.append(language)
        if let failure { throw failure }
    }
}

private func context(_ uid: String = "one", locale: String? = nil) -> MembershipContext {
    let profile = AppUser(id: uid, companyId: "company", displayName: "Person", email: "synthetic@example.test", photoURL: "", avatarId: "", department: "", jobTitle: "", city: "", role: "member", interestTagIds: [], travelRadiusMiles: 20, availability: [], friendIds: [], favoritePhotoIds: [], pointsBalance: 0, createdAt: Date(timeIntervalSince1970: 0), locale: locale)
    return try! MembershipContext(uid: uid, profile: profile)
}

@Test func appLanguageMapsToEnglishOrSpanish() {
    #expect(MemberLanguage(appLocalization: "es") == .es)
    #expect(MemberLanguage(appLocalization: "es-419") == .es)
    #expect(MemberLanguage(appLocalization: "es_MX") == .es)
    #expect(MemberLanguage(appLocalization: "ES") == .es)
    #expect(MemberLanguage(appLocalization: "en") == .en)
    #expect(MemberLanguage(appLocalization: "en-GB") == .en)
    #expect(MemberLanguage(appLocalization: "tlh") == .en)   // hidden demo locale
    #expect(MemberLanguage(appLocalization: "fr") == .en)
    #expect(MemberLanguage(appLocalization: "") == .en)
    #expect(MemberLanguage(appLocalization: nil) == .en)
}

@Test func storedLocaleDefaultsToEnglish() {
    #expect(MemberLanguage(stored: nil) == .en)
    #expect(MemberLanguage(stored: "en") == .en)
    #expect(MemberLanguage(stored: "es") == .es)
    #expect(MemberLanguage(stored: "de") == .en)
}

@Test @MainActor func callsOnlyWhenTheLanguagesDiffer() async {
    let fake = FakeLocaleRepository()
    let english = MemberLocaleSync(repository: fake, appLanguage: { .en })
    #expect(await english.sync(context(locale: nil)) == false)    // absent means English
    #expect(await english.sync(context(locale: "en")) == false)
    #expect(fake.calls.isEmpty)
    #expect(await english.sync(context(locale: "es")) == true)
    #expect(fake.calls == [.en])

    let spanish = MemberLocaleSync(repository: fake, appLanguage: { .es })
    #expect(await spanish.sync(context(locale: "es")) == false)
    #expect(await spanish.sync(context(locale: nil)) == true)
    #expect(fake.calls == [.en, .es])
}

@Test @MainActor func atMostOncePerLaunchUnlessTheLanguageChanges() async {
    let fake = FakeLocaleRepository()
    var language = MemberLanguage.es
    let sync = MemberLocaleSync(repository: fake, appLanguage: { language })
    await sync.sync(context(locale: nil))
    await sync.sync(context(locale: nil))   // foreground again before the profile listener caught up
    #expect(fake.calls == [.es])
    language = .en
    await sync.sync(context(locale: "es"))
    #expect(fake.calls == [.es, .en])
    await sync.sync(context("two", locale: nil))   // another member on this phone
    language = .es
    await sync.sync(context("two", locale: nil))
    #expect(fake.calls == [.es, .en, .es])
}

@Test @MainActor func failureIsSilentAndRetriedAtTheNextLaunch() async {
    let fake = FakeLocaleRepository()
    fake.failure = FakeLocaleRepository.Offline()
    let launch = MemberLocaleSync(repository: fake, appLanguage: { .es })
    #expect(await launch.sync(context()) == true)    // no throw, nothing shown
    #expect(await launch.sync(context()) == false)   // not retried in the same launch
    fake.failure = nil
    let nextLaunch = MemberLocaleSync(repository: fake, appLanguage: { .es })
    #expect(await nextLaunch.sync(context()) == true)
    #expect(fake.calls == [.es, .es])
}

@Test @MainActor func signedOutOrUnconfiguredNeverCalls() async {
    let fake = FakeLocaleRepository()
    let sync = MemberLocaleSync(repository: fake, appLanguage: { .es })
    #expect(await sync.sync(nil) == false)
    #expect(fake.calls.isEmpty)
    let unconfigured = MemberLocaleSync(repository: nil, appLanguage: { .es })
    #expect(await unconfigured.sync(context()) == false)
}
