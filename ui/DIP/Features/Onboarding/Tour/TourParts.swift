import DIPCore
import DIPDesignSystem
import SwiftUI

// Building blocks of `OnboardingTourView`: geometry, entrances, the header and its Crew stack, B0's crew
// and B5's strip.

/// Tour geometry on the reference iPhone 17 Pro (402 × 874 pt), measured from the screen's top-left with the
/// safe area ignored (spec §3.0). Heights scale with the screen.
struct TourLayout: Equatable {
    let size: CGSize

    static let side: CGFloat = 20
    static let headerTop: CGFloat = 70
    static let headerHeight: CGFloat = 44
    static let stageTop: CGFloat = 134
    static let perchSize: CGFloat = 40
    /// A0/A1/A2's Stage (the welcome card) that B0 and the resume entrance morph from.
    static let welcomeStage = CGRect(x: 20, y: 60, width: 362, height: 225)
    static let stripHeight: CGFloat = 196

    var width: CGFloat { size.width }
    var titleTop: CGFloat { size.height - 289 }
    var stage: CGRect {
        CGRect(x: Self.side, y: Self.stageTop, width: width - 2 * Self.side,
               height: max(200, titleTop - 22 - Self.stageTop))
    }
    /// B5's Stage strip (y 134–330).
    var strip: CGRect { CGRect(x: Self.side, y: Self.stageTop, width: width - 2 * Self.side, height: Self.stripHeight) }
    var welcome: CGRect { CGRect(x: Self.side, y: 60, width: width - 2 * Self.side, height: 225) }
    /// Perch: 40 pt at x 322–362 on 402, centred on the Stage top edge.
    var perch: CGPoint { CGPoint(x: width - 60, y: Self.stageTop) }
    var barCenterY: CGFloat { size.height - DIPFloatingNavigation.barCenterInset }
    /// B5's secondary text action (y 717–761 on 874).
    var secondaryCenterY: CGFloat { size.height - 135 }
    var full: CGRect { CGRect(origin: .zero, size: size) }
}

/// Each step's own title entrance (spec §3.0 "Entrance characters").
enum TourEntranceStyle: Equatable {
    case wordByWord, wipe, gather, stamp, develop, ride, fade

    init(_ step: OnboardingStep) {
        switch step {
        case .arrival: self = .wordByWord
        case .discover: self = .wipe
        case .people: self = .gather
        case .challenges: self = .stamp
        case .memories: self = .develop
        case .interests: self = .ride
        }
    }
}

/// A title that plays its entrance once when it appears. Reduce Motion uses a plain fade.
struct TourTitle: View {
    let text: String
    let style: TourEntranceStyle
    /// Seconds after appearing that the entrance starts (0.32 on a step change, 0.40 on B0).
    let delay: Double
    let speed: Double
    let reduceMotion: Bool
    @State private var shown = false

