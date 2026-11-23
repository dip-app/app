import DIPCore
import DIPMockData
import DIPPresentation
import Foundation
import Testing

@MainActor private final class FakePermission: DIPNotificationPermissionProviding {
    var current: DIPPushAuthorization
    var grantOnTurnOn = true
    private(set) var turnOnCalls = 0
    private(set) var openSettingsCalls = 0
    init(_ current: DIPPushAuthorization) { self.current = current }
    func status() async -> DIPPushAuthorization { current }
    func turnOn() async -> DIPPushAuthorization {
        turnOnCalls += 1
        if grantOnTurnOn { current = .authorized } else { current = .denied }
        return current
    }
    func openSettings() { openSettingsCalls += 1 }
}

/// A repository whose save waits until the test releases it, to observe the model while a write is in flight.
private actor GatedPreferencesRepository: DIPNotificationPreferencesRepository {
    var stored: DIPNotificationPreferences = .defaults
    private var waiting: CheckedContinuation<Void, Never>?
    private(set) var saveStarted = false
    func load() async throws -> DIPNotificationPreferences { stored }
    func save(_ preferences: DIPNotificationPreferences, on channel: DIPNotificationChannel) async throws {
        saveStarted = true
        await withCheckedContinuation { waiting = $0 }
        stored = preferences
    }
    func release() { waiting?.resume(); waiting = nil }
}

@MainActor @Suite struct DIPNotificationSettingsModelTests {
    private func loaded(
        _ authorization: DIPPushAuthorization = .authorized,
        preferences: DIPNotificationPreferences = .defaults,
        behavior: DIPMockNotificationPreferencesRepository.Behavior = .init()
    ) async -> (DIPNotificationSettingsModel, DIPMockNotificationPreferencesRepository, FakePermission) {
        let repository = DIPMockNotificationPreferencesRepository(preferences: preferences, behavior: behavior)
        let permission = FakePermission(authorization)
        let model = DIPNotificationSettingsModel(repository: repository, permission: permission)
        await model.load()
        return (model, repository, permission)
    }

    @Test func loadsDefaultsInRegistryOrder() async {
        let (model, _, _) = await loaded()
        #expect(model.phase == .ready)
        #expect(model.pushRows.map(\.category) == [.invites, .eventUpdates, .reminders, .chat, .challenges, .social, .discovery])
        #expect(model.pushRows.map(\.isOn) == [true, true, true, true, true, false, false])
        #expect(model.pushRows.first?.title == "Invites")
        #expect(model.pushRows.allSatisfy { !$0.summary.isEmpty })
    }

    @Test func loadsStoredOverrides() async {
        let stored = DIPNotificationPreferences.defaults.setting(.chat, on: .push, to: false).setting(.social, on: .push, to: true)
        let (model, _, _) = await loaded(preferences: stored)
        #expect(model.pushRows.first { $0.category == .chat }?.isOn == false)
        #expect(model.pushRows.first { $0.category == .social }?.isOn == true)
    }

    @Test func loadFailureIsRecoverable() async {
        let (model, repository, _) = await loaded(behavior: .init(loadFailure: true))
        #expect(model.phase == .failed(DIPNotificationSettingsModel.loadFailureMessage))
        await repository.setBehavior(.init())
        await model.load()
        #expect(model.phase == .ready)
    }

    @Test func toggleSavesTheWholeDocumentOnce() async {
        let (model, repository, _) = await loaded()
        await model.toggle(.chat, to: false)
        #expect(model.pushRows.first { $0.category == .chat }?.isOn == false)
        #expect(model.saveError == nil)
        let saves = await repository.saves
        #expect(saves.count == 1)
        #expect(saves.first?.isEnabled(.chat, on: .push) == false)
        #expect(saves.first?.isEnabled(.invites, on: .push) == true)
        // The stored value is what a reopened screen loads.
        let reopened = DIPNotificationSettingsModel(repository: repository, permission: FakePermission(.authorized))
        await reopened.load()
        #expect(reopened.pushRows.first { $0.category == .chat }?.isOn == false)
    }

