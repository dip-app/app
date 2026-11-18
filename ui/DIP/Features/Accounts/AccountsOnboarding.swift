import DIPAccounts
import Foundation

/// Which onboarding state to show for an `AccountsSession` state. Pure for unit tests.
/// A0 `.pending` and A2 `.resolving` are separate so they can look different on the Stage.
enum AccountsRoute: Equatable {
    case pending
    case welcome
    case resolving
    case noCompany(AccountsFailure)
    case problem(AccountsFailure)
    case member(MembershipContext)

    init(_ state: AccountsState) {
        switch state {
        case .authenticationPending: self = .pending
        case .signedOut: self = .welcome
        case .resolvingCompany: self = .resolving
        case .noCompany(_, let reason): self = .noCompany(reason)
        case .recoverableError(let failure): self = .problem(failure)
        case .member(let context): self = .member(context)
        }
    }
}

/// What a no-company or problem screen says and offers. Copy is the feature's job.
struct AccountsNotice: Equatable {
    enum Action: Equatable { case retryMembership, restart, signOut }
    enum Tone: Equatable { case blocked, notFound, offline, problem }
    let title: String
    let tone: Tone
    let message: String
    let primary: (title: String, action: Action)
    let secondary: (title: String, action: Action)?

    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.title == rhs.title && lhs.tone == rhs.tone && lhs.message == rhs.message
            && lhs.primary == rhs.primary && lhs.secondary?.title == rhs.secondary?.title
            && lhs.secondary?.action == rhs.secondary?.action
    }

    static var differentAccount: String {
        String(localized: "accounts.notice.action.differentAccount", defaultValue: "Use a different account",
               comment: "Sign-in notice button: sign out so the member can pick another Google account")
    }
    private static var tryAgain: String {
        String(localized: "accounts.notice.action.tryAgain", defaultValue: "Try again",
               comment: "Sign-in notice button: retry the sign-in or company lookup")
    }
    private static var signOut: String {
        String(localized: "accounts.notice.action.signOut", defaultValue: "Sign out",
               comment: "Sign-in notice button: sign out of the current account")
    }

    /// Signed in, but this account has no company (ADR 0007). Never grants tenant content.
    static func noCompany(_ reason: AccountsFailure) -> AccountsNotice {
        switch reason {
        case .personalEmailDomain:
            return .init(title: String(localized: "accounts.notice.personal.title", defaultValue: "Use your work account",
                                       comment: "Sign-in notice title: a personal email account cannot join"),
                         tone: .blocked,
                         message: String(localized: "accounts.notice.personal.message",
                                         defaultValue: "DIP finds your company from your work email, so personal Gmail and iCloud accounts can't join.",
                                         comment: "Sign-in notice body for a personal Gmail or iCloud account"),
                         primary: (differentAccount, .signOut), secondary: nil)
        case .noCompanyForDomain:
            return .init(title: String(localized: "accounts.notice.noCompany.title", defaultValue: "Your company isn't here yet",
                                       comment: "Sign-in notice title: no company matches the email domain"),
                         tone: .notFound,
                         message: String(localized: "accounts.notice.noCompany.message",
                                         defaultValue: "We couldn't find your company yet. Ask your organizer to add your email domain, then try again.",
                                         comment: "Sign-in notice body when no company matches the email domain"),
                         primary: (tryAgain, .retryMembership), secondary: (differentAccount, .signOut))
        case .membershipConflict:
            return .init(title: String(localized: "accounts.notice.conflict.title", defaultValue: "This account belongs to another company",
                                       comment: "Sign-in notice title: the account is already a member of a different company"),
                         tone: .blocked,
                         message: String(localized: "accounts.notice.conflict.message",
                                         defaultValue: "Sign in with the Google account you use at that company.",
                                         comment: "Sign-in notice body for an account that belongs to another company"),
                         primary: (differentAccount, .signOut), secondary: nil)
        default:
            return .init(title: String(localized: "accounts.notice.unverified.title", defaultValue: "We couldn't verify this account",
                                       comment: "Sign-in notice title: the Google account could not be verified"),
                         tone: .blocked,
                         message: String(localized: "accounts.notice.unverified.message",
                                         defaultValue: "Sign in with a work Google account that has a verified email.",
                                         comment: "Sign-in notice body for an unverified account"),
                         primary: (differentAccount, .signOut), secondary: nil)
        }
    }

    /// Failures outside the account itself: connection, limits, configuration, data.
    static func problem(_ failure: AccountsFailure) -> AccountsNotice {
        switch failure {
        case .notConfigured:
            return .init(title: String(localized: "accounts.notice.notConfigured.title", defaultValue: "Sign-in isn't available",
                                       comment: "Sign-in problem title: the app build has no sign-in configuration"),
                         tone: .problem,
                         message: String(localized: "accounts.notice.notConfigured.message",
                                         defaultValue: "This version of DIP can't sign you in. Update the app, then try again.",
                                         comment: "Sign-in problem body: the app needs an update"),
                         primary: (tryAgain, .restart), secondary: nil)
        case .unavailable:
            return .init(title: String(localized: "accounts.notice.offline.title", defaultValue: "You're offline",
                                       comment: "Sign-in problem title: no network connection"),
                         tone: .offline,
                         message: String(localized: "accounts.notice.offline.message",
                                         defaultValue: "Check your connection, then try again.",
                                         comment: "Sign-in problem body when offline"),
                         primary: (tryAgain, .restart), secondary: (signOut, .signOut))
        case .rateLimited:
            return .init(title: String(localized: "accounts.notice.rateLimited.title", defaultValue: "Too many tries",
                                       comment: "Sign-in problem title: too many attempts"),
                         tone: .problem,
                         message: String(localized: "accounts.notice.rateLimited.message",
                                         defaultValue: "Wait a minute, then try again.",
                                         comment: "Sign-in problem body when rate limited"),
                         primary: (tryAgain, .restart), secondary: (signOut, .signOut))
        case .invalidProfile:
            return .init(title: String(localized: "accounts.notice.invalidProfile.title", defaultValue: "We couldn't load your profile",
                                       comment: "Sign-in problem title: the member profile could not be loaded"),
                         tone: .problem,
                         message: String(localized: "accounts.notice.invalidProfile.message",
                                         defaultValue: "Try again. If this keeps happening, tell your organizer.",
                                         comment: "Sign-in problem body when the profile is invalid"),
                         primary: (tryAgain, .restart), secondary: (signOut, .signOut))
        case .personalEmailDomain, .noCompanyForDomain, .membershipConflict, .permissionDenied:
            return noCompany(failure)
        default:
            return .init(title: String(localized: "accounts.notice.generic.title", defaultValue: "Something went wrong",
                                       comment: "Sign-in problem title: unknown failure"),
                         tone: .problem,
                         message: String(localized: "accounts.notice.generic.message", defaultValue: "Please try again.",
                                         comment: "Sign-in problem body: unknown failure"),
                         primary: (tryAgain, .restart), secondary: (signOut, .signOut))
        }
    }
}