    var body: some View {
        let words = text.uppercased().split(separator: " ").map(String.init)
        Group {
            if !reduceMotion, style == .wordByWord || style == .gather {
                WordFlow(spacing: 9, lineSpacing: 0) {
                    ForEach(Array(words.enumerated()), id: \.offset) { index, word in
                        styledWord(word, index: index)
                    }
                }
            } else {
                titleText(text.uppercased()).modifier(TourReveal(style: reduceMotion ? .fade : style, shown: shown))
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(text))
        .accessibilityAddTraits(.isHeader)
        .accessibilityIdentifier("onboarding.tour.title")
        .onAppear {
            withAnimation(animation.delay(delay / speed)) { shown = true }
        }
    }

    private func titleText(_ value: String) -> some View {
        Text(value)
            .font(DIPReferenceAssets.font("FjallaOne-Regular", size: 34, relativeTo: .largeTitle))
            .foregroundStyle(OnboardingTheme.ink)
            .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder private func styledWord(_ word: String, index: Int) -> some View {
        let wordDelay = (delay + Double(index) * (style == .wordByWord ? 0.07 : 0.05)) / speed
        titleText(word)
            .scaleEffect(style == .wordByWord && !shown ? 0.7 : 1)
            .offset(x: style == .gather && !shown ? (index.isMultiple(of: 2) ? -18 : 18) : 0)
            .opacity(shown ? 1 : 0)
            .animation(OnboardingMotion.hop.speed(speed).delay(wordDelay), value: shown)
    }

    private var animation: Animation {
        if reduceMotion { return .easeInOut(duration: 0.3 / speed) }
        switch style {
        case .wipe: return .easeOut(duration: 0.45 / speed)
        case .stamp: return Animation.spring(response: 0.3, dampingFraction: 0.7).speed(speed)
        case .develop: return .easeOut(duration: 0.5 / speed)
        case .ride: return OnboardingMotion.stage.speed(speed)
        case .wordByWord, .gather, .fade: return .easeOut(duration: 0.25 / speed)
        }
    }
}

/// The non-word entrances as one modifier driven by `shown`.
struct TourReveal: ViewModifier {
    let style: TourEntranceStyle
    let shown: Bool

    func body(content: Content) -> some View {
        switch style {
        case .wipe:
            content.mask(alignment: .leading) {
                GeometryReader { geometry in
                    LinearGradient(stops: [.init(color: .black, location: 0.85), .init(color: .clear, location: 1)],
                                   startPoint: .leading, endPoint: .trailing)
                        .frame(width: shown ? geometry.size.width + 24 : 0)
                }
            }
        case .stamp:
            content.scaleEffect(shown ? 1 : 1.12).opacity(shown ? 1 : 0)
        case .develop:
            content.blur(radius: shown ? 0 : 8).opacity(shown ? 1 : 0)
        case .ride:
            content.offset(y: shown ? 0 : 40).opacity(shown ? 1 : 0)
        case .wordByWord, .gather, .fade:
            content.opacity(shown ? 1 : 0)
        }
    }
}

/// The step body: follows its title with the same character, a little later (spec §3.0 Body column).
struct TourBody: View {
    let text: String
    let style: TourEntranceStyle
    let delay: Double
    let speed: Double
    let reduceMotion: Bool
    @State private var shown = false

    var body: some View {
        Text(text)
            .font(DIPReferenceAssets.font("Inter-Regular", size: 16, relativeTo: .body))
            .foregroundStyle(OnboardingTheme.ink)
            .fixedSize(horizontal: false, vertical: true)
            .modifier(TourReveal(style: reduceMotion ? .fade : bodyStyle, shown: shown))
            .accessibilityIdentifier("onboarding.tour.body")
            .onAppear {
                let animation: Animation = reduceMotion ? .easeInOut(duration: 0.3 / speed) : .easeOut(duration: 0.3 / speed)
                withAnimation(animation.delay(delay / speed)) { shown = true }
            }
    }

    private var bodyStyle: TourEntranceStyle {
        switch style {
        case .wipe, .develop, .ride: style
        default: .fade
        }
    }
}

/// A minimal flow layout for word-by-word titles.
struct WordFlow: Layout {
    var spacing: CGFloat
    var lineSpacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = rows(width: proposal.width ?? .infinity, subviews: subviews)
        let height = rows.reduce(0) { $0 + $1.height } + lineSpacing * CGFloat(max(0, rows.count - 1))
        let width = rows.map(\.width).max() ?? 0
        return CGSize(width: proposal.width ?? width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in rows(width: bounds.width, subviews: subviews) {
            var x = bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + lineSpacing
        }
    }

    private struct Row { var indices: [Int] = []; var width: CGFloat = 0; var height: CGFloat = 0 }

    private func rows(width: CGFloat, subviews: Subviews) -> [Row] {
        var rows: [Row] = [Row()]
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            let extra = rows[rows.count - 1].indices.isEmpty ? size.width : size.width + spacing
            if rows[rows.count - 1].width + extra > width, !rows[rows.count - 1].indices.isEmpty {
                rows.append(Row())
            }
            let current = rows.count - 1
            rows[current].width += rows[current].indices.isEmpty ? size.width : size.width + spacing
            rows[current].height = max(rows[current].height, size.height)
            rows[current].indices.append(index)
        }
        return rows
    }
}

/// "You": initials in a `DIPAvatar` with a 3 pt white ring (spec §7.1), optionally with the B5 saved dot.
struct TourYouAvatar: View {
    let name: String
    let size: CGFloat
    var showsSavedDot = false