    @Test func toggleToTheCurrentValueWritesNothing() async {
        let (model, repository, _) = await loaded()
        await model.toggle(.chat, to: true)
        #expect(await repository.saves.isEmpty)
    }

    @Test func failedToggleRevertsAndOffersRetry() async {
        let (model, repository, _) = await loaded(behavior: .init(failingSaves: 1))
        await model.toggle(.reminders, to: false)
        #expect(model.pushRows.first { $0.category == .reminders }?.isOn == true)
        #expect(model.saveError == DIPNotificationSettingsModel.saveFailureMessage)
        #expect(await repository.saves.isEmpty)
        await model.retryFailedChange()
        #expect(model.pushRows.first { $0.category == .reminders }?.isOn == false)
        #expect(model.saveError == nil)
        #expect(await repository.saves.count == 1)
    }

    @Test func failureOnlyRevertsItsOwnSwitch() async {
        let (model, _, _) = await loaded(behavior: .init(failingSaves: 1))
        // Main-actor tasks start in the order they were created, so the first save is always chat's (the one that fails).
        let first = Task { await model.toggle(.chat, to: false) }
        let second = Task { await model.toggle(.social, to: true) }
        await first.value; await second.value
        #expect(model.pushRows.first { $0.category == .chat }?.isOn == true)
        #expect(model.pushRows.first { $0.category == .social }?.isOn == true)
    }

    @Test func nextToggleClearsTheError() async {
        let (model, _, _) = await loaded(behavior: .init(failingSaves: 1))
        await model.toggle(.chat, to: false)
        #expect(model.saveError != nil)
        await model.toggle(.challenges, to: false)
        #expect(model.saveError == nil)
    }

    @Test func authorizedMasterRow() async {
        for state in [DIPPushAuthorization.authorized, .provisional, .ephemeral] {
            let (model, _, _) = await loaded(state)
            #expect(model.masterTitle == "Push notifications are on")
            #expect(model.masterAction == nil)
            #expect(model.areSwitchesEnabled)
        }
    }

    @Test func deniedMasterRowOpensIOSSettings() async {
        let (model, _, permission) = await loaded(.denied)
        #expect(model.masterTitle == "Push is off")
        #expect(model.masterActionTitle == "Open Settings")
        await model.performMasterAction()
        #expect(permission.openSettingsCalls == 1)
        #expect(permission.turnOnCalls == 0)
    }

    @Test func notDeterminedMasterRowTurnsOnThroughThePermissionFlow() async {
        let (model, _, permission) = await loaded(.notDetermined)
        #expect(model.masterActionTitle == "Turn on notifications")
        #expect(!model.areSwitchesEnabled)
        await model.performMasterAction()
        #expect(permission.turnOnCalls == 1)
        #expect(model.masterTitle == "Push notifications are on")
        #expect(model.areSwitchesEnabled)
    }

    @Test func declinedPromptLeavesTheDeniedRow() async {
        let (model, _, permission) = await loaded(.notDetermined)
        permission.grantOnTurnOn = false
        await model.performMasterAction()
        #expect(model.masterAction == .openSettings)
    }

    @Test func switchesAreVisibleButDisabledWithoutPermission() async {
        for state in [DIPPushAuthorization.denied, .notDetermined] {
            let (model, repository, _) = await loaded(state)
            #expect(model.pushRows.count == 7)
            #expect(!model.areSwitchesEnabled)
            await model.toggle(.chat, to: false)
            #expect(model.pushRows.first { $0.category == .chat }?.isOn == true)
            #expect(await repository.saves.isEmpty)
        }
    }

    @Test func returningFromIOSSettingsRefreshesThePermission() async {
        let (model, _, permission) = await loaded(.denied)
        permission.current = .authorized
        await model.refreshPermission()
        #expect(model.areSwitchesEnabled)
    }

