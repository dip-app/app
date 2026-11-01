import DIPDesignSystem
import SwiftUI

/// Sign in or create an account with email and password.
struct AuthView: View {
    enum Mode: String, CaseIterable, Identifiable {
        case signIn = "Sign in"
        case signUp = "Create account"
        var id: Self { self }
    }

    let viewModel: AccountsViewModel
    @State private var mode: Mode = .signIn
    @State private var email = ""
    @State private var password = ""

    var body: some View {
        AccountsScreen(
            title: "Welcome to DIP",
            subtitle: mode == .signIn
                ? "Sign in to see your company's events."
                : "Create an account with your work email."
        ) {
            Picker("Mode", selection: $mode) {
                ForEach(Mode.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .onChange(of: mode) { viewModel.dismissError() }

            AccountsTextField(title: "Email", text: $email)
                .textContentType(.username)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()

            AccountsTextField(title: "Password", text: $password, isSecure: true)
                .textContentType(mode == .signIn ? .password : .newPassword)

            if mode == .signUp {
                Text("At least \(AccountsViewModel.minimumPasswordLength) characters.")
                    .font(.footnote)
                    .foregroundStyle(Color(token: DIPTokens.Color.textPrimary).opacity(0.7))
            }

            AccountsErrorText(error: viewModel.error)

            AccountsPrimaryButton(title: mode.rawValue, isWorking: viewModel.isWorking) {
                Task {
                    switch mode {
                    case .signIn: await viewModel.signIn(email: email, password: password)
                    case .signUp: await viewModel.signUp(email: email, password: password)
                    }
                }
            }
        }
    }
}