    var body: some View {
        DIPAvatar(person: DIPAvatarIdentity(id: "onboarding.you", name: name), size: size, isDecorative: true)
            .overlay(Circle().strokeBorder(.white, lineWidth: size >= 56 ? 3 : 2))
            .overlay(alignment: .topTrailing) {
                if showsSavedDot {
                    Circle().fill(OnboardingTheme.accent)
                        .overlay(Circle().strokeBorder(.white, lineWidth: 1.5))
                        .frame(width: 8, height: 8)
                        .transition(.scale.combined(with: .opacity))
                }
            }
            .accessibilityHidden(true)
    }
}

/// The header's Crew stack: three faces then a "+n" disc (spec §4.2). One VoiceOver element with the pill.
struct TourCrewStack: View {
    let members: [OnboardingStackMember]
    let youName: String
    let youSaved: Bool
    let namespace: Namespace.ID
    /// Hides You during the handoff while its own flight copy is drawn.
    var hidesYou = false
    /// This step's host (owner revision Nov 10: the device frame owns the Stage's top edge, so the host sits
    /// in the header after the stack, ringed in `actionPrimary`, and joins the stack when the step ends).
    var host: CrewMember?

    var body: some View {
        HStack(spacing: 6) {
            stack
            if let host {
                host.face(size: 28)
                    .overlay(Circle().strokeBorder(OnboardingTheme.accent, lineWidth: 2))
                    .matchedGeometryEffect(id: "crew.\(host)", in: namespace)
                    .id("host.\(host)")
                    .transition(.asymmetric(insertion: .scale(scale: 0.6).combined(with: .opacity), removal: .opacity))
            }
        }
        .accessibilityHidden(true)
    }

    private var stack: some View {
        let layout = OnboardingCrewStack(count: members.count)
        return ZStack(alignment: .leading) {
            ForEach(Array(members.prefix(layout.faces).enumerated()), id: \.element) { index, member in
                face(member)
                    .opacity(member == .you && hidesYou ? 0 : 1)
                    .offset(x: OnboardingCrewStack.offset(of: index))
                    .zIndex(Double(-index))
            }
            if layout.overflow > 0 {
                Text("+\(layout.overflow)")
                    .font(DIPReferenceAssets.font("Inter-Medium", size: 12))
                    .foregroundStyle(OnboardingTheme.ink)
                    .contentTransition(.numericText(value: Double(layout.overflow)))
                    .frame(width: 28, height: 28)
                    .background(OnboardingTheme.muted, in: Circle())
                    .overlay(Circle().strokeBorder(.white, lineWidth: 2))
                    .offset(x: OnboardingCrewStack.offset(of: layout.faces))
            }
        }
        .frame(width: layout.width, height: 28, alignment: .leading)
        .accessibilityHidden(true)
    }

    @ViewBuilder private func face(_ member: OnboardingStackMember) -> some View {
        switch member {
        case .you:
            TourYouAvatar(name: youName, size: 28, showsSavedDot: youSaved)
                .matchedGeometryEffect(id: "crew.you", in: namespace)
        case .host(let crew):
            crew.face(size: 28)
                .overlay(Circle().strokeBorder(.white, lineWidth: 2))
                .matchedGeometryEffect(id: "crew.\(crew)", in: namespace)
        }
    }
}

/// B0's Stage: the four faces cheer with You grown out of the yellow in front (spec §3 B0).
struct ArrivalCrew: View {
    let youName: String
    let namespace: Namespace.ID
    let speed: Double
    let reduceMotion: Bool
    @State private var cheered = false
    @State private var youShown = false
    @State private var winking = false

