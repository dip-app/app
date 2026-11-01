import DIPDesignSystem
import SwiftUI

/// Enter the company code (and the name coworkers will see) to join a company.
struct JoinCompanyView: View {
    let viewModel: AccountsViewModel
    @State private var joinCode = ""
    @State private var displayName = ""

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

            AccountsErrorText(error: viewModel.error)

            AccountsPrimaryButton(title: "Join company", isWorking: viewModel.isWorking) {
                Task { await viewModel.joinCompany(joinCode: joinCode, displayName: displayName) }
            }
            AccountsSecondaryButton(title: "Sign out") {
                Task { await viewModel.signOut() }
            }
        }
    }
}
