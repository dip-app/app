import DIPAccounts
import DIPDesignSystem
import SwiftUI

/// No-company and problem screens. Actions never guess a company.
struct AccountsNoticeView: View {
    let session: AccountsSession
    let notice: AccountsNotice

    var body: some View {
        OnboardingScreen(pill: "DIP") {
            OnboardingStatusView(state: .failure(title: notice.title, message: notice.message,
                                                 face: illustration.face, cardFill: illustration.card))
        } actions: {
            OnboardingButton(notice.primary.title, isLoading: session.isSubmitting) { perform(notice.primary.action) }
                .accessibilityIdentifier("onboarding.primary")
            if let secondary = notice.secondary {
                OnboardingButton(secondary.title, emphasis: .secondary, isEnabled: !session.isSubmitting) {
                    perform(secondary.action)
                }
                .accessibilityIdentifier("onboarding.secondary")
            }
        }
    }

    /// Token colours per tone; the face always contrasts with its card.
    private var illustration: (face: OnboardingFace, card: Color) {
        switch notice.tone {
        case .blocked:
            (OnboardingFace(fill: OnboardingTheme.notification, figure: .square, mood: .worried, size: faceSize),
             OnboardingTheme.accent)
        case .notFound:
            (OnboardingFace(fill: OnboardingTheme.accent, figure: .pill, mood: .calm, size: faceSize),
             OnboardingTheme.challenge)
        case .offline:
            (OnboardingFace(fill: OnboardingTheme.inverse, figure: .round, mood: .calm, size: faceSize),
             OnboardingTheme.challenge)
        case .problem:
            (OnboardingFace(fill: OnboardingTheme.challenge, figure: .round, mood: .worried, size: faceSize),
             OnboardingTheme.accent)
        }
    }

    private let faceSize: CGFloat = 120

    private func perform(_ action: AccountsNotice.Action) {
        switch action {
        case .retryMembership: Task { await session.retryMembership() }
        case .restart: session.start()
        case .signOut: Task { await session.signOut() }
        }
    }
}

struct AccountsProgressView: View {
    let message: String
    var body: some View {
        OnboardingScreen(pill: "DIP") {
            OnboardingStatusView(state: .loading(message: message))
        } actions: {
            EmptyView()
        }
    }
}