    @Test func sectionsArePushThenEmail() {
        #expect(DIPNotificationSettingsModel.Section.allCases == [.push, .email])
        #expect(DIPNotificationSettingsModel.Section.email.title == "Email")
    }

    @Test func emailRowsExcludeChatSocialAndDiscovery() async {
        let (model, _, _) = await loaded()
        #expect(model.emailRows.map(\.category) == [.invites, .eventUpdates, .dayBeforeReminders, .reminders, .challenges, .calendarInvites, .weeklyThemes])
        #expect(model.emailRows.map(\.isOn) == [true, true, true, false, true, true, false])
    }

    @Test func weeklyThemeEmailIsOffWhenMissingAndShownToEveryMember() async {
        let (member, _, _) = await loaded()
        let row = member.emailRows.first { $0.category == .weeklyThemes }
        #expect(row?.isOn == false)
        #expect(row?.title == "Weekly theme email")
        #expect(!member.pushRows.contains { $0.category == .weeklyThemes || $0.category == .adminDigest })
        let admin = DIPNotificationSettingsModel(repository: DIPMockNotificationPreferencesRepository(), permission: FakePermission(.authorized), isAdmin: true)
        await admin.load()
        #expect(admin.emailRows.first { $0.category == .weeklyThemes }?.isOn == false)
    }

    @Test func adminDigestRowIsForAdminsOnlyAndOffWhenMissing() async {
        let (member, memberRepository, _) = await loaded()
        #expect(!member.emailRows.contains { $0.category == .adminDigest })
        await member.toggle(.adminDigest, on: .email, to: true)
        #expect(await memberRepository.saves.isEmpty, "A member cannot turn on the hidden admin switch")

        let repository = DIPMockNotificationPreferencesRepository()
        let admin = DIPNotificationSettingsModel(repository: repository, permission: FakePermission(.authorized), isAdmin: true)
        await admin.load()
        #expect(admin.emailRows.map(\.category) == [.invites, .eventUpdates, .dayBeforeReminders, .reminders, .challenges, .calendarInvites, .weeklyThemes, .adminDigest])
        let digest = admin.emailRows.first { $0.category == .adminDigest }
        #expect(digest?.isOn == false)
        #expect(digest?.title == "Daily admin digest")
        // Admin-only also without the push client (email-only screen).
        let emailOnly = DIPNotificationSettingsModel(repository: repository, permission: nil, isAdmin: true)
        await emailOnly.load()
        #expect(emailOnly.sections == [.email])
        #expect(emailOnly.emailRows.contains { $0.category == .adminDigest })
    }

    @Test func optInTogglesWriteOnlyTheEmailChannelThroughTheRepository() async {
        let repository = DIPMockNotificationPreferencesRepository()
        let model = DIPNotificationSettingsModel(repository: repository, permission: FakePermission(.denied), isAdmin: true)
        await model.load()
        await model.toggle(.weeklyThemes, on: .email, to: true)
        await model.toggle(.adminDigest, on: .email, to: true)
        #expect(await repository.savedChannels == [.email, .email])
        let saved = await repository.saves.last
        #expect(saved?.isEnabled(.weeklyThemes, on: .email) == true)
        #expect(saved?.isEnabled(.adminDigest, on: .email) == true)
        // Push switches untouched by an email save.
        #expect(saved?.firestoreFields()["push"] as? [String: Bool] == DIPNotificationPreferences.defaults.firestoreFields()["push"] as? [String: Bool])
        let reopened = DIPNotificationSettingsModel(repository: repository, permission: FakePermission(.authorized), isAdmin: true)
        await reopened.load()
        #expect(reopened.emailRows.first { $0.category == .weeklyThemes }?.isOn == true)
        #expect(reopened.emailRows.first { $0.category == .adminDigest }?.isOn == true)
    }

