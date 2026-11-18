import DIPCore
import Foundation

/// The tour's copy (spec §3 B0–B5), as String Catalog keys with English defaults.
struct OnboardingCopy: Equatable {
    let title: String
    let body: String
    /// The Bar's CTA for steps B0–B4. B5's Bar comes from `OnboardingInterestsModel.bar`.
    let cta: String

    /// The copy for a step. `firstName` personalises B0; `features` picks B2's body.
    static func make(_ step: OnboardingStep, firstName: String?, features: OnboardingFeatures) -> OnboardingCopy {
        switch step {
        case .arrival:
            let name = firstName.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.flatMap { $0.isEmpty ? nil : $0 }
            return OnboardingCopy(
                title: name.map { String(localized: "onboarding.arrival.title.named", defaultValue: "You're in, \($0)", comment: "Onboarding tour step title; %@ = member first name") }
                    ?? String(localized: "onboarding.arrival.title", defaultValue: "You're in", comment: "Onboarding tour step title"),
                body: String(localized: "onboarding.arrival.body", defaultValue: "Here's how DIP gets your team together. It takes about a minute.", comment: "Onboarding tour step body"),
                cta: String(localized: "onboarding.arrival.cta", defaultValue: "Show me around", comment: "Onboarding tour bottom bar button"))
        case .discover:
            return OnboardingCopy(
                title: String(localized: "onboarding.discover.title", defaultValue: "Find something fun", comment: "Onboarding tour step title"),
                body: String(localized: "onboarding.discover.body", defaultValue: "Company events, from lunchtime board games to weekend hikes. Tap Join once and you're on the list.", comment: "Onboarding tour step body"),
                cta: String(localized: "onboarding.discover.cta", defaultValue: "See who's going", comment: "Onboarding tour bottom bar button"))
        case .people:
            return OnboardingCopy(
                title: String(localized: "onboarding.people.title", defaultValue: "Go with people you know", comment: "Onboarding tour step title"),
                body: features.contains(.invites)
                    ? String(localized: "onboarding.people.body", defaultValue: "See who's going before you decide. Invite a coworker and they can join in one tap.", comment: "Onboarding tour step body")
                    : String(localized: "onboarding.people.body.noInvites", defaultValue: "See who's going before you decide, by name and team.", comment: "Onboarding tour step body"),
                cta: String(localized: "onboarding.people.cta", defaultValue: "Show me challenges", comment: "Onboarding tour bottom bar button"))
        case .challenges:
            return OnboardingCopy(
                title: String(localized: "onboarding.challenges.title", defaultValue: "Take on a challenge", comment: "Onboarding tour step title"),
                body: String(localized: "onboarding.challenges.body", defaultValue: "Each challenge shows what to do, how to send it in and when it ends. Once your organizer approves, the points are yours.", comment: "Onboarding tour step body"),
                cta: String(localized: "onboarding.challenges.cta", defaultValue: "Show me memories", comment: "Onboarding tour bottom bar button"))
        case .memories:
            return OnboardingCopy(
                title: String(localized: "onboarding.memories.title", defaultValue: "Keep the memories", comment: "Onboarding tour step title"),
                body: String(localized: "onboarding.memories.body", defaultValue: "Your events live in My Events. Past events keep a shared photo album for everyone who went.", comment: "Onboarding tour step body"),
                cta: String(localized: "onboarding.memories.cta", defaultValue: "Pick my interests", comment: "Onboarding tour bottom bar button"))
        case .interests:
            return OnboardingCopy(
                title: String(localized: "onboarding.interests.title", defaultValue: "What are you into?", comment: "Onboarding tour step title"),
                body: String(localized: "onboarding.interests.body", defaultValue: "Pick a few. You can filter events by them anytime, and change them in Profile.", comment: "Onboarding tour step body"),
                cta: String(localized: "onboarding.interests.cta", defaultValue: "Start exploring", comment: "Onboarding tour bottom bar button"))
        }
    }

    /// B2's CTA names the step that follows: "Show me challenges" when B3 is in this run, otherwise
    /// "Show me memories" (B4). Every step CTA is a short first-person imperative (verb + object), no questions.
    static func cta(for step: OnboardingStep, next: OnboardingStep?, features: OnboardingFeatures) -> String {
        if step == .people, next != .challenges {
            return String(localized: "onboarding.people.cta.noChallenges", defaultValue: "Show me memories", comment: "Onboarding tour bottom bar button")
        }
        return make(step, firstName: nil, features: features).cta
    }

    /// "Getting your events…": the handoff wait (spec §3 H "Wait").
    static var waitingForHome: String { String(localized: "onboarding.handoff.waiting", defaultValue: "Getting your events…", comment: "Loading text while the first events load after the tour") }
    static var skipForNow: String { String(localized: "onboarding.interests.skipForNow", defaultValue: "Skip for now", comment: "Onboarding interests button that skips picking interests") }
    static var signOut: String { String(localized: "onboarding.signOut", defaultValue: "Sign out", comment: "Onboarding button that signs the member out") }
    static var back: String { String(localized: "onboarding.back", defaultValue: "Back", comment: "Onboarding back button label") }
    static var previousStep: String { String(localized: "onboarding.previousStep", defaultValue: "Previous step", comment: "Accessibility label of the onboarding back button") }
}
