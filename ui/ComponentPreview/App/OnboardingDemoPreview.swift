import DIPCore
import DIPDesignSystem
import SwiftUI

/// Preview-only host for one onboarding demo (`--onboarding-demo=discover`).
///
/// It draws the Stage card at the tour's geometry (spec §3.0: x 20, y 134, 362 × 429 on a 402 × 874 screen)
/// with the step's copy and a static Bar, so captures line up with the Figma frames. The real tour shell
/// (header, host perch, entrances, Bar behaviour) is phase P2 and is not implemented here.
struct OnboardingDemoPreview: View {
    let sceneID: String
    let configuration: DemoStageConfiguration
    @State private var phase: DemoPlaybackPhase = .waiting

    var body: some View {
        switch sceneID {
        case DiscoverJoinScene.id:
            host(DiscoverJoinScene(), pill: "Find events", title: "FIND SOMETHING FUN",
                 body: "Company events, from lunchtime board games to weekend hikes. Tap Join once and you're on the list.",
                 cta: "See who's going")
        case PeopleInviteScene.id:
            host(PeopleInviteScene(features: Self.features), pill: "Who's going", title: "GO WITH PEOPLE YOU KNOW",
                 body: "See who's going before you decide. Invite a coworker and they can join in one tap.",
                 cta: "Show me challenges")
        case ChallengeScene.id:
            host(ChallengeScene(features: Self.features), pill: "Challenges", title: "TAKE ON A CHALLENGE",
                 body: "Each challenge shows what to do, how to send it in and when it ends. Once your organizer approves, the points are yours.",
                 cta: "Show me memories")
        case MemoriesScene.id:
            host(MemoriesScene(), pill: "Memories", title: "KEEP THE MEMORIES",
                 body: "Your events live in My Events. Past events keep a shared photo album for everyone who went.",
                 cta: "Pick my interests")
        default:
            ContentUnavailableView("Unknown demo \(sceneID)", systemImage: "questionmark")
        }
    }

    private func host<Scene: DemoScene>(_ scene: Scene, pill: String, title: String, body: String, cta: String) -> some View {
        GeometryReader { geometry in
            ZStack(alignment: .topLeading) {
                Color.white
                Text(pill)
                    .font(DIPReferenceAssets.font("Figtree-Regular", size: 20))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 16).frame(height: 44)
                    .background(OnboardingTheme.accent, in: Capsule())
                    .offset(x: 72, y: 70)
                    .accessibilityHidden(true)
                RoundedRectangle(cornerRadius: 20).fill(scene.stageFill)
                    .frame(width: geometry.size.width - 40, height: 429)
                    .offset(x: 20, y: 134)
                DemoStage(scene: scene, configuration: configuration) { phase = $0 }
                    .frame(width: geometry.size.width - 40, height: 429)
                    .offset(x: 20, y: 134)
                scene.hostFace.face(size: 40)
                    .offset(x: geometry.size.width - 80, y: 114)
                VStack(alignment: .leading, spacing: 10) {
                    Text(title)
                        .font(DIPReferenceAssets.font("FjallaOne-Regular", size: 34, relativeTo: .largeTitle))
                        .foregroundStyle(OnboardingTheme.ink)
                    Text(body)
                        .font(DIPReferenceAssets.font("Inter-Regular", size: 16))
                        .foregroundStyle(OnboardingTheme.ink)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(width: geometry.size.width - 40, alignment: .leading)
                .offset(x: 20, y: 585)
                Text(phaseText)
                    .font(.caption2.monospaced())
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("onboarding.demo.phase")
                    .accessibilityLabel(phaseText)
                    .offset(x: 20, y: 744)
                DIPFloatingNavigation(
                    action: DIPBottomBarAction(title: cta, identifier: "onboarding.next"), onSelect: { _ in })
                    .padding(.horizontal, 20)
                    .position(x: geometry.size.width / 2, y: geometry.size.height - 61)
            }
        }
        .ignoresSafeArea()
        .preferredColorScheme(.light)
    }

    private var phaseText: String {
        switch phase {
        case .waiting: "waiting"
        case .playing: "playing"
        case .scrubbing: "scrubbing"
        case .paused: "paused"
        case .still(let index): "still \(index)"
        case .resting: "resting"
        case .frozen: "frozen"
        }
    }

    /// Demo previews show every beat unless `-onboarding.features none` asks for the shipping set.
    static var features: OnboardingFeatures {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: "-onboarding.features"), arguments.indices.contains(index + 1),
              arguments[index + 1] == "none" else { return .all }
        return []
    }

    /// Debug overrides for the demo preview only (spec §5 UI tests):
    /// `-onboarding.timeScale <n>`, `-onboarding.reduceMotion`, `-onboarding.freezeAt <scene>@<seconds|final>`.
    static func configuration(sceneID: String, arguments: [String] = ProcessInfo.processInfo.arguments) -> DemoStageConfiguration {
        var configuration = DemoStageConfiguration.standard
        #if DEBUG
        func value(after flag: String) -> String? {
            guard let index = arguments.firstIndex(of: flag), arguments.indices.contains(index + 1) else { return nil }
            return arguments[index + 1]
        }
        if let scale = value(after: "-onboarding.timeScale").flatMap(Double.init), scale > 0 {
            configuration.timeScale = scale
        }
        if let flag = arguments.firstIndex(of: "-onboarding.reduceMotion") {
            let next = arguments.indices.contains(flag + 1) ? arguments[flag + 1].uppercased() : ""
            configuration.forceReduceMotion = !["NO", "0", "FALSE"].contains(next)
        }
        if let freeze = value(after: "-onboarding.freezeAt") {
            let parts = freeze.split(separator: "@", maxSplits: 1).map(String.init)
            if parts.count == 2, parts[0] == sceneID {
                if parts[1] == "final" {
                    configuration.freezeAt = .seconds(1_000)  // clamped to the scene's duration
                } else if let seconds = Double(parts[1]) {
                    configuration.freezeAt = .seconds(seconds)
                }
            }
        }
        #endif
        return configuration
    }
}
