import Foundation

extension AccountsError {
    /// User-facing text for the accounts screens.
    var message: String {
        switch self {
        case .validation(.email): "Enter your email address."
        case .validation(.password): "Enter your password."
        case .validation(.joinCode): "Enter the company code you were given."
        case .validation(.displayName): "Enter your name (up to 80 characters)."
        case .invalidCredentials: "That email and password don't match."
        case .emailAlreadyInUse: "An account with this email already exists. Try signing in."
        case .weakPassword: "Use at least \(AccountsViewModel.minimumPasswordLength) characters for your password."
        case .invalidEmail: "Enter a valid email address."
        case .emailNotVerified: "Your email isn't verified yet. Open the link we sent you, then try again."
        case .invalidJoinCode: "That company code isn't valid. Check it and try again."
        case .membershipConflict: "This account already belongs to a different company."
        case .rateLimited: "Too many attempts. Wait a moment and try again."
        case .network: "Can't reach DIP right now. Check your connection and try again."
        case .unknown: "Something went wrong. Please try again."
        }
    }
}