    @Test func failedOptInToggleRevertsAndRetrySaves() async {
        let (model, repository, _) = await loaded(behavior: .init(failingSaves: 1))
        await model.toggle(.weeklyThemes, on: .email, to: true)
        #expect(model.emailRows.first { $0.category == .weeklyThemes }?.isOn == false)
        #expect(model.saveError == DIPNotificationSettingsModel.saveFailureMessage)
        await model.retryFailedChange()
        #expect(model.emailRows.first { $0.category == .weeklyThemes }?.isOn == true)
        #expect(model.saveError == nil)
        #expect(await repository.savedChannels == [.email])
    }

    @Test func emailToggleWritesOnlyTheEmailChannel() async {
        let (model, repository, _) = await loaded()
        await model.toggle(.reminders, on: .email, to: true)
        #expect(model.emailRows.first { $0.category == .reminders }?.isOn == true)
        #expect(await repository.savedChannels == [.email])
        #expect(model.pushRows.map(\.isOn) == [true, true, true, true, true, false, false])
        let reopened = DIPNotificationSettingsModel(repository: repository, permission: FakePermission(.authorized))
        await reopened.load()
        #expect(reopened.emailRows.first { $0.category == .reminders }?.isOn == true)
    }

    @Test func pushToggleStillWritesOnlyThePushChannel() async {
        let (model, repository, _) = await loaded()
        await model.toggle(.chat, to: false)
        #expect(await repository.savedChannels == [.push])
    }

    @Test func emailSwitchesStayEnabledWhilePushIsDenied() async {
        let (model, repository, _) = await loaded(.denied)
        #expect(!model.areSwitchesEnabled(in: .push))
        #expect(model.areSwitchesEnabled(in: .email))
        await model.toggle(.invites, on: .email, to: false)
        #expect(model.emailRows.first { $0.category == .invites }?.isOn == false)
        #expect(await repository.savedChannels == [.email])
    }

    @Test func hiddenEmailCategoriesCannotBeToggled() async {
        let (model, repository, _) = await loaded()
        await model.toggle(.discovery, on: .email, to: true)
        await model.toggle(.chat, on: .email, to: true)
        #expect(await repository.saves.isEmpty)
    }

    @Test func failedEmailToggleRevertsAndRetrySavesEmail() async {
        let (model, repository, _) = await loaded(behavior: .init(failingSaves: 1))
        await model.toggle(.challenges, on: .email, to: false)
        #expect(model.emailRows.first { $0.category == .challenges }?.isOn == true)
        #expect(model.saveError == DIPNotificationSettingsModel.saveFailureMessage)
        await model.retryFailedChange()
        #expect(model.emailRows.first { $0.category == .challenges }?.isOn == false)
        #expect(model.saveError == nil)
        #expect(await repository.savedChannels == [.email])
    }

    @Test func saveErrorNamesTheChannelThatFailed() async {
        let (model, _, _) = await loaded(behavior: .init(failingSaves: 1))
        #expect(model.saveErrorChannel == nil)
        await model.toggle(.weeklyThemes, on: .email, to: true)
        #expect(model.saveErrorChannel == .email)
        #expect(model.saveErrorCategory == .weeklyThemes)
        model.dismissSaveError()
        #expect(model.saveErrorChannel == nil)
        #expect(model.saveErrorCategory == nil)
        let (push, _, _) = await loaded(behavior: .init(failingSaves: 1))
        await push.toggle(.chat, to: false)
        #expect(push.saveErrorChannel == .push)
    }

    @Test func dayBeforeReminderRowIsOnByDefaultAndTogglesOptimistically() async {
        let (model, repository, _) = await loaded()
        let row = model.emailRows.first { $0.category == .dayBeforeReminders }
        #expect(row?.isOn == true)
        #expect(row?.title == "Day-before reminder")
        #expect(row?.summary == "About a day before activities you joined")
        #expect(model.emailRows.first { $0.category == .reminders }?.summary == "About an hour before activities you joined")
        #expect(model.pushRows.first { $0.category == .reminders }?.summary == "About a day and an hour before activities you joined")
        #expect(!model.pushRows.contains { $0.category == .dayBeforeReminders })
        await model.toggle(.dayBeforeReminders, on: .email, to: false)
        #expect(model.emailRows.first { $0.category == .dayBeforeReminders }?.isOn == false)
        #expect(await repository.savedChannels == [.email])
        #expect(await repository.saves.last?.isEnabled(.dayBeforeReminders, on: .email) == false)
        #expect(await repository.saves.last?.isEnabled(.reminders, on: .email) == false, "the hour reminder is untouched")
    }