    /// Figma B0: P and W on the left, Y and G on the right (112 pt either side, 56 pt above and below the
    /// centre), You in the middle. The cheer drops each face 12 pt with `hop`, 70 ms apart.
    var body: some View {
        let seats: [(CrewMember, CGSize)] = [
            (.purple, CGSize(width: -112, height: -56)), (.white, CGSize(width: -112, height: 56)),
            (.yellow, CGSize(width: 112, height: -56)), (.gray, CGSize(width: 112, height: 56)),
        ]
        ZStack {
            ForEach(Array(seats.enumerated()), id: \.offset) { index, seat in
                let member = seat.0
                Group {
                    if member == .purple {
                        member.face(size: 88, mood: .happy).matchedGeometryEffect(id: "crew.purple", in: namespace)
                    } else {
                        OnboardingFace(fill: member.fill.color, figure: member.figure,
                                       rig: member == .yellow ? (winking ? .wink : .happy) : (member == .gray ? .calm : .happy),
                                       size: 88)
                    }
                }
                .offset(x: seat.1.width, y: seat.1.height + (cheered ? 0 : -12))
                .animation(reduceMotion ? nil : OnboardingMotion.hop.speed(speed).delay((0.10 + 0.07 * Double(index)) / speed),
                           value: cheered)
            }
            ZStack {
                Circle().fill(OnboardingTheme.notification).frame(width: 88, height: 88)
                    .scaleEffect(youShown ? 1 : 0.4)
                TourYouAvatar(name: youName, size: 88).opacity(youShown ? 1 : 0)
            }
            .matchedGeometryEffect(id: "crew.you", in: namespace)
            .animation(reduceMotion ? nil : OnboardingMotion.hop.speed(speed).delay(0.25 / speed), value: youShown)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("You and four coworkers, celebrating."))
        .accessibilityIdentifier("onboarding.arrival.crew")
        .onAppear {
            cheered = true
            youShown = true
            guard !reduceMotion else { return }
            Task { @MainActor in
                try? await Task.sleep(for: .seconds(0.60 / speed))
                withAnimation(.easeInOut(duration: OnboardingMotion.winkClose / speed)) { winking = true }
                try? await Task.sleep(for: .seconds((OnboardingMotion.winkClose + OnboardingMotion.winkHold) / speed))
                withAnimation(.easeInOut(duration: OnboardingMotion.winkOpen / speed)) { winking = false }
            }
        }
    }
}

/// B5's Stage strip without F1's cards: "All events" plus the chosen interests (spec §3 B5 "live reshape").
struct InterestsStrip: View {
    let names: [String]
    let failed: Bool
    let reduceMotion: Bool

    var body: some View {
        ZStack(alignment: .topLeading) {
            if failed {
                VStack(spacing: 10) {
                    CrewMember.gray.face(size: 64, mood: .calm)
                    Text(OnboardingInterestsModel.catalogFailedMessage)
                        .font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .body))
                        .multilineTextAlignment(.center)
                        .foregroundStyle(OnboardingTheme.ink)
                        .padding(.horizontal, 24)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                WordFlow(spacing: 8, lineSpacing: 8) {
                    chip("All events", selected: false)
                    ForEach(names, id: \.self) { chip($0, selected: true) }
                }
                .padding(16)
                .animation(reduceMotion ? .easeInOut(duration: 0.12) : OnboardingMotion.hop, value: names)
            }
        }
        .accessibilityHidden(true)
    }

    private func chip(_ title: String, selected: Bool) -> some View {
        Text(title)
            .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
            .foregroundStyle(selected ? .white : OnboardingTheme.ink)
            .padding(.horizontal, 12).frame(height: 32)
            .background(selected ? OnboardingTheme.accent : .white, in: Capsule())
            .transition(reduceMotion ? .opacity : .scale(scale: 0.6).combined(with: .opacity))
    }
}
