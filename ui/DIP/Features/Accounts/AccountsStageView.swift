import Combine
import DIPAccounts
import DIPDesignSystem
import SwiftUI

/// Every non-member sign-in state (A0 pending, A1 welcome, A2 resolving, A3 no company,
/// A4 problem) as one long-lived composition: the Stage, its Crew, the copy and the one Bar stay
/// mounted and change shape per route instead of being replaced. Actions never guess a company.
struct AccountsStageView: View {
    let session: AccountsSession

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.scenePhase) private var scenePhase

    @State private var pendingLook: PendingLook = .cold
    @State private var stageVisible = false
    @State private var footerShown = false
    @State private var lowPower = ProcessInfo.processInfo.isLowPowerModeEnabled
    // Reel.
    @State private var reelIndex = 0
    @State private var reelRun = 0
    @State private var hopping: CrewMember?
    @State private var yellowEye: Double?
    // Arrival and search effects.
    @State private var glance: Double = 0
    @State private var wobble: Double = 0
    @State private var linkTrim: CGFloat = 1
    // Feedback and accessibility.
    @State private var signInTaps = 0
    @State private var warnings = 0
    @State private var lastNotice: AccountsNotice?
    @AccessibilityFocusState private var titleFocused: Bool

    /// Set by `AccountsRootView` while it holds "Finding your company" for its minimum display time; nil shows
    /// the session's own route.
    var heldRoute: AccountsRoute?

    private var route: AccountsRoute { heldRoute ?? AccountsRoute(session.state) }
    private var scene: AccountsStageScene {
        AccountsStageScene.make(route: route, isSubmitting: session.isSubmitting, pendingLook: pendingLook)
            ?? AccountsStageScene.make(route: .pending)!
    }
    private var showsStage: Bool { !dynamicTypeSize.isAccessibilitySize }
    private var loopsAllowed: Bool { !lowPower && scenePhase == .active }

    var body: some View {
        let scene = scene
        GeometryReader { _ in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if showsStage { stage(scene) }
                    copy(scene)
                }
                .padding(.horizontal, DIPFloatingNavigation.horizontalInset)
                .padding(.top, 60).padding(.bottom, 20)
                .frame(maxWidth: OnboardingMetrics.readingWidth, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .scrollBounceBehavior(.basedOnSize)
            .safeAreaInset(edge: .bottom, spacing: 0) { footer(scene) }
        }
        .ignoresSafeArea(.container)
        .background(OnboardingTheme.surface.ignoresSafeArea())
        .foregroundStyle(OnboardingTheme.ink)
        .preferredColorScheme(.light)
        // The sign-in press is a `commit` on its Bar action (DIPHaptics); blocked arrivals warn once.
        .onChange(of: warnings) { _, _ in DIPHaptics.failure() }
        .onAppear {
            withAnimation(reduceMotion ? nil : .easeOut(duration: 0.25)) { stageVisible = true }
            // The Bar rises into place just after the Stage (no travel with Reduce Motion).
            withAnimation(reduceMotion ? nil : OnboardingMotion.hop.delay(0.2)) { footerShown = true }
        }
        .onReceive(NotificationCenter.default.publisher(for: .NSProcessInfoPowerStateDidChange)
            .receive(on: RunLoop.main)) { _ in
                lowPower = ProcessInfo.processInfo.isLowPowerModeEnabled
            }
        .onChange(of: route, initial: true) { _, _ in arrived(scene) }
        .task(id: ReelKey(active: scene.pill == .reel && !session.isSubmitting && loopsAllowed, run: reelRun)) {
            guard scene.pill == .reel, !session.isSubmitting, loopsAllowed else { return }
            await runReel()
        }
        .task(id: scene.isSearching && loopsAllowed && !reduceMotion) {
            guard scene.isSearching, loopsAllowed, !reduceMotion else {
                withAnimation(.easeInOut(duration: 0.3)) { glance = 0 }
                return
            }
            await runSearch()
        }
        .task(id: scene.copy?.key) { await runArrival(scene) }
    }

    // MARK: Stage

    private func stage(_ scene: AccountsStageScene) -> some View {
        GeometryReader { geometry in
            let midX = geometry.size.width / 2
            ZStack(alignment: .topLeading) {
                RoundedRectangle(cornerRadius: DIPTokens.Radius.card, style: .continuous)
                    .fill(scene.tone.fill.color)
                    .animation(reduceMotion ? OnboardingMotion.reducedCrossfade : OnboardingMotion.stage,
                               value: scene.tone)
                crew(scene.formation, midX: midX)
                    // Reduce Motion: formations crossfade into their final pose instead of moving.
                    .id(reduceMotion ? crewIdentity(scene) : "crew")
                    .transition(.opacity.animation(OnboardingMotion.reducedCrossfade))
                pill(scene.pill)
                    .position(x: midX, y: 38)
            }
        }
        .frame(height: CrewFormation.stageHeight)
        .opacity(stageVisible ? 1 : 0)
        .contentShape(Rectangle())
        .onTapGesture { if scene.pill == .reel { reelRun += 1 } }
        .accessibilityHidden(true)
        .accessibilityIdentifier("onboarding.stage")
    }

    private func crewIdentity(_ scene: AccountsStageScene) -> String {
        scene.formation == .empty ? "empty" : "\(scene.tone)"
    }

    private func crew(_ formation: CrewFormation, midX: CGFloat) -> some View {
        ZStack(alignment: .topLeading) {
            link(formation)
            ForEach(formation.slots, id: \.member) { slot in
                face(slot, formation: formation)
                    .position(x: midX + slot.x, y: slot.y)
                    .zIndex(slot.zIndex)
                    // Faces grow out of the Stage colour, 60 ms apart, left to right.
                    .animation(reduceMotion ? OnboardingMotion.reducedCrossfade
                               : OnboardingMotion.crewEntrance.delay(0.06 * Double(slot.member.rawValue)),
                               value: slot.isShown)
            }
        }
        // The formation re-composes 0.1 s after the fill starts to change.
        .animation(reduceMotion ? OnboardingMotion.reducedCrossfade : OnboardingMotion.stage.delay(0.1),
                   value: formation)
    }

    private func face(_ slot: CrewSlot, formation: CrewFormation) -> some View {
        var rig = slot.rig
        rig.gaze = glance
        if slot.member == .yellow, let yellowEye { rig.eyeOpen = yellowEye }
        let isLead = slot.zIndex >= 10
        return OnboardingFace(fill: slot.fill.color, figure: slot.member.figure, rig: rig, size: slot.size)
            .rotationEffect(.degrees(isLead ? wobble : 0))
            .offset(y: hopping == slot.member ? -6 : 0)
            .scaleEffect(slot.isShown ? 1 : 0.6)
            .opacity(slot.isShown ? slot.opacity : 0)
    }

    /// Offline only: a dashed line from each side face to the centre face, broken in the middle.
    private func link(_ formation: CrewFormation) -> some View {
        let y = CrewFormation.leadY
        let outer = CrewFormation.sideX - CrewFormation.sideSize / 2
        let inner = CrewFormation.leadSize / 2
        let mid = (outer + inner) / 2
        return GeometryReader { geometry in
            let cx = geometry.size.width / 2
            ZStack {
                ForEach([-1.0, 1.0], id: \.self) { side in
                    // Each half runs from a face's edge toward the gap, so trimming opens the middle.
                    LinkHalf(from: CGPoint(x: cx + side * outer, y: y), to: CGPoint(x: cx + side * mid, y: y))
                        .trim(from: 0, to: linkTrim)
                        .stroke(OnboardingTheme.ink, style: StrokeStyle(lineWidth: 2, lineCap: .round, dash: [4, 4]))
                    LinkHalf(from: CGPoint(x: cx + side * inner, y: y), to: CGPoint(x: cx + side * mid, y: y))
                        .trim(from: 0, to: linkTrim)
                        .stroke(OnboardingTheme.ink, style: StrokeStyle(lineWidth: 2, lineCap: .round, dash: [4, 4]))
                }
            }
        }
        .opacity(formation.showsLink ? 1 : 0)
        .animation(reduceMotion ? OnboardingMotion.reducedCrossfade : .easeOut(duration: 0.25), value: formation.showsLink)
    }

    private func pill(_ pill: StagePill?) -> some View {
        let text: String? = switch pill {
        case .reel: lowPower ? StagePill.entries[0] : StagePill.entries[reelIndex % StagePill.entries.count]
        case .looking: StagePill.lookingText
        case nil: nil
        }
        return ZStack {
            if let text {
                Text(text)
                    .font(DIPReferenceAssets.font("Inter-Regular", size: 15, relativeTo: .subheadline))
                    .lineLimit(1)
                    .id(text)
                    .transition(reduceMotion ? .opacity : .push(from: .bottom))
            }
        }
        .padding(.horizontal, 16)
        .frame(height: 32)
        .background(.white, in: Capsule())
        .clipShape(Capsule())
        .animation(reduceMotion ? .linear(duration: DIPMotion.reducedMotionDuration)
                   : OnboardingMotion.pill, value: text)
        .opacity(text == nil ? 0 : 1)
        .animation(OnboardingMotion.copyOut, value: text == nil)
    }

    // MARK: Copy

    /// Title and body sit under a clip that starts at the Stage's bottom edge, so entrances
    /// appear from behind (A1) or drop out of (A3/A4) the Stage.
    private func copy(_ scene: AccountsStageScene) -> some View {
        let copy = scene.copy
        return VStack(alignment: .leading, spacing: DIPTokens.Spacing.related) {
            ZStack(alignment: .topLeading) {
                if let copy {
                    OnboardingTitle(text: copy.title)
                        .accessibilityFocused($titleFocused)
                        .id(copy.key)
                        .transition(entrance(copy.entrance, delay: copy.entrance.titleDelay))
                }
            }
            ZStack(alignment: .topLeading) {
                if let copy {
                    Text(copy.body)
                        .font(DIPReferenceAssets.font("Inter-Regular", size: 16, relativeTo: .body))
                        .fixedSize(horizontal: false, vertical: true)
                        .opacity(copy.isDimmed ? 0.45 : 1)
                        .animation(.easeInOut(duration: 0.3), value: copy.isDimmed)
                        .accessibilityIdentifier("onboarding.body")
                        .id(copy.key)
                        .transition(entrance(copy.entrance, delay: copy.entrance.titleDelay + copy.entrance.bodyDelay))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, showsStage ? DIPTokens.Spacing.sectionGap : 0)
        .mask(alignment: .top) { Rectangle().padding(.bottom, -4000) }
        .animation(OnboardingMotion.stage, value: copy?.key)
    }

    private func entrance(_ entrance: StageCopy.Entrance, delay: Double) -> AnyTransition {
        if reduceMotion { return .opacity.animation(OnboardingMotion.reducedCrossfade) }
        let spring = entrance == .rise ? OnboardingMotion.stage : OnboardingMotion.drop
        return .asymmetric(
            insertion: .modifier(active: CopyShift(y: entrance.offset, opacity: 0), identity: CopyShift(y: 0, opacity: 1))
                .animation(spring.delay(delay)),
            removal: .modifier(active: CopyShift(y: OnboardingMotion.copyOutOffset, opacity: 0),
                               identity: CopyShift(y: 0, opacity: 1))
                .animation(OnboardingMotion.copyOut.delay(0.05)))
    }

    // MARK: Footer and Bar

    private func footer(_ scene: AccountsStageScene) -> some View {
        VStack(spacing: 12) {
            ZStack {
                if let footnote = scene.footnote {
                    Text(footnote)
                        .font(DIPReferenceAssets.font("Inter-Regular", size: 13, relativeTo: .footnote))
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 8)
                        .accessibilityIdentifier("onboarding.work-account-guidance")
                        .transition(.opacity)
                }
                if let secondary = scene.secondary {
                    Button(secondary.title) { perform(secondary.intent) }
                        .font(DIPReferenceAssets.font("Figtree-Regular", size: 17, relativeTo: .body))
                        .foregroundStyle(OnboardingTheme.ink)
                        .frame(minWidth: 44, minHeight: 44)
                        .padding(.horizontal, 12)
                        .contentShape(Rectangle())
                        .disabled(!scene.secondaryEnabled)
                        .accessibilityIdentifier("onboarding.secondary")
                        .transition(.opacity.animation(
                            reduceMotion ? OnboardingMotion.reducedCrossfade : .easeOut(duration: 0.2).delay(0.45)))
                }
            }
            .animation(OnboardingMotion.bar(reduceMotion: reduceMotion), value: scene.footnote)
            .animation(OnboardingMotion.bar(reduceMotion: reduceMotion), value: scene.secondary?.title)
            DIPFloatingNavigation(
                action: scene.bar, showsTabs: false,
                onSelect: { _ in }, onAction: { perform(scene.barIntent) })
                .disabled(!scene.barEnabled)
        }
        .padding(.horizontal, DIPFloatingNavigation.standardInsets.leading)
        .padding(.top, 16)
        .padding(.bottom, DIPFloatingNavigation.standardInsets.bottom)
        .frame(maxWidth: OnboardingMetrics.readingWidth)
        .frame(maxWidth: .infinity)
        .background(OnboardingTheme.surface)
        .offset(y: footerShown || reduceMotion ? 0 : 24)
        .opacity(footerShown || reduceMotion ? 1 : 0)
    }

    private func perform(_ intent: StageIntent) {
        switch intent {
        case .none:
            break
        case .signIn:
            signInTaps += 1
            pendingLook = .retry
            Task { await session.signInWithGoogle() }
        case .notice(let action):
            pendingLook = PendingLook(after: action)
            switch action {
            case .retryMembership: Task { await session.retryMembership() }
            case .restart: session.start()
            case .signOut: Task { await session.signOut() }
            }
        }
    }

    // MARK: Choreography

    /// Haptics and accessibility for a new copy state (a new notice, Welcome or the search).
    private func arrived(_ scene: AccountsStageScene) {
        if AccountsStageScene.warnsOnArrival(scene, previousNotice: lastNotice) { warnings += 1 }
        if let notice = scene.notice { lastNotice = notice } else if route == .welcome { lastNotice = nil }
        if route == .resolving {
            AccessibilityNotification.Announcement(AccountsStageScene.resolvingAnnouncement).post()
        }
    }

    /// Per-tone arrival beats (spec A3/A4 storyboard), then focus to the new title.
    private func runArrival(_ scene: AccountsStageScene) async {
        var reset = Transaction(animation: nil)
        reset.disablesAnimations = true
        withTransaction(reset) {
            wobble = 0
            if scene.tone == .offline { linkTrim = reduceMotion ? 0.4 : 1 }
        }
        if scene.notice != nil {
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(450))
                titleFocused = true
                AccessibilityNotification.ScreenChanged(nil).post()
            }
        }
        guard !reduceMotion, scene.notice != nil else { return }
        do {
            try await Task.sleep(for: .milliseconds(100))
            switch scene.tone {
            case .notFound:
                for target in [-1.0, 1.0, -1.0, 1.0, 0.0] {
                    withAnimation(.easeInOut(duration: 0.5)) { glance = target }
                    try await Task.sleep(for: .milliseconds(500))
                }
            case .offline:
                withAnimation(.easeOut(duration: 0.35)) { linkTrim = 0.4 }
            case .problem:
                for target in [2.0, -2.0, 2.0, -2.0, 0.0] {
                    withAnimation(.easeInOut(duration: 0.12)) { wobble = target }
                    try await Task.sleep(for: .milliseconds(120))
                }
            case .blocked, .welcome:
                withAnimation(.easeInOut(duration: 0.3)) { glance = 0 }
            }
        } catch {
            glance = 0
            wobble = 0
        }
    }

    /// Gaze −1 → +1 → 0 every 1.2 s while the company resolves.
    private func runSearch() async {
        while !Task.isCancelled {
            for target in [-1.0, 1.0, 0.0] {
                withAnimation(.easeInOut(duration: 0.4)) { glance = target }
                do { try await Task.sleep(for: .milliseconds(400)) } catch {
                    withAnimation(.easeInOut(duration: 0.3)) { glance = 0 }
                    return
                }
            }
        }
    }

    /// Every 2.4 s (4 s with Reduce Motion) the pill changes; one face hops in turn and every
    /// third change winks the square face. After three cycles the reel rests on its first entry.
    private func runReel() async {
        let interval = reduceMotion ? StagePill.reducedReelInterval : StagePill.reelInterval
        let count = StagePill.entries.count
        let changes = count * StagePill.reelCycles - reelIndex % count
        for change in 1...max(changes, 1) {
            do { try await Task.sleep(for: .seconds(interval)) } catch { return }
            reelIndex = (reelIndex + 1) % count
            guard !reduceMotion else { continue }
            let member = CrewMember.allCases[(change - 1) % CrewMember.allCases.count]
            withAnimation(OnboardingMotion.hop) { hopping = member }
            if change % 3 == 0 { Task { await wink() } }
            try? await Task.sleep(for: .milliseconds(250))
            withAnimation(OnboardingMotion.hop) { hopping = nil }
        }
    }

    /// The square face's continuous wink (spec v3 §5): the eye closes (0.12 s), holds (0.3 s) and
    /// opens (0.16 s), easeInOut both ways, passing through the diagonal squint each way.
    private func wink() async {
        withAnimation(.easeInOut(duration: OnboardingMotion.winkClose)) { yellowEye = 0 }
        try? await Task.sleep(for: .seconds(OnboardingMotion.winkClose + OnboardingMotion.winkHold))
        withAnimation(.easeInOut(duration: OnboardingMotion.winkOpen)) { yellowEye = 1 }
        try? await Task.sleep(for: .seconds(OnboardingMotion.winkOpen))
        yellowEye = nil
    }

    private struct ReelKey: Equatable {
        let active: Bool
        let run: Int
    }
}

/// Copy entrance/exit geometry: vertical offset plus opacity.
private struct CopyShift: ViewModifier {
    let y: CGFloat
    let opacity: Double
    func body(content: Content) -> some View {
        content.offset(y: y).opacity(opacity)
    }
}

private struct LinkHalf: Shape {
    let from: CGPoint
    let to: CGPoint
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: from)
        path.addLine(to: to)
        return path
    }
}
