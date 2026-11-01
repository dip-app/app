import DIPAccounts
import SwiftUI

/// Enter the company code (and the name coworkers will see) to join a company.
struct JoinCompanyView: View {
    let session: AccountsSession
    @State private var joinCode = ""
    @State private var displayName = ""
    @State private var localProblem: OnboardingValidation.Problem?
    /// The server accepted the join; waiting for the profile listener to confirm membership.
    @State private var awaitingMembership = false

    var body: some View {
        AccountsScreen(
            title: "Join your company",
            subtitle: "Enter the company code from your organizer. You'll only see events from your own company."
        ) {
            AccountsTextField(title: "Company code", text: $joinCode)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()

            AccountsTextField(title: "Your name", text: $displayName)
                .textContentType(.name)

            AccountsMessageText(message: localProblem?.message ?? session.commandError?.message)

            AccountsPrimaryButton(title: "Join company", isWorking: session.isSubmitting || awaitingMembership) {
                Task { await submit() }
            }
            if awaitingMembership {
                Text("Finishing up…")
                    .font(.footnote)
                    .accessibilityAddTraits(.updatesFrequently)
            }
            AccountsSecondaryButton(title: "Sign out") {
                Task { await session.signOut() }
            }
            .disabled(session.isSubmitting)
        }
    }

    private func submit() async {
        localProblem = OnboardingValidation.join(code: joinCode, displayName: displayName)
        guard localProblem == nil else { return }
        await session.joinCompany(code: joinCode, displayName: displayName.trimmingCharacters(in: .whitespacesAndNewlines))
        // Membership comes from the profile listener, not the acknowledgement.
        awaitingMembership = session.commandError == nil
    }
}
