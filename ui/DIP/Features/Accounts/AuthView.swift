import DIPAccounts
import DIPDesignSystem
import SwiftUI

/// Sign in or create an account with email and password.
struct AuthView: View {
    enum Mode: String, CaseIterable, Identifiable {
        case signIn = "Sign in"
        case signUp = "Create account"
        var id: Self { self }
    }

    let session: AccountsSession
    /// Failure from the previous attempt, from the session state.
    let failure: AccountsFailure?
    @State private var mode: Mode = .signIn
    @State private var email = ""
    @State private var password = ""
    @State private var localProblem: OnboardingValidation.Problem?

    private var message: String? {
        localProblem?.message ?? (session.commandError ?? failure)?.message
    }

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
            .onChange(of: mode) { localProblem = nil }

            AccountsTextField(title: "Email", text: $email)
                .textContentType(.username)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()

            AccountsTextField(title: "Password", text: $password, isSecure: true)
                .textContentType(mode == .signIn ? .password : .newPassword)

            if mode == .signUp {
                Text("At least \(OnboardingValidation.minimumPasswordLength) characters.")
                    .font(.footnote)
                    .foregroundStyle(Color(token: DIPTokens.Color.textPrimary).opacity(0.7))
            }

            AccountsMessageText(message: message)

            AccountsPrimaryButton(title: mode.rawValue, isWorking: session.isSubmitting) {
                Task { await submit() }
            }
        }
    }

    private func submit() async {
        let trimmedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)
        switch mode {
        case .signIn:
            localProblem = OnboardingValidation.signIn(email: trimmedEmail, password: password)
            guard localProblem == nil else { return }
            await session.signIn(email: trimmedEmail, password: password)
        case .signUp:
            localProblem = OnboardingValidation.signUp(email: trimmedEmail, password: password)
            guard localProblem == nil else { return }
            await session.signUp(email: trimmedEmail, password: password)
            // Creating the account does not send the verification email by itself.
            if session.commandError == nil {
                await session.sendVerification()
            }
        }
    }
}
