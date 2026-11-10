import DIPAccounts
import DIPContracts
import DIPCore
import DIPDesignSystem
import SwiftUI

/// Preview-only harness for onboarding step B5 (a proposal pending team approval). It lays the
/// embedded picker and `OnboardingInterestsModel` out roughly like Figma frame 17:1500 so the
/// data/logic can be exercised; the real tour shell (header, Stage, motion) is separate work.
///
/// Launch arguments: `--onboarding-interests`, plus optionally `--onboarding-interests-fail`
/// (first save fails), `--onboarding-interests-loading` (catalog never arrives),
/// `--onboarding-interests-catalog-fail` and `--onboarding-interests-empty`.
struct OnboardingInterestsPreview: View {
    @State private var editor: ProfileEditor
    @State private var catalog: InterestCatalog
    @State private var model: OnboardingInterestsModel

    init(arguments: [String] = ProcessInfo.processInfo.arguments) {
        let repository = InterestsPreviewRepository(
            failSaves: arguments.contains("--onboarding-interests-fail") ? 1 : 0,
            catalog: arguments.contains("--onboarding-interests-loading") ? .never
                : arguments.contains("--onboarding-interests-catalog-fail") ? .fail
                : arguments.contains("--onboarding-interests-empty") ? .empty : .standard)
        // Matches PreviewAccountsRepository's built-in synthetic member (no real person).
        let profile = AppUser(
            id: "preview-member@example.invalid", companyId: "company-demo", displayName: "Sam Rivera",
            email: "member@example.invalid", photoURL: "", avatarId: "", department: "", jobTitle: "", city: "",
            role: "member", interestTagIds: [], travelRadiusMiles: 20, availability: [], friendIds: [],
            favoritePhotoIds: [], pointsBalance: 0, createdAt: Date(timeIntervalSince1970: 0))
        // swiftlint:disable:next force_try
        let context = try! MembershipContext(uid: profile.id, profile: profile)
        let editor = ProfileEditor(context: context, repository: repository)
        _editor = State(initialValue: editor)
        _catalog = State(initialValue: InterestCatalog(repository: repository))
        _model = State(initialValue: OnboardingInterestsModel(editor: editor, uid: context.uid))
    }

    var body: some View {
        Group {
            if let outcome = model.outcome {
                finished(outcome)
            } else if model.shouldSkipStep {
                Text("Interests step skipped: the catalog is empty.")
                    .accessibilityIdentifier("onboarding.interests.skippedStep")
            } else {
                step
            }
        }
        .task {
            model.updateCatalog(catalog.state)
            await catalog.load()
        }
        .onChange(of: catalog.state) { _, state in model.updateCatalog(state) }
        .onChange(of: editor.profile) { _, _ in model.receiveProfile() }
        .sensoryFeedback(.success, trigger: model.outcome) { _, new in new == .completed(saved: true) }
        .sensoryFeedback(.selection, trigger: model.selection)
        .onChange(of: model.announcement) { _, text in
            if let text { AccessibilityNotification.Announcement(text).post() }
        }
        .preferredColorScheme(.light)
    }

