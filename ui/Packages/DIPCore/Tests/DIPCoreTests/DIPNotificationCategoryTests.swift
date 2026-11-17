import Foundation
import Testing
@testable import DIPCore

@Suite struct DIPNotificationCategoryTests {
    @Test func idsMatchServerRegistryInOrder() {
        #expect(DIPNotificationCategory.allCases.map(\.rawValue)
            == ["invites", "event_updates", "reminders", "chat", "challenges", "social", "discovery"])
        #expect(DIPNotificationChannel.allCases.map(\.rawValue) == ["push", "email"])
    }

    @Test func offeredLists() {
        #expect(DIPNotificationCategory.offered(on: .push) == DIPNotificationCategory.allCases)
        #expect(DIPNotificationCategory.offered(on: .email) == [.invites, .eventUpdates, .reminders, .challenges, .discovery])
    }

    @Test func defaultsArePinned() {
        let push = DIPNotificationCategory.allCases.filter { DIPNotificationCategory.defaultEnabled($0, channel: .push) }
        #expect(push == [.invites, .eventUpdates, .reminders, .chat, .challenges])
        let email = DIPNotificationCategory.allCases.filter { DIPNotificationCategory.defaultEnabled($0, channel: .email) }
        #expect(email == [.invites, .eventUpdates, .challenges])
        #expect(!DIPNotificationCategory.defaultEnabled(.chat, channel: .email))
    }

    @Test func activityLevelGate() {
        let gated = DIPNotificationCategory.allCases.filter(\.isGatedByActivityLevel)
        #expect(gated == [.eventUpdates, .reminders, .chat])
    }

    @Test func copyIsPresent() {
        for category in DIPNotificationCategory.allCases {
            #expect(!category.title.isEmpty)
            #expect(!category.summary.isEmpty)
            #expect(!category.summary.contains("\u{2014}"))
        }
    }

    @Test func missingDocumentMeansDefaults() {
        #expect(DIPNotificationPreferences(firestore: nil) == .defaults)
        #expect(DIPNotificationPreferences(firestore: [:]) == .defaults)
        #expect(DIPNotificationPreferences.defaults.isEnabled(.social, on: .push) == false)
        #expect(DIPNotificationPreferences.defaults.isEnabled(.chat, on: .email) == false)
    }

    @Test func tolerantParse() {
        let data: [String: Any] = [
            "push": ["social": true, "chat": "yes", "bogus": true, "reminders": false],
            "email": ["discovery": true, "chat": true, "invites": 1],
            "extra": 5,
        ]
        let prefs = DIPNotificationPreferences(firestore: data)
        #expect(prefs.isEnabled(.social, on: .push))
        #expect(prefs.isEnabled(.chat, on: .push))
        #expect(!prefs.isEnabled(.reminders, on: .push))
        #expect(prefs.isEnabled(.discovery, on: .email))
        #expect(!prefs.isEnabled(.chat, on: .email))
        #expect(prefs.isEnabled(.invites, on: .email))
    }

    @Test func setNotOfferedIsNoOp() {
        let prefs = DIPNotificationPreferences.defaults
        #expect(prefs.setting(.chat, on: .email, to: true) == prefs)
        #expect(!prefs.setting(.chat, on: .email, to: true).isEnabled(.chat, on: .email))
    }

    @Test func settingOverridesDefault() {
        let prefs = DIPNotificationPreferences.defaults.setting(.social, on: .push, to: true).setting(.invites, on: .email, to: false)
        #expect(prefs.isEnabled(.social, on: .push))
        #expect(!prefs.isEnabled(.invites, on: .email))
    }

    @Test func firestoreFieldsRoundTrip() {
        let prefs = DIPNotificationPreferences.defaults.setting(.social, on: .push, to: true).setting(.reminders, on: .email, to: true)
        let fields = prefs.firestoreFields()
        #expect(fields["contractVersion"] as? Int == 1)
        #expect((fields["push"] as? [String: Bool])?.count == 7)
        #expect((fields["email"] as? [String: Bool])?.count == 5)
        let parsed = DIPNotificationPreferences(firestore: fields)
        for channel in DIPNotificationChannel.allCases {
            for category in DIPNotificationCategory.allCases {
                #expect(parsed.isEnabled(category, on: channel) == prefs.isEnabled(category, on: channel))
            }
        }
    }
}
