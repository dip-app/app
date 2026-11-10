import DIPCore
import DIPDesignSystem
import SwiftUI
import UIKit

/// Playback state of a `DemoStage`, reported through `onPhaseChange` (the tour shell and the preview host
/// use it; nothing in the canvas depends on it).
enum DemoPlaybackPhase: Equatable, Sendable {
    /// Showing t = 0 until autoplay starts.
    case waiting
    case playing
    case scrubbing
    /// Paused because the stage disappeared or the app left the foreground.
    case paused
    /// Reduce Motion: showing still `index` of the scene's `reducedStills`.
    case still(Int)
    /// Resting on the final frame with Replay visible.
    case resting
    /// A `freezeAt` capture (debug only).
    case frozen
}

/// Debug and host options for a stage. The defaults are what the tour ships with.
struct DemoStageConfiguration: Equatable, Sendable {
    /// Playback speed multiplier (`-onboarding.timeScale 8` runs the demo 8× faster).
    var timeScale: Double = 1
    /// Render `state(at:)` at this time with animations off and never play (`-onboarding.freezeAt`).
    var freezeAt: Duration?
    /// Force the Reduce Motion stills (`-onboarding.reduceMotion`; Reduce Motion can't be toggled from UI tests).
    var forceReduceMotion = false
    /// Autoplay starts this long after the stage lands (spec §3.0 standard step change, 0.52 s).
    var autoplayDelay: Duration = .milliseconds(520)
    /// Reduce Motion stills: crossfade and hold (spec B1 "Reduce Motion").
    var stillCrossfade = 0.3
    var stillHold = 1.6

    static let standard = DemoStageConfiguration()
}

/// The demo player that fills the Stage card (spec §3.0, §5).
///
/// - Renders `Scene.canvas(state)` on the fixed 390 × 540 white canvas, scaled to fit inside the Stage with a
///   40 pt top gutter (for the `EXAMPLE` chip and the host face) and 16 pt elsewhere, with `scaleEffect` and
///   `compositingGroup`, hit testing off and Dynamic Type pinned to `.large`.
/// - Is exactly one accessibility element: label "Example", value = the scene's description, identifier
///   `onboarding.stage`, action "Replay".
/// - Plays once after `autoplayDelay`, then rests on the final frame with a 44 pt Replay button. Tap replays;
///   a horizontal drag scrubs at 1 pt = 12 ms and releasing resumes from that point.
/// - Pauses on disappear and whenever `scenePhase != .active`, resuming from the current beat's start.
/// - Reduce Motion plays the scene's stills (crossfade 0.3 s, hold 1.6 s); VoiceOver and Low Power Mode open
///   on the final frame until Replay.
/// Stage geometry inside the Stage card (spec §3.0: canvas at x 66, y 174 inside a Stage at x 20, y 134).
enum DemoStageLayout {
    static let topGutter: CGFloat = 40
    static let inset: CGFloat = 16
    static let replaySize: CGFloat = 44

    static func canvasScale(in size: CGSize) -> CGFloat {
        let width = max(0, size.width - 2 * inset), height = max(0, size.height - topGutter - inset)
        return max(0.01, min(width / DemoCanvas.size.width, height / DemoCanvas.size.height))
    }
}

struct DemoStage<Scene: DemoScene>: View {
    private typealias Layout = DemoStageLayout
    let scene: Scene
    var configuration: DemoStageConfiguration = .standard
    var onPhaseChange: ((DemoPlaybackPhase) -> Void)?

    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOverEnabled
    @Environment(\.scenePhase) private var scenePhase

    /// Discrete state: the fold of every beat applied so far, changed inside `withAnimation(beat.animation)`.
    @State private var discrete: Scene.State
    /// The committed timeline position when no live clock runs (scrubbing, stills, rest, pause).
    @State private var clockT: Duration = .zero
    /// Set while playing: maps the TimelineView's date to timeline time for continuous parameters.
    @State private var liveAnchor: LiveAnchor?
    @State private var phase: DemoPlaybackPhase = .waiting
    @State private var playback: Task<Void, Never>?
    @State private var scrubOrigin: Duration?
    @State private var resumeAt: Duration?
    @State private var stillIndex = 0
    @State private var lowPower = ProcessInfo.processInfo.isLowPowerModeEnabled
    @State private var started = false
    /// The canvas draws only after `scene.prepare()` ran outside a view update.
    @State private var prepared = false

    private struct LiveAnchor: Equatable {
        var date: Date
        var t: Duration
    }

    init(scene: Scene, configuration: DemoStageConfiguration = .standard,
         onPhaseChange: ((DemoPlaybackPhase) -> Void)? = nil) {
        self.scene = scene
        self.configuration = configuration
        self.onPhaseChange = onPhaseChange
        _discrete = State(initialValue: scene.script.initial)
    }