    @Test func failedDayBeforeToggleRevertsAndRetrySaves() async {
        let (model, repository, _) = await loaded(behavior: .init(failingSaves: 1))
        await model.toggle(.dayBeforeReminders, on: .email, to: false)
        #expect(model.emailRows.first { $0.category == .dayBeforeReminders }?.isOn == true)
        #expect(model.saveErrorCategory == .dayBeforeReminders)
        await model.retryFailedChange()
        #expect(model.emailRows.first { $0.category == .dayBeforeReminders }?.isOn == false)
        #expect(model.saveError == nil)
        #expect(await repository.savedChannels == [.email])
    }

    @Test func challengesEmailSummaryLeavesWeeklyThemesToTheirOwnSwitch() async {
        let (model, _, _) = await loaded()
        let push = model.pushRows.first { $0.category == .challenges }?.summary
        let email = model.emailRows.first { $0.category == .challenges }?.summary
        #expect(push == "Submission reviews and new weekly themes")
        #expect(email == "Reviews of your weekly theme submissions")
        #expect(model.emailRows.first { $0.category == .invites }?.summary == DIPNotificationCategory.invites.summary)
    }

    @Test func reloadDuringAnInFlightSaveKeepsTheOptimisticSwitch() async {
        let repository = GatedPreferencesRepository()
        let model = DIPNotificationSettingsModel(repository: repository, permission: FakePermission(.authorized))
        await model.load()
        let toggle = Task { await model.toggle(.chat, to: false) }
        while await !repository.saveStarted { await Task.yield() }
        await model.load()                                        // the screen reappears while the write is queued
        #expect(model.pushRows.first { $0.category == .chat }?.isOn == false, "A stale read must not undo the tap")
        await repository.release()
        await toggle.value
        #expect(model.pushRows.first { $0.category == .chat }?.isOn == false)
        #expect(model.saveError == nil)
        await model.load()                                        // settled: the stored value is authoritative again
        #expect(model.pushRows.first { $0.category == .chat }?.isOn == false)
    }

    @Test func pushAndEmailFailuresAreIndependent() async {
        let (model, _, _) = await loaded(behavior: .init(failingSaves: 1))
        await model.toggle(.invites, on: .push, to: false)        // fails and reverts
        #expect(model.pushRows.first { $0.category == .invites }?.isOn == true)
        #expect(model.saveError != nil)
        await model.toggle(.invites, on: .email, to: false)       // a different channel still saves
        #expect(model.emailRows.first { $0.category == .invites }?.isOn == false)
        #expect(model.pushRows.first { $0.category == .invites }?.isOn == true, "The failed push switch stays reverted")
        #expect(model.saveError == nil)
    }

    @Test func withoutThePushClientOnlyEmailIsOfferedAndStillSaves() async {
        let repository = DIPMockNotificationPreferencesRepository(preferences: .defaults, behavior: .init())
        let model = DIPNotificationSettingsModel(repository: repository, permission: nil)
        await model.load()
        #expect(model.phase == .ready)
        #expect(!model.isPushAvailable)
        #expect(model.sections == [.email])
        #expect(model.masterAction == nil)
        #expect(!model.areSwitchesEnabled(in: .push))
        #expect(model.areSwitchesEnabled(in: .email))
        await model.toggle(.invites, on: .email, to: false)
        #expect(model.emailRows.first { $0.category == .invites }?.isOn == false)
        #expect(await repository.savedChannels == [.email])
    }
}
