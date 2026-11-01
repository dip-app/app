import DIPAccounts
import Foundation

/// Which onboarding screen to show for an `AccountsSession` state. Pure so it can be unit-tested.
enum AccountsRoute: Equatable {
    case loading
    /// Sign in / create account. `error` is set when a sign-in or sign-up attempt failed.
    case auth(error: AccountsFailure?)
    case verifyEmail
    case joinCompany
    /// Something failed outside the sign-in form (listener, profile, network): retry or sign out.
    case problem(AccountsFailure)
    case member(MembershipContext)

    /// Failures that mean "fix what you typed on the sign-in form", not "the app is broken".
    static let authFormFailures: Set<AccountsFailure> = [.invalidCredentials, .emailAlreadyInUse, .invalidInput, .unauthenticated]

    init(_ state: AccountsState) {
        switch state {
        case .authenticationPending: self = .loading
        case .signedOut: self = .auth(error: nil)
        case .verificationRequired: self = .verifyEmail
        case .needsCompany: self = .joinCompany
        case .member(let context): self = .member(context)
        case .recoverableError(let failure):
            self = Self.authFormFailures.contains(failure) ? .auth(error: failure) : .problem(failure)
        }
    }
}

/// Client-side checks that avoid a round trip for obviously invalid input.
/// The server and Firebase Auth remain authoritative.
enum OnboardingValidation {
    static let minimumPasswordLength = 6
    static let maximumJoinCodeLength = 64
    static let maximumDisplayNameLength = 80

    enum Problem: Equatable {
        case missingEmail, missingPassword, shortPassword, missingJoinCode, joinCodeTooLong, missingName, nameTooLong
    }

    static func signIn(email: String, password: String) -> Problem? {
        if email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return .missingEmail }
        if password.isEmpty { return .missingPassword }
        return nil
    }

    static func signUp(email: String, password: String) -> Problem? {
        if let problem = signIn(email: email, password: password) { return problem }
        if password.count < minimumPasswordLength { return .shortPassword }
        return nil
    }

    static func join(code: String, displayName: String) -> Problem? {
        let code = code.trimmingCharacters(in: .whitespacesAndNewlines)
        let name = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        if code.isEmpty { return .missingJoinCode }
        if code.count > maximumJoinCodeLength { return .joinCodeTooLong }
        if name.isEmpty { return .missingName }
        if name.count > maximumDisplayNameLength { return .nameTooLong }
        return nil
    }
}

extension OnboardingValidation.Problem {
    var message: String {
        switch self {
        case .missingEmail: "Enter your email address."
        case .missingPassword: "Enter your password."
        case .shortPassword: "Use at least \(OnboardingValidation.minimumPasswordLength) characters for your password."
        case .missingJoinCode: "Enter the company code you were given."
        case .joinCodeTooLong: "That company code is too long. Check it and try again."
        case .missingName: "Enter your name."
        case .nameTooLong: "Use \(OnboardingValidation.maximumDisplayNameLength) characters or fewer for your name."
        }
    }
}

extension AccountsFailure {
    /// User-facing text. Never shows raw backend errors.
    var message: String {
        switch self {
        case .invalidCredentials: "That email and password don't match."
        case .emailAlreadyInUse: "An account with this email already exists. Try signing in."
        case .invalidInput: "Check what you entered. Emails need to be valid and passwords at least \(OnboardingValidation.minimumPasswordLength) characters."
        case .unauthenticated: "Please sign in again."
        case .permissionDenied: "Your email needs to be verified before you can join a company."
        case .invalidJoinCode: "That company code isn't valid. Check it and try again."
        case .membershipConflict: "This account already belongs to a different company."
        case .rateLimited: "Too many attempts. Wait a minute and try again."
        case .unavailable: "Can't reach DIP right now. Check your connection and try again."
        case .invalidProfile: "We couldn't load your company profile."
        case .unknown: "Something went wrong. Please try again."
        }
    }
}
