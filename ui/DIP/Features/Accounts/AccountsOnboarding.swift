import DIPAccounts
import Foundation

/// Which onboarding screen to show for an `AccountsSession` state. Pure for unit tests.
enum AccountsRoute: Equatable {
    case progress(String)
    case welcome
    case noCompany(AccountsFailure)
    case problem(AccountsFailure)
    case member(MembershipContext)

    init(_ state: AccountsState) {
        switch state {
        case .authenticationPending: self = .progress("Just a moment…")
        case .signedOut: self = .welcome
        case .resolvingCompany: self = .progress("Finding your company…")
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

    static let differentAccount = "Use a different account"

    /// Signed in, but this account has no company (ADR 0007). Never grants tenant content.
    static func noCompany(_ reason: AccountsFailure) -> AccountsNotice {
        switch reason {
        case .personalEmailDomain:
            return .init(title: "Use your work account", tone: .blocked,
                         message: "DIP finds your company from your work email. Gmail and iCloud accounts can't join.",
                         primary: (differentAccount, .signOut), secondary: nil)
        case .noCompanyForDomain:
            return .init(title: "Your company isn't here yet", tone: .notFound,
                         message: "We couldn't find a company for your work email. Ask your organizer to add it.",
                         primary: ("Try again", .retryMembership), secondary: (differentAccount, .signOut))
        case .membershipConflict:
            return .init(title: "This account belongs to another company", tone: .blocked,
                         message: "Sign in with the Google account you use at that company.",
                         primary: (differentAccount, .signOut), secondary: nil)
        default:
            return .init(title: "We couldn't verify this account", tone: .blocked,
                         message: "Sign in with a work Google account that has a verified email.",
                         primary: (differentAccount, .signOut), secondary: nil)
        }
    }

    /// Failures outside the account itself: connection, limits, configuration, data.
    static func problem(_ failure: AccountsFailure) -> AccountsNotice {
        switch failure {
        case .notConfigured:
            return .init(title: "Sign-in isn't available", tone: .problem,
                         message: "This version of DIP can't sign you in. Update the app, then try again.",
                         primary: ("Try again", .restart), secondary: nil)
        case .unavailable:
            return .init(title: "You're offline", tone: .offline,
                         message: "Check your connection, then try again.",
                         primary: ("Try again", .restart), secondary: ("Sign out", .signOut))
        case .rateLimited:
            return .init(title: "Too many tries", tone: .problem,
                         message: "Wait a minute, then try again.",
                         primary: ("Try again", .restart), secondary: ("Sign out", .signOut))
        case .invalidProfile:
            return .init(title: "We couldn't load your profile", tone: .problem,
                         message: "Try again. If this keeps happening, tell your organizer.",
                         primary: ("Try again", .restart), secondary: ("Sign out", .signOut))
        case .personalEmailDomain, .noCompanyForDomain, .membershipConflict, .permissionDenied:
            return noCompany(failure)
        default:
            return .init(title: "Something went wrong", tone: .problem,
                         message: "Please try again.",
                         primary: ("Try again", .restart), secondary: ("Sign out", .signOut))
        }
    }
}
