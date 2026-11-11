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
                title: name.map { String(localized: "onboarding.arrival.title.named", defaultValue: "You're in, \($0)") }
                    ?? String(localized: "onboarding.arrival.title", defaultValue: "You're in"),
                body: String(localized: "onboarding.arrival.body",
                             defaultValue: "Here's how DIP gets your team together. It takes about a minute."),
                cta: String(localized: "onboarding.arrival.cta", defaultValue: "Show me around"))
        case .discover:
            return OnboardingCopy(
                title: String(localized: "onboarding.discover.title", defaultValue: "Find something fun"),
                body: String(localized: "onboarding.discover.body",
                             defaultValue: "Company events, from lunchtime board games to weekend hikes. Tap Join once and you're on the list."),
                cta: String(localized: "onboarding.discover.cta", defaultValue: "See who's going"))
        case .people:
            return OnboardingCopy(
                title: String(localized: "onboarding.people.title", defaultValue: "Go with people you know"),
                body: features.contains(.invites)
                    ? String(localized: "onboarding.people.body",
                             defaultValue: "See who's going before you decide. Invite a coworker and they can join in one tap.")
                    : String(localized: "onboarding.people.body.noInvites",
                             defaultValue: "See who's going before you decide, by name and team."),
                cta: String(localized: "onboarding.people.cta", defaultValue: "Show me challenges"))
        case .challenges:
            return OnboardingCopy(
                title: String(localized: "onboarding.challenges.title", defaultValue: "Take on a challenge"),
                body: String(localized: "onboarding.challenges.body",
                             defaultValue: "Each challenge shows what to do, how to send it in and when it ends. Once your organizer approves, the points are yours."),
                cta: String(localized: "onboarding.challenges.cta", defaultValue: "Show me memories"))
        case .memories:
            return OnboardingCopy(
                title: String(localized: "onboarding.memories.title", defaultValue: "Keep the memories"),
                body: String(localized: "onboarding.memories.body",
                             defaultValue: "Your events live in My Events. Past events keep a shared photo album for everyone who went."),
                cta: String(localized: "onboarding.memories.cta", defaultValue: "Pick my interests"))
        case .interests:
            return OnboardingCopy(
                title: String(localized: "onboarding.interests.title", defaultValue: "What are you into?"),
                body: String(localized: "onboarding.interests.body",
                             defaultValue: "Pick a few. You can filter events by them anytime, and change them in Profile."),
                cta: String(localized: "onboarding.interests.cta", defaultValue: "Start exploring"))
        }
    }

    /// B2's CTA names the step that follows: "Show me challenges" when B3 is in this run, otherwise
    /// "Show me memories" (B4). Every step CTA is a short first-person imperative (verb + object), no questions.
    static func cta(for step: OnboardingStep, next: OnboardingStep?, features: OnboardingFeatures) -> String {
        if step == .people, next != .challenges {
            return String(localized: "onboarding.people.cta.noChallenges", defaultValue: "Show me memories")
        }
        return make(step, firstName: nil, features: features).cta
    }

    /// "Getting your events…": the handoff wait (spec §3 H "Wait").
    static let waitingForHome = String(localized: "onboarding.handoff.waiting", defaultValue: "Getting your events…")
    static let skipForNow = String(localized: "onboarding.interests.skipForNow", defaultValue: "Skip for now")
    static let signOut = String(localized: "onboarding.signOut", defaultValue: "Sign out")
    static let back = String(localized: "onboarding.back", defaultValue: "Back")
    static let previousStep = String(localized: "onboarding.previousStep", defaultValue: "Previous step")
}