    private var reduceMotion: Bool { systemReduceMotion || configuration.forceReduceMotion }
    private var speed: Double { max(0.01, configuration.timeScale) }
    private var script: DemoScript<Scene.State> { scene.script }
    private var showsReplay: Bool {
        phase == .resting || (phase == .frozen && clockT >= script.duration)
    }

    var body: some View {
        GeometryReader { geometry in
            let scale = Layout.canvasScale(in: geometry.size)
            let canvasSize = CGSize(width: DemoCanvas.size.width * scale, height: DemoCanvas.size.height * scale)
            ZStack(alignment: .topLeading) {
                canvasLayer(scale: scale)
                    .frame(width: canvasSize.width, height: canvasSize.height)
                    .position(x: geometry.size.width / 2, y: Layout.topGutter + canvasSize.height / 2)
                DemoExampleChip()
                    .padding(.leading, 12).padding(.top, 11)
                if reduceMotion, !scene.reducedStills.isEmpty {
                    stillDots
                        .position(x: geometry.size.width / 2,
                                  y: min(geometry.size.height - 8, Layout.topGutter + canvasSize.height + 8))
                }
                if showsReplay {
                    replayButton
                        .position(x: geometry.size.width - 2 - Layout.replaySize / 2,
                                  y: geometry.size.height - 12 - Layout.replaySize / 2)
                        .transition(.opacity)
                }
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
            .animation(.easeOut(duration: 0.2), value: showsReplay)
        }
        .contentShape(Rectangle())
        .onTapGesture { replay() }
        .gesture(scrubGesture, including: canScrub ? .all : .none)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Example"))
        .accessibilityValue(Text(scene.description))
        .accessibilityIdentifier("onboarding.stage")
        .accessibilityAction(named: Text("Replay")) { replay() }
        .onAppear {
            if !prepared {
                scene.prepare()
                // Next run loop turn: the PNGs are cached before the canvas body runs.
                Task { @MainActor in prepared = true }
            }
            if !started { started = true; start() } else { resume() }
        }
        .onDisappear { pause() }
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .active { resume() } else { pause() }
        }
        .onReceive(NotificationCenter.default.publisher(for: .NSProcessInfoPowerStateDidChange)) { _ in
            lowPower = ProcessInfo.processInfo.isLowPowerModeEnabled
        }
        .onChange(of: phase, initial: true) { _, newPhase in onPhaseChange?(newPhase) }
    }

    // MARK: Rendering

    private func canvasLayer(scale: CGFloat) -> some View {
        TimelineView(.animation(minimumInterval: nil, paused: liveAnchor == nil)) { context in
            Group {
                if prepared {
                    scene.canvas(rendered(at: context.date))
                } else {
                    scene.stageFill
                }
            }
            .frame(width: DemoCanvas.size.width, height: DemoCanvas.size.height)
        }
        .background(.white)
        .clipShape(RoundedRectangle(cornerRadius: DemoCanvas.cornerRadius, style: .continuous))
        .environment(\.dynamicTypeSize, .large)
        .environment(\.colorScheme, .light)
        .allowsHitTesting(false)
        .compositingGroup()
        .id(reduceMotion ? stillIndex : -1)
        .transition(.opacity)
        .scaleEffect(scale, anchor: .topLeading)
        .frame(width: DemoCanvas.size.width * scale, height: DemoCanvas.size.height * scale, alignment: .topLeading)
    }

    private func rendered(at date: Date) -> Scene.State {
        var state = discrete
        scene.applyContinuous(&state, at: liveTime(at: date) ?? clockT)
        return state
    }

    private func liveTime(at date: Date) -> Duration? {
        guard let liveAnchor else { return nil }
        let elapsed = max(0, date.timeIntervalSince(liveAnchor.date)) * speed
        return min(script.duration, liveAnchor.t + .seconds(elapsed))
    }

    private var stillDots: some View {
        HStack(spacing: 6) {
            ForEach(scene.reducedStills.indices, id: \.self) { index in
                Circle()
                    .fill(OnboardingTheme.ink.opacity(index == stillIndex ? 1 : 0.25))
                    .frame(width: 6, height: 6)
            }
        }
        .accessibilityHidden(true)
    }

    private var replayButton: some View {
        Button(action: replay) {
            Image(systemName: "arrow.counterclockwise")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(OnboardingTheme.ink)
                .frame(width: Layout.replaySize, height: Layout.replaySize)
                .background(.white, in: Circle())
                .contentShape(Circle())
        }
        .buttonStyle(DIPPressFeedbackStyle())
        .accessibilityHidden(true)
    }

    // MARK: Playback

    private func start() {
        if let requested = configuration.freezeAt {
            let freeze = min(max(requested, .zero), script.duration)
            cancelPlayback()
            if reduceMotion, let index = scene.reducedStills.lastIndex(where: { $0 <= freeze }) { stillIndex = index }
            apply(at: freeze)
            phase = .frozen
            return
        }
        if voiceOverEnabled || lowPower {
            rest()
            return
        }
        if reduceMotion, let first = scene.reducedStills.first {
            stillIndex = 0
            apply(at: first)
        } else {
            apply(at: .zero)
        }
        phase = .waiting
        let delay = configuration.autoplayDelay / speed
        playback = Task { @MainActor in
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled else { return }
            if reduceMotion { playStills() } else { play(from: .zero) }
        }
    }

