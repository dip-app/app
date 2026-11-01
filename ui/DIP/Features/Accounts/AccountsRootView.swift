import DIPDesignSystem
import SwiftUI

/// Entry point for the account flow. Shows the right screen for the current
/// phase and renders `member` content once the user belongs to a company.
/// App composition (wiring this into DIPApp with real services) is integrator work.
struct AccountsRootView<MemberContent: View>: View {
    let viewModel: AccountsViewModel
    @ViewBuilder let memberContent: (ActiveMembership) -> MemberContent

    var body: some View {
        Group {
            switch viewModel.phase {
            case .restoring:
                ProgressView("Loading your account…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            case .signedOut:
                AuthView(viewModel: viewModel)
            case .verificationRequired(let email):
                VerifyEmailView(viewModel: viewModel, email: email)
            case .needsMembership:
                JoinCompanyView(viewModel: viewModel)
            case .membershipUnavailable:
                MembershipUnavailableView(viewModel: viewModel)
            case .member(let membership):
                memberContent(membership)
            }
        }
        .task {
            if viewModel.phase == .restoring {
                await viewModel.restoreSession()
            }
        }
    }
}

/// Loading the stored membership failed (e.g. offline). Never guesses a company.
struct MembershipUnavailableView: View {
    let viewModel: AccountsViewModel

    var body: some View {
        AccountsScreen(
            title: "Can't load your company",
            subtitle: "We couldn't check which company you belong to."
        ) {
            AccountsErrorText(error: viewModel.error)
            AccountsPrimaryButton(title: "Try again", isWorking: viewModel.isWorking) {
                Task { await viewModel.retryLoadingMembership() }
            }
            AccountsSecondaryButton(title: "Sign out") {
                Task { await viewModel.signOut() }
            }
        }
    }
}

#if DEBUG
/// Stand-in for the signed-in app in previews.
private struct MemberPlaceholder: View {
    let membership: ActiveMembership
    let viewModel: AccountsViewModel

    var body: some View {
        AccountsScreen(title: "You're in!", subtitle: "Company: \(membership.companyId) · Role: \(membership.role.rawValue)") {
            AccountsSecondaryButton(title: "Sign out") {
                Task { await viewModel.signOut() }
            }
        }
    }
}

private struct AccountsPreview: View {
    @State var viewModel: AccountsViewModel
    var body: some View {
        AccountsRootView(viewModel: viewModel) { MemberPlaceholder(membership: $0, viewModel: viewModel) }
    }
}

// Demo accounts (password "password"): member@ (already a member),
// new@ (verified, no company), unverified@ (needs verification). Code: DEMO-2026.
#Preview("Signed out") { AccountsPreview(viewModel: .demo()) }
#Preview("Verify email") { AccountsPreview(viewModel: .demo(signedInEmail: "unverified@example.invalid")) }
#Preview("Join company") { AccountsPreview(viewModel: .demo(signedInEmail: "new@example.invalid")) }
#Preview("Member") { AccountsPreview(viewModel: .demo(signedInEmail: "member@example.invalid")) }
#endif
