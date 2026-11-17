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
        #expect(model.pushRows.map(\.category) == DIPNotificationCategory.allCases)
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
        async let first: Void = model.toggle(.chat, to: false)
        async let second: Void = model.toggle(.social, to: true)
        _ = await (first, second)
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
        #expect(model.emailRows.map(\.category) == [.invites, .eventUpdates, .reminders, .challenges])
        #expect(model.emailRows.map(\.isOn) == [true, true, false, true])
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
}
