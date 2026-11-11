import DIPCore
import DIPDesignSystem
import SwiftUI

/// The post-membership tour (spec §3 B0–B5 and H): one Stage, one Bar and the Crew, morphing step to step,
/// then a window reveal into whatever `DIPMemberHome` shows underneath.
///
/// It is an overlay: its white background is a `WindowSheet` whose hole is the Stage card, so at handoff
/// the hole grows to the full screen and uncovers the real Home (or Profile, in replay).
struct OnboardingTourView: View {
    let model: OnboardingTourModel
    /// B5's state; nil hosts (previews without an account) show the catalog-failed composition.
    let interests: OnboardingInterestsModel?
    /// For B0's title ("YOU'RE IN, SAM").
    let firstName: String?
    /// For You's initials.
    let youName: String
    /// First run only: the leading "Sign out" on the first step (the step before it was sign-in).
    var onSignOut: (() async -> Void)?
    @State private var signingOut = false

    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Namespace private var crew
    @AccessibilityFocusState private var titleFocused: Bool

    /// The Stage has landed in tour geometry (B0 and the resume entrance morph from the welcome card).
    @State private var landed = false
    @State private var chromeShown = false
    @State private var revealStarted = false
    @State private var stageContentFaded = false
    @State private var barDissolved = false

    private var reduceMotion: Bool { systemReduceMotion || model.configuration.forceReduceMotion }
    private var speed: Double { max(0.01, model.configuration.timeScale) }
    private var features: OnboardingFeatures { model.configuration.features }