    /// Replay from the start (tap, the Replay button or the accessibility action). Works in every mode.
    private func replay() {
        guard phase != .scrubbing else { return }
        if reduceMotion { playStills() } else { play(from: .zero) }
    }

    private func play(from start: Duration) {
        cancelPlayback()
        let script = self.script, speed = self.speed
        apply(at: start)
        let clock = ContinuousClock()
        let begin = clock.now
        liveAnchor = LiveAnchor(date: Date(), t: start)
        phase = .playing
        playback = Task { @MainActor in
            for beat in script.beats(between: start, and: script.duration) {
                try? await clock.sleep(until: begin + (beat.at - start) / speed)
                guard !Task.isCancelled else { return }
                withAnimation(beat.animation.swiftUI(speed: speed)) { beat.action(&discrete) }
            }
            try? await clock.sleep(until: begin + (script.duration - start) / speed)
            guard !Task.isCancelled else { return }
            rest()
        }
    }

    private func playStills() {
        cancelPlayback()
        let stills = scene.reducedStills
        guard let first = stills.first else { return rest() }
        let script = self.script, speed = self.speed
        let crossfade = configuration.stillCrossfade / speed, hold = configuration.stillHold / speed
        stillIndex = 0
        apply(at: first)
        phase = .still(0)
        playback = Task { @MainActor in
            for (index, t) in stills.enumerated().dropFirst() {
                try? await Task.sleep(for: .seconds(hold))
                guard !Task.isCancelled else { return }
                // Each still is a whole-canvas crossfade: the canvas identity changes with `stillIndex`.
                withAnimation(.easeInOut(duration: crossfade)) {
                    stillIndex = index
                    discrete = script.state(at: t)
                    clockT = t
                }
                phase = .still(index)
                try? await Task.sleep(for: .seconds(crossfade))
            }
            try? await Task.sleep(for: .seconds(hold))
            guard !Task.isCancelled else { return }
            phase = .resting
        }
    }

    /// Rest on the final frame with Replay visible.
    private func rest() {
        cancelPlayback()
        if reduceMotion { stillIndex = max(0, scene.reducedStills.count - 1) }
        apply(at: script.duration)
        phase = .resting
    }

    private func pause() {
        guard phase == .playing || phase == .waiting || phase == .scrubbing || isStill else { return }
        let now = currentTime()
        // Resume from the start of the beat in progress, so a beat never resumes half-applied.
        resumeAt = script.beats.last(where: { $0.at <= now })?.at ?? .zero
        cancelPlayback()
        if let resumeAt { apply(at: resumeAt) }
        phase = .paused
    }

    private func resume() {
        guard phase == .paused else { return }
        let from = resumeAt ?? .zero
        resumeAt = nil
        if reduceMotion { playStills() } else { play(from: from) }
    }

    private var isStill: Bool {
        if case .still = phase { return true }
        return false
    }

    private func currentTime() -> Duration { liveTime(at: Date()) ?? clockT }

    private func cancelPlayback() {
        playback?.cancel()
        playback = nil
        liveAnchor = nil
    }

    /// Shows `state(at: t)` with every animation disabled (scrubbing, freezeAt, stills, rest).
    private func apply(at t: Duration) {
        var transaction = Transaction(animation: nil)
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            discrete = script.state(at: t)
            clockT = t
        }
    }

    // MARK: Scrubbing

    private var canScrub: Bool { !reduceMotion && phase != .frozen }

    private var scrubGesture: some Gesture {
        DragGesture(minimumDistance: 10)
            .onChanged { value in
                if scrubOrigin == nil {
                    guard abs(value.translation.width) > abs(value.translation.height) else { return }
                    scrubOrigin = currentTime()
                    cancelPlayback()
                    phase = .scrubbing
                }
                guard let origin = scrubOrigin else { return }
                apply(at: script.scrubbedTime(from: origin, dragging: value.translation.width))
            }
            .onEnded { _ in
                guard scrubOrigin != nil else { return }
                scrubOrigin = nil
                if clockT >= script.duration { rest() } else { play(from: clockT) }
            }
    }
}

/// The `EXAMPLE` chip every Stage carries (spec §1 "Honest demos", §3.0): Inter Medium 11, tracking 0.6,
/// ink on white at 85%, height 22.
struct DemoExampleChip: View {
    var body: some View {
        Text("EXAMPLE")
            .font(DIPReferenceAssets.font("Inter-Medium", size: 11))
            .tracking(0.6)
            .foregroundStyle(OnboardingTheme.ink)
            .padding(.horizontal, 8)
            .frame(height: 22)
            .background(.white.opacity(0.85), in: Capsule())
            .environment(\.dynamicTypeSize, .large)
            .accessibilityHidden(true)
    }
}
