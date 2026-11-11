import DIPCore
import DIPMockData
import DIPDesignSystem
import SwiftUI

// Pieces shared by the B2–B4 canvases. Everything takes fixture values and no-op closures.

extension GhostState {
    /// The app-side ghost for a pure DIPCore ghost (B2–B4 timelines).
    init(_ ghost: DemoGhostState) {
        self.init(position: DemoPoint(ghost.position.x, ghost.position.y), scale: ghost.scale, opacity: ghost.opacity)
    }
}

extension OnboardingDemoFixtures {
    /// A snapshot holding the demo Pasta Night, so demo bars come from `EventBarAction.resolve` exactly as the
    /// app shell resolves them for the event and participants routes.
    static func pastaSnapshot(joined: Bool) -> DIPAppSnapshot {
        var snapshot = DIPMockFixtures.reference
        snapshot.eventDetails[pastaNight.id] = pastaDetail(joined: joined, avatars: [])
        return snapshot
    }
}

extension DemoCoordinate {
    var cgPoint: CGPoint { CGPoint(x: x, y: y) }
}

/// A real app screen laid out on a full 390 × 844 phone, of which the canvas shows the lower 540 pt (the device
/// frame's top runs off the Stage). Real screens keep their own top padding and headers; those sit above the
/// visible part, exactly as on a phone whose top is out of view.
struct DemoPhoneScreen<Content: View>: View {
    static var height: CGFloat { 844 }
    @ViewBuilder let content: () -> Content

    var body: some View {
        content()
            .frame(width: DemoCanvas.size.width, height: Self.height)
            .offset(y: DemoCanvas.size.height - Self.height)
            .frame(width: DemoCanvas.size.width, height: DemoCanvas.size.height, alignment: .topLeading)
            .environment(\.dynamicTypeSize, .large)
    }
}

/// The demo's mini bar: the real `DIPFloatingNavigation`, with every tab the app shows (owner revision Nov 10), centred at
/// canvas y 479.
struct DemoMiniBar: View {
    var selected: DIPHomeTab = .home
    var action: DIPBottomBarAction?

    var body: some View {
        DIPFloatingNavigation(selected: selected, action: action, onSelect: { _ in })
            .padding(.horizontal, 20)
            .frame(width: DemoCanvas.size.width)
            .position(x: DemoCanvas.size.width / 2, y: DemoCanvas.barCenterY)
    }
}

/// Fictional coworkers for B2's lists (spec open decision 4: names pending approval).
enum DemoPeople {
    @MainActor static func attendees(youName: String) -> [DIPParticipant] {
        [
            DIPParticipant(id: "maya", name: "Maya", department: "Design", avatar: CrewAvatarImages.reference(.purple, size: 50)),
            DIPParticipant(id: "theo", name: "Theo", department: "Engineering", avatar: CrewAvatarImages.reference(.white, size: 50)),
            DIPParticipant(id: "jun", name: "Jun", department: "Finance", avatar: CrewAvatarImages.reference(.yellow, size: 50)),
            DIPParticipant(id: "lena", name: "Lena", department: "Sales", avatar: CrewAvatarImages.reference(.gray, size: 50)),
            DIPParticipant(id: "omar", name: "Omar", department: "Product", avatar: CrewAvatarImages.reference(.purple, size: 50)),
            DIPParticipant(id: "you", name: "You", department: "Going", avatar: CrewAvatarImages.you(name: youName, size: 50)),
        ]
    }

    @MainActor static var coworkers: [DIPParticipant] {
        [
            DIPParticipant(id: "priya", name: "Priya", department: "Design", avatar: CrewAvatarImages.reference(.gray, size: 50)),
            DIPParticipant(id: "alex", name: "Alex", department: "Sales", avatar: CrewAvatarImages.reference(.purple, size: 50)),
            DIPParticipant(id: "noor", name: "Noor", department: "Marketing", avatar: CrewAvatarImages.reference(.yellow, size: 50)),
        ]
    }

    @MainActor static func prepare(youName: String) {
        for member in CrewMember.allCases {
            _ = CrewAvatarImages.reference(member)
            _ = CrewAvatarImages.reference(member, size: 50)
            _ = CrewAvatarImages.reference(member, size: 22)
        }
        _ = CrewAvatarImages.you(name: youName)
        _ = CrewAvatarImages.you(name: youName, size: 50)
    }
}

/// A rows list as the participants screen draws it: `VStack(spacing: 4)` with a divider between rows.
struct DemoParticipantList: View {
    let people: [DIPParticipant]
    var trailing: (DIPParticipant) -> AnyView = { _ in AnyView(EmptyView()) }

    var body: some View {
        VStack(spacing: 4) {
            ForEach(Array(people.enumerated()), id: \.element.id) { index, person in
                HStack(spacing: 0) {
                    DIPParticipantRow(person: person)
                    trailing(person)
                }
                if index < people.count - 1 {
                    DIPReferenceAssets.image("attendees_Line2").resizable()
                        .frame(height: 1).rotationEffect(.degrees(180))
                }
            }
        }
    }
}

/// A short white capsule for demo toasts and status labels.
struct DemoToast: View {
    let text: String
    var body: some View {
        Text(text)
            .font(DIPReferenceAssets.font("Inter-Medium", size: 14))
            .foregroundStyle(.white)
            .padding(.horizontal, 16).frame(height: 36)
            .background(OnboardingTheme.ink, in: Capsule())
    }
}

/// A placeholder marker for UI that hasn't shipped (spec §1 principle 3): the demo draws its own stand-in.
struct DemoPlaceholderTag: View {
    let feature: String
    var body: some View {
        Text("PREVIEW · \(feature)")
            .font(DIPReferenceAssets.font("Inter-Medium", size: 10))
            .tracking(0.6)
            .foregroundStyle(OnboardingTheme.ink.opacity(0.6))
    }
}

extension View {
    /// Places a view's centre at a canvas point inside a top-leading `ZStack`.
    func demoPosition(_ point: CGPoint) -> some View { position(point) }

    /// Wipes in left to right with `progress` (0 → 1).
    func demoWipe(_ progress: Double) -> some View {
        mask(alignment: .leading) {
            GeometryReader { geometry in
                Rectangle().frame(width: geometry.size.width * min(1, max(0, progress)))
            }
        }
    }
}