    var body: some View {
        GeometryReader { geometry in
            let layout = TourLayout(size: geometry.size)
            Group {
                if dynamicTypeSize.isAccessibilitySize {
                    accessibleLayout(layout)
                } else {
                    standardLayout(layout)
                }
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
        }
        .ignoresSafeArea()
        .preferredColorScheme(.light)
        // Haptics (DIPHaptics): step CTAs are navigation (silent); saving interests is a commit, then success
        // or failure. Demo beats never fire haptics (spec §3.0).
        .onChange(of: model.interestsSaved) { _, saved in if saved { DIPHaptics.success() } }
        .onChange(of: interests?.saveErrorMessage) { _, message in if message != nil { DIPHaptics.failure() } }
        .onAppear(perform: enter)
        .onChange(of: model.step) { _, _ in titleFocused = true }
        .onChange(of: model.handoff) { _, handoff in
            if case .revealing(let surface) = handoff { reveal(surface) }
        }
        .onChange(of: interests?.outcome) { _, outcome in
            switch outcome {
            case .completed(let saved): withAnimation(motion(OnboardingMotion.stage)) { model.finishInterests(saved: saved) }
            case .skipped: withAnimation(motion(OnboardingMotion.stage)) { model.finishInterests(saved: false) }
            case nil: break
            }
        }
        .onChange(of: interests?.announcement) { _, text in
            if let text { AccessibilityNotification.Announcement(text).post() }
        }
        .accessibilityAction(named: Text(OnboardingCopy.previousStep)) { goBack() }
    }

    // MARK: Standard layout

    @ViewBuilder private func standardLayout(_ layout: TourLayout) -> some View {
        let step = model.step ?? model.flow.steps.last ?? .interests
        let stageFrame = stageFrame(layout, step: step)
        ZStack(alignment: .topLeading) {
            WindowSheet(window: revealStarted ? layout.full : stageFrame, radius: revealStarted ? 0 : 20)
                .fill(OnboardingTheme.surface, style: FillStyle(eoFill: true))
                .animation(motion(OnboardingMotion.reveal), value: revealStarted)
                .accessibilityHidden(true)
            stageCard(layout, step: step, frame: stageFrame)
                .opacity(stageContentFaded ? 0 : 1)
            header(layout)
                .opacity(chromeShown && !revealStarted ? 1 : 0)
            copy(layout, step: step)
                .opacity(revealStarted ? 0 : 1)
            if step == .interests { interestsControls(layout) }
            bar(layout)
            if revealStarted, case .revealing(let surface) = model.handoff { youFlight(layout, surface: surface) }
        }
        .frame(width: layout.width, height: layout.size.height, alignment: .topLeading)
    }

    private func stageFrame(_ layout: TourLayout, step: OnboardingStep) -> CGRect {
        guard landed else { return layout.welcome }
        return step == .interests ? layout.strip : layout.stage
    }

    private func stageFill(_ step: OnboardingStep) -> Color {
        guard landed else { return OnboardingTheme.challenge }
        if revealStarted { return .clear }
        switch OnboardingStageFill.fill(for: step) {
        case .challengeAccent: return OnboardingTheme.challenge
        case .actionPrimary: return OnboardingTheme.accent
        case .notificationAccent: return OnboardingTheme.notification
        case .surfaceMuted: return OnboardingTheme.muted
        }
    }

    private func stageCard(_ layout: TourLayout, step: OnboardingStep, frame: CGRect) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: 20, style: .continuous).fill(stageFill(step))
            stageContent(step)
                .opacity(landed ? 1 : 0)
        }
        .frame(width: frame.width, height: frame.height)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .position(x: frame.midX, y: frame.midY)
        .animation(motion(OnboardingMotion.stage), value: frame)
        .animation(motion(OnboardingMotion.stage), value: step)
        .animation(motion(OnboardingMotion.stage), value: landed)
    }

    @ViewBuilder private func stageContent(_ step: OnboardingStep) -> some View {
        switch step {
        case .arrival:
            ArrivalCrew(youName: youName, namespace: crew, speed: speed, reduceMotion: reduceMotion)
                .transition(.opacity)
        case .discover:
            demo(DiscoverJoinScene(youName: youName))
        case .people:
            demo(PeopleInviteScene(features: features, youName: youName))
        case .challenges:
            demo(ChallengeScene(features: features))
        case .memories:
            demo(MemoriesScene())
        case .interests:
            InterestsStrip(names: selectedInterestNames, failed: interests?.catalog == .failed || interests == nil,
                           reduceMotion: reduceMotion)
                .transition(.opacity)
        }
    }

    private func demo<Scene: DemoScene>(_ scene: Scene) -> some View {
        DemoStage(scene: scene, configuration: model.configuration.demo(sceneID: Scene.id))
            .id(Scene.id)
            .transition(.opacity)
    }

    private var selectedInterestNames: [String] {
        guard let interests else { return [] }
        return interests.options.filter { interests.selection.contains($0.id) }.map(\.name)
    }

    // MARK: Header

    private func header(_ layout: TourLayout) -> some View {
        HStack(spacing: 0) {
            if model.flow.canGoBack {
                backButton.padding(.trailing, 8)
            } else if let signOutButton {
                signOutButton.padding(.trailing, 8)
            }
            if let step = model.step, step != .arrival {
                HStack(spacing: 10) {
                    Text(step.pillTitle)
                        .font(DIPReferenceAssets.font("Figtree-Regular", size: 20, relativeTo: .headline))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                        .padding(.horizontal, 16).frame(height: 44)
                        .background(OnboardingTheme.accent, in: Capsule())
                    TourCrewStack(members: model.stackMembers, youName: youName,
                                  youSaved: model.interestsSaved, namespace: crew, hidesYou: revealStarted,
                                  host: model.isHandingOff ? nil : CrewMember.host(of: step))
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text(model.progressLabel ?? step.pillTitle))
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("onboarding.tour.progress")
            }
            Spacer(minLength: 8)
            if model.flow.showsSkip { skipButton }
        }
        .frame(height: TourLayout.headerHeight)
        .padding(.horizontal, TourLayout.side)
        .frame(width: layout.width)
        .offset(y: TourLayout.headerTop)
    }

    private var backButton: some View {
        Button(action: goBack) {
            Image(systemName: "chevron.left")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(OnboardingTheme.ink)
                .frame(width: 44, height: 44)
                .background(OnboardingTheme.muted, in: Circle())
        }
        .buttonStyle(DIPPressFeedbackStyle())
        .accessibilityLabel(Text(OnboardingCopy.back))
        .accessibilityIdentifier("onboarding.tour.back")
    }

    /// The first step of a first run follows sign-in, so its leading control is "Sign out" (owner revision,
    /// Nov 10). Replay and every later step have none or Back; the header then starts flush at the margin.
    private var signOutButton: AnyView? {
        guard model.flow.mode == .firstRun, let onSignOut else { return nil }
        return AnyView(Button {
            guard !signingOut else { return }
            DIPHaptics.commit()
            signingOut = true
            Task { await onSignOut(); signingOut = false }
        } label: {
            // Same 44 pt muted circle, ink glyph, size and weight as Back (the design system has no sign-out
            // asset; Back also uses an SF Symbol here).
            Image(systemName: "rectangle.portrait.and.arrow.right")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(OnboardingTheme.ink)
                .scaleEffect(x: -1, y: 1)
                .frame(width: 44, height: 44)
                .background(OnboardingTheme.muted, in: Circle())
        }
        .buttonStyle(DIPPressFeedbackStyle())
        .disabled(signingOut || model.isHandingOff)
        .accessibilityLabel(Text(OnboardingCopy.signOut))
        .accessibilityIdentifier("onboarding.signOut"))
    }

    private var skipButton: some View {
        Button(action: skip) {
            Text(model.flow.skipTitle)
                .font(DIPReferenceAssets.font("Figtree-Regular", size: 17, relativeTo: .body))
                .foregroundStyle(OnboardingTheme.ink.opacity(0.7))
                .padding(.horizontal, 8)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("onboarding.tour.skip")
    }

    // MARK: Copy

    @ViewBuilder private func copy(_ layout: TourLayout, step: OnboardingStep) -> some View {
        let copy = OnboardingCopy.make(step, firstName: firstName, features: features)
        let style = TourEntranceStyle(step)
        let titleDelay = step == .arrival ? 0.40 : 0.32
        VStack(alignment: .leading, spacing: 10) {
            TourTitle(text: copy.title, style: style, delay: chromeShown ? titleDelay : titleDelay + 0.05,
                      speed: speed, reduceMotion: reduceMotion)
                .accessibilityFocused($titleFocused)
            TourBody(text: copy.body, style: style, delay: step == .arrival ? 0.70 : titleDelay + 0.10,
                     speed: speed, reduceMotion: reduceMotion)
        }
        .frame(width: layout.width - 2 * TourLayout.side, alignment: .leading)
        .id(step)
        .transition(.asymmetric(insertion: .identity,
                                removal: .opacity.combined(with: .offset(y: OnboardingMotion.copyOutOffset))
                                    .animation(OnboardingMotion.copyOut.speed(speed))))
        .offset(x: TourLayout.side, y: step == .interests ? layout.strip.maxY + 22 : layout.titleTop)
    }

    // MARK: B5 picker and secondary

    @ViewBuilder private func interestsControls(_ layout: TourLayout) -> some View {
        let pickerTop = layout.strip.maxY + 120
        if let interests, interests.catalog != .failed {
            DIPInterestPicker(options: interests.options, selection: interests.selectionBinding,
                              embedded: interests.pickerState)
                .frame(width: layout.width - 2 * TourLayout.side,
                       height: max(120, layout.secondaryCenterY - 22 - 12 - pickerTop))
                .offset(x: TourLayout.side, y: pickerTop)
                .opacity(revealStarted ? 0 : 1)
                .transition(.opacity)
        }
        Button(OnboardingCopy.skipForNow) { skipInterests() }
            .font(DIPReferenceAssets.font("Figtree-Regular", size: 17, relativeTo: .body))
            .foregroundStyle(OnboardingTheme.ink)
            .frame(minWidth: 120, minHeight: 44)
            .disabled(interests.map { !$0.canSkip } ?? false)
            .position(x: layout.width / 2, y: layout.secondaryCenterY)
            .opacity(revealStarted ? 0 : 1)
            .accessibilityIdentifier("onboarding.interests.skip")
    }

    // MARK: Bar

    private var barAction: DIPBottomBarAction? {
        if barDissolved { return nil }
        if model.handoff == .waiting {
            return DIPBottomBarAction(title: OnboardingCopy.waitingForHome, identifier: "onboarding.next", showsProgress: true)
        }
        if case .revealing = model.handoff { return nil }
        guard let step = model.step else { return nil }
        if step == .interests {
            guard let bar = interests?.bar else {
                return DIPBottomBarAction(title: OnboardingCopy.make(.interests, firstName: nil, features: features).cta,
                                          identifier: OnboardingInterestsModel.Bar.identifier)
            }
            return DIPBottomBarAction(title: bar.title, style: bar.isAccent ? .accent : .standard,
                                      identifier: OnboardingInterestsModel.Bar.identifier,
                                      value: bar.showsProgress ? "In progress" : nil, showsProgress: bar.showsProgress,
                                      kind: [.saveAndStart, .retry].contains(bar.action) ? .commit : .navigate)
        }
        return DIPBottomBarAction(title: OnboardingCopy.cta(for: step, next: model.nextStep, features: features),
                                  identifier: "onboarding.next")
    }

    private func bar(_ layout: TourLayout) -> some View {
        let fadesOut: Bool = {
            if case .revealing(let surface) = model.handoff { return surface.barTreatment == .fadeOut }
            return false
        }()
        return DIPFloatingNavigation(selected: .home, action: barAction, showsTabs: barDissolved,
                                     onSelect: { _ in }, onAction: barTapped)
            .padding(.horizontal, DIPFloatingNavigation.horizontalInset)
            .frame(width: layout.width)
            .position(x: layout.width / 2, y: layout.barCenterY)
            .disabled(model.isHandingOff || (model.step == .interests && interests?.bar.isEnabled == false))
            .opacity(fadesOut && revealStarted ? 0 : 1)
            .animation(.easeOut(duration: OnboardingHandoff.barFadeDuration / speed)
                .delay(OnboardingHandoff.barAt / speed), value: revealStarted)
    }

    // MARK: Handoff

    /// You (28 pt) flies to the Home header's profile button (spec §3 H at 0.20, `stage`).
    private func youFlight(_ layout: TourLayout, surface: OnboardingHomeSurface) -> some View {
        let target = OnboardingHandoff.profileButtonFrame(width: layout.width)
        return TourYouAvatar(name: youName, size: 40)
            .matchedGeometryEffect(id: "crew.you", in: crew, isSource: false)
            .position(x: target.x + target.size / 2, y: target.y + target.size / 2)
            .opacity(surface.hasProfileButton ? 1 : 0)
            .allowsHitTesting(false)
    }

    private func reveal(_ surface: OnboardingHomeSurface) {
        if reduceMotion {
            withAnimation(.easeInOut(duration: OnboardingHandoff.reducedCrossfade / speed)) {
                stageContentFaded = true
                revealStarted = true
                barDissolved = surface.barTreatment == .dissolveToTabs
            }
            return
        }
        withAnimation(.easeOut(duration: OnboardingHandoff.stageFadeDuration / speed)
            .delay(OnboardingHandoff.stageFadeAt / speed)) { stageContentFaded = true }
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(OnboardingHandoff.windowAt / speed))
            withAnimation(motion(OnboardingMotion.reveal)) { revealStarted = true }
            try? await Task.sleep(for: .seconds((OnboardingHandoff.barAt - OnboardingHandoff.windowAt) / speed))
            if surface.barTreatment == .dissolveToTabs {
                withAnimation(DIPMotion.navigation(reduceMotion: false).speed(speed)) { barDissolved = true }
            }
        }
    }

    // MARK: Entrances

    private func enter() {
        switch model.entrance {
        case .replay:
            landed = true
            chromeShown = true
        case .fresh, .resume:
            if reduceMotion {
                withAnimation(.easeInOut(duration: 0.3 / speed)) { landed = true; chromeShown = true }
                return
            }
            withAnimation(motion(OnboardingMotion.stage).delay(0.05 / speed)) { landed = true }
            let chromeDelay = model.entrance == .fresh ? 0.70 : 0.15
            withAnimation(.easeOut(duration: 0.25 / speed).delay(chromeDelay / speed)) { chromeShown = true }
        }
    }

    // MARK: Actions

    private func barTapped() {
        guard !model.isHandingOff, let step = model.step else { return }
        if step == .interests {
            if let interests { Task { await interests.performBarAction() } }
            else { withAnimation(motion(OnboardingMotion.stage)) { model.finishInterests(saved: false) } }
            return
        }
        withAnimation(motion(OnboardingMotion.stage)) { model.next() }
    }

    /// B5 "Skip for now": nothing is written; the tour finishes with `.finished` (spec §2 Outcomes).
    private func skipInterests() {
        if let interests { interests.skip() } else {
            withAnimation(motion(OnboardingMotion.stage)) { model.finishInterests(saved: false) }
        }
    }

    private func goBack() {
        withAnimation(motion(OnboardingMotion.stage)) { model.back() }
    }

    private func skip() {
        withAnimation(motion(OnboardingMotion.stage)) { model.skip() }
    }

    private func motion(_ animation: Animation) -> Animation {
        reduceMotion ? .easeInOut(duration: 0.3 / speed) : animation.speed(speed)
    }

    // MARK: Accessibility sizes

    /// Every step scrolls with the Bar pinned; the header wraps to two rows; demos become SF Symbol rows.
    private func accessibleLayout(_ layout: TourLayout) -> some View {
        let step = model.step ?? .interests
        let copy = OnboardingCopy.make(step, firstName: firstName, features: features)
        return ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    if model.flow.canGoBack { backButton }
                    Spacer()
                    if model.flow.showsSkip { skipButton }
                }
                if step != .arrival {
                    HStack(spacing: 10) {
                        Text(step.pillTitle)
                            .font(DIPReferenceAssets.font("Figtree-Regular", size: 20, relativeTo: .headline))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 16).padding(.vertical, 8)
                            .background(OnboardingTheme.accent, in: Capsule())
                        TourCrewStack(members: model.stackMembers, youName: youName,
                                      youSaved: model.interestsSaved, namespace: crew)
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(Text(model.progressLabel ?? step.pillTitle))
                    .accessibilityIdentifier("onboarding.tour.progress")
                }
                if step == .arrival { TourYouAvatar(name: youName, size: 56) }
                Text(copy.title.uppercased())
                    .font(DIPReferenceAssets.font("FjallaOne-Regular", size: 34, relativeTo: .largeTitle))
                    .accessibilityLabel(Text(copy.title))
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityIdentifier("onboarding.tour.title")
                    .accessibilityFocused($titleFocused)
                Text(copy.body)
                    .font(DIPReferenceAssets.font("Inter-Regular", size: 16, relativeTo: .body))
                    .accessibilityIdentifier("onboarding.tour.body")
                ForEach(accessibilityRows(step), id: \.self) { row in
                    Label(row.text, systemImage: row.systemImage)
                        .font(DIPReferenceAssets.font("Inter-Regular", size: 16, relativeTo: .body))
                }
                if step == .interests, let interests, interests.catalog != .failed {
                    DIPInterestPicker(options: interests.options, selection: interests.selectionBinding,
                                      embedded: interests.pickerState)
                        .frame(minHeight: 400)
                }
            }
            .foregroundStyle(OnboardingTheme.ink)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, TourLayout.side)
            .padding(.top, 70)
            .padding(.bottom, 24)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: 8) {
                if step == .interests {
                    Button(OnboardingCopy.skipForNow) { skipInterests() }
                        .font(DIPReferenceAssets.font("Figtree-Regular", size: 17, relativeTo: .body))
                        .frame(minHeight: 44)
                        .accessibilityIdentifier("onboarding.interests.skip")
                }
                DIPFloatingNavigation(selected: .home, action: barAction, showsTabs: barDissolved,
                                      onSelect: { _ in }, onAction: barTapped)
                    .disabled(model.isHandingOff)
            }
            .padding(.horizontal, DIPFloatingNavigation.horizontalInset)
            .padding(.bottom, DIPFloatingNavigation.standardInsets.bottom)
            .background(OnboardingTheme.surface)
        }
        .background(OnboardingTheme.surface)
        .opacity(revealStarted ? 0 : 1)
        .onAppear { landed = true; chromeShown = true }
    }

    private func accessibilityRows(_ step: OnboardingStep) -> [DemoAccessibilityRow] {
        switch step {
        case .arrival, .interests: []
        case .discover: DiscoverJoinScene().accessibilityRows
        case .people: PeopleInviteScene(features: features).accessibilityRows
        case .challenges: ChallengeScene(features: features).accessibilityRows
        case .memories: MemoriesScene().accessibilityRows
        }
    }
}
