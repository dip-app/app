import DIPAccounts
import DIPDesignSystem
import SwiftUI

/// Shown until the account's email is verified; joining a company requires it.
struct VerifyEmailView: View {
    let session: AccountsSession
    @State private var notice: String?

    var body: some View {
        AccountsScreen(
            title: "Check your email",
            subtitle: "We sent you a verification link. Open it, then come back and tap the button below."
        ) {
            AccountsMessageText(message: session.commandError?.message)
            AccountsMessageText(message: session.commandError == nil ? notice : nil, isError: false)

            AccountsPrimaryButton(title: "I've verified my email", isWorking: session.isSubmitting) {
                Task {
                    notice = nil
                    await session.refreshIdentity()
                    // If verification succeeded, the session moves on by itself.
                    if session.commandError == nil, case .verificationRequired = session.state {
                        notice = "Not verified yet. Open the link in the email, then try again."
                    }
                }
            }
            AccountsSecondaryButton(title: "Resend email") {
                Task {
                    notice = nil
                    await session.sendVerification()
                    if session.commandError == nil { notice = "Verification email sent." }
                }
            }
            .disabled(session.isSubmitting)
            AccountsSecondaryButton(title: "Sign out") {
                Task { await session.signOut() }
            }
            .disabled(session.isSubmitting)
        }
    }
}