    private var step: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Your interests")
                .font(DIPReferenceAssets.font("Figtree-Regular", size: 20, relativeTo: .headline))
                .foregroundStyle(.white)
                .padding(.horizontal, 20).frame(height: 44)
                .background(DIPTokens.Color.actionPrimary.swiftUIColor, in: Capsule())
                .padding(.top, 8)
            strip.padding(.top, 20)
            Text("WHAT ARE YOU INTO?")
                .font(DIPReferenceAssets.font("FjallaOne-Regular", size: 34, relativeTo: .largeTitle))
                .padding(.top, 22)
                .accessibilityAddTraits(.isHeader)
            Text("Pick a few. You can filter events by them anytime, and change them in Profile.")
                .font(DIPReferenceAssets.font("Inter-Regular", size: 16, relativeTo: .body))
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 6)
            DIPInterestPicker(options: model.options, selection: model.selectionBinding, embedded: model.pickerState)
                .padding(.top, 12)
                .frame(maxHeight: .infinity, alignment: .top)
            Button("Skip for now") { model.skip() }
                .font(DIPReferenceAssets.font("Figtree-Regular", size: 17, relativeTo: .body))
                .frame(maxWidth: .infinity, minHeight: 44)
                .disabled(!model.canSkip)
                .accessibilityIdentifier("onboarding.interests.skip")
            DIPFloatingNavigation(
                action: DIPBottomBarAction(
                    title: model.bar.title, style: model.bar.isAccent ? .accent : .standard,
                    identifier: OnboardingInterestsModel.Bar.identifier,
                    value: model.bar.showsProgress ? "In progress" : nil),
                showsTabs: false, onSelect: { _ in },
                onAction: { Task { await model.performBarAction() } })
            .disabled(!model.bar.isEnabled)
            .padding(.top, 12)
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 8)
        .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor)
        .background(DIPTokens.Color.surfaceDefault.swiftUIColor.ignoresSafeArea())
        .animation(DIPMotion.navigation(), value: model.bar)
    }

    /// Without F1's event cards the strip shows only the chips (spec B5 "live reshape").
    private var strip: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 20, style: .continuous).fill(DIPTokens.Color.surfaceMuted.swiftUIColor)
            if model.catalog == .failed {
                OnboardingFace(fill: Color(token: DIPTokens.Color.surfaceMuted), mood: .calm, size: 64)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        chip("All events", selected: false)
                        ForEach(model.options.filter { model.selection.contains($0.id) }) { chip($0.name, selected: true) }
                    }
                    .padding(.horizontal, 16)
                }
                .frame(maxHeight: .infinity, alignment: .top)
                .padding(.top, 16)
            }
        }
        .frame(height: 140)
        .accessibilityHidden(true)
    }

    private func chip(_ title: String, selected: Bool) -> some View {
        Text(title)
            .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
            .foregroundStyle(selected ? .white : DIPTokens.Color.textPrimary.swiftUIColor)
            .padding(.horizontal, 12).frame(height: 32)
            .background(selected ? DIPTokens.Color.actionPrimary.swiftUIColor : .white, in: Capsule())
            .transition(.scale(scale: 0.6).combined(with: .opacity))
    }

    private func finished(_ outcome: OnboardingInterestsModel.Outcome) -> some View {
        let text = switch outcome {
        case .skipped: "Skipped"
        case .completed(saved: false): "Finished without changes"
        case .completed(saved: true): "Saved \(editor.profile.interestTagIds.count) interests"
        }
        return Text(text)
            .font(DIPReferenceAssets.font("Figtree-Regular", size: 24, relativeTo: .title))
            .accessibilityIdentifier("onboarding.interests.done")
    }
}

/// Wraps the in-memory preview repository, signed in as its built-in synthetic member, with
/// scripted catalog and save failures for the B5 states.
@MainActor
private final class InterestsPreviewRepository: AccountsRepository, InterestCatalogRepository {
    enum CatalogMode { case standard, never, fail, empty }
    private let base = PreviewAccountsRepository(signedInEmail: "member@example.invalid", delay: .milliseconds(400))
    private var failSaves: Int
    private let catalog: CatalogMode

    init(failSaves: Int, catalog: CatalogMode) {
        self.failSaves = failSaves
        self.catalog = catalog
    }

    func observations() -> AsyncStream<AccountObservation> { base.observations() }
    func signInWithGoogle() async throws { try await base.signInWithGoogle() }
    func signOut() async throws { try await base.signOut() }
    func refreshIdentity() async throws { try await base.refreshIdentity() }
    func resolveMembership() async throws -> ResolveMembershipResponse { try await base.resolveMembership() }

    func updateProfile(uid: String, _ profile: EditableProfile) async throws {
        if failSaves > 0 {
            failSaves -= 1
            try await Task.sleep(for: .milliseconds(400))
            throw AccountsFailure.unavailable
        }
        try await base.updateProfile(uid: uid, profile)
    }

    func interestTags() async throws -> [InterestTag] {
        switch catalog {
        case .standard: return try await base.interestTags()
        case .empty: return []
        case .fail:
            try await Task.sleep(for: .milliseconds(400))
            throw AccountsFailure.unavailable
        case .never:
            try await Task.sleep(for: .seconds(3600))
            return []
        }
    }
}
