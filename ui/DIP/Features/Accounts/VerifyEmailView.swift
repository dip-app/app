import DIPDesignSystem
import SwiftUI

/// Shown until the account's email is verified; joining a company requires it.
struct VerifyEmailView: View {
    let viewModel: AccountsViewModel
    let email: String

    var body: some View {
        AccountsScreen(
            title: "Check your email",
            subtitle: email.isEmpty
                ? "Open the verification link we sent you, then come back here."
                : "We sent a verification link to \(email). Open it, then come back here."
        ) {
            AccountsErrorText(error: viewModel.error)

            AccountsPrimaryButton(title: "I've verified my email", isWorking: viewModel.isWorking) {
                Task { await viewModel.checkVerification() }
            }
            AccountsSecondaryButton(title: "Resend email") {
                Task { await viewModel.resendVerificationEmail() }
            }
            .disabled(viewModel.isWorking)
            AccountsSecondaryButton(title: "Sign out") {
                Task { await viewModel.signOut() }
            }
        }
    }
}
