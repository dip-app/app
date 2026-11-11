import Foundation

/// Notification authorization as the system reports it (mirrors UNAuthorizationStatus without importing it).
public enum DIPPushAuthorization: Equatable, Sendable {
    case notDetermined, denied, authorized, provisional, ephemeral
}

/// When to ask for notification permission: never at launch, only right after the member's first RSVP, and at
/// most once. Pure so the decision is testable without UI or the system.
public enum DIPPushPriming {
    public static func shouldPrime(featureEnabled: Bool, authorization: DIPPushAuthorization,
                                   alreadyPrimed: Bool, justJoined: Bool) -> Bool {
        featureEnabled && justJoined && !alreadyPrimed && authorization == .notDetermined
    }

    /// Authorized in any form: register the device and receive pushes.
    public static func canReceive(_ authorization: DIPPushAuthorization) -> Bool {
        switch authorization {
        case .authorized, .provisional, .ephemeral: true
        case .notDetermined, .denied: false
        }
    }
}
