import DIPCore
import DIPDesignSystem
import SwiftUI

/// B4 Memories (spec §3 B4): My Events by name, "Past events" spelled out, a past event's shared album and
/// adding a photo (the mock album until F5). The timeline is `MemoriesTimeline` (DIPCore).
struct MemoriesScene: DemoScene {
    static let id = "memories"

    var script: DemoScript<MemoriesState> { MemoriesTimeline.script }

    func applyContinuous(_ state: inout MemoriesState, at t: Duration) {
        MemoriesTimeline.continuous(&state, at: t)
    }

    let description = "Example: the My Events tab holds your upcoming and past events. A past event opens its photo album, where you can add your own photos."
    let hostFace = CrewMember.gray
    var stageFill: Color { OnboardingTheme.notification }
    let accessibilityRows = [
        DemoAccessibilityRow(systemImage: "square.grid.2x2", text: "My Events holds upcoming and past events"),
        DemoAccessibilityRow(systemImage: "clock.arrow.circlepath", text: "Past events keep their photo album"),
        DemoAccessibilityRow(systemImage: "photo.badge.plus", text: "Add your own photos"),
    ]

    func prepare() { DemoPeople.prepare(youName: OnboardingDemoFixtures.youPlaceholderName) }

    func canvas(_ state: MemoriesState) -> some View {
        MemoriesCanvas(state: state)
    }
}

struct MemoriesCanvas: View {
    let state: MemoriesState

    private struct Row: Identifiable {
        let id: String
        let title: String
        let detail: String
        let cover: String
    }

    private static let upcoming = [
        Row(id: "pasta", title: "Pasta Night", detail: "Thu · 6:30 PM", cover: "cover_cooking"),
        Row(id: "games", title: "Board Game Lunch", detail: "Fri · 12:00 PM", cover: "cover_games"),
    ]
    private static let past = [
        Row(id: "hike", title: "Saturday Hike", detail: "Oct 18", cover: "cover_hiking"),
        Row(id: "kayak", title: "Kayak Morning", detail: "Oct 4", cover: "cover_outdoors"),
    ]
    private static let album = (931...936).map { "album_Rectangle\($0)" }
    private static let newPhoto = "album_Rectangle937"

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.white
            switch state.page {
            case .myEvents: myEvents.transition(.opacity)
            case .pastEvent: pastPage.transition(.scale(scale: 0.5, anchor: UnitPoint(x: 0.5, y: 196 / 540)).combined(with: .opacity))
            case .album: albumGrid.transition(.opacity)
            }
            DemoMiniBar(selected: state.selectedTab == .events ? .events : .home, action: barAction)
            if state.callout == .myEvents || state.myEventsCallout > 0 {
                DemoCallout(text: "My Events", tail: .bottom, appearance: state.myEventsCallout)
                    .fixedSize()
                    .position(x: 195, y: 418)
            }
            if state.callout == .past || state.pastCallout > 0 {
                DemoCallout(text: "Past events", tail: .top, appearance: state.pastCallout)
                    .fixedSize()
                    .position(x: 287, y: 116)
            }
            if let upload = state.upload, !state.thumbSettled { uploadingThumb(upload) }
            if let ghost = state.ghost { GhostTouch(ghost: GhostState(ghost)) }
        }
        .frame(width: DemoCanvas.size.width, height: DemoCanvas.size.height, alignment: .topLeading)
        .clipped()
    }

    private var barAction: DIPBottomBarAction? {
        switch state.bar {
        case .entry: DIPBottomBarAction(title: "Add Your Entry", identifier: "onboarding.demo.entry")
        case .tabs: nil
        case .viewAlbum: DIPBottomBarAction(title: "View Album", identifier: "onboarding.demo.album")
        case .addPhotos: DIPBottomBarAction(title: "Add Photos", identifier: "onboarding.demo.addPhotos")
        }
    }

    // MARK: My Events

    private var myEvents: some View {
        ZStack(alignment: .topLeading) {
            Text("My Events")
                .font(DIPReferenceAssets.font("Figtree-Regular", size: 20))
                .foregroundStyle(.white)
                .padding(.horizontal, 16).frame(height: 40)
                .background(OnboardingTheme.accent, in: Capsule())
                .offset(x: 20, y: 18)
            sectionSwitch.offset(x: 20, y: 70)
            HStack(alignment: .top, spacing: 40) {
                list(Self.upcoming)
                list(Self.past)
            }
            .offset(x: 20 + (state.pastSection ? -390 : 0), y: 130)
        }
        .blur(radius: 6 * (1 - state.listDevelop))
        .opacity(state.listDevelop)
    }

    private var sectionSwitch: some View {
        ZStack(alignment: .leading) {
            Capsule().fill(OnboardingTheme.muted).frame(width: 350, height: 40)
            Capsule().fill(OnboardingTheme.ink)
                .frame(width: 171, height: 34)
                .offset(x: state.pastSection ? 176 : 3)
            HStack(spacing: 0) {
                Text("Upcoming").foregroundStyle(state.pastSection ? OnboardingTheme.ink : .white)
                    .frame(width: 175)
                Text("Past events").foregroundStyle(state.pastSection ? .white : OnboardingTheme.ink)
                    .frame(width: 175)
            }
            .font(DIPReferenceAssets.font("Inter-Medium", size: 14))
        }
        .frame(width: 350, height: 40)
    }

    private func list(_ rows: [Row]) -> some View {
        VStack(spacing: 12) {
            ForEach(rows) { row in
                HStack(spacing: 14) {
                    DIPReferenceAssets.image(row.cover).resizable().scaledToFill()
                        .frame(width: 96, height: 96)
                        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                    VStack(alignment: .leading, spacing: 4) {
                        Text(row.title).font(DIPReferenceAssets.font("Figtree-Bold", size: 18))
                        Text(row.detail).font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                    }
                    .foregroundStyle(.black)
                    Spacer(minLength: 0)
                }
                .padding(12)
                .frame(width: 350, height: 120)
                .background(OnboardingTheme.muted.opacity(0.55), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            }
        }
        .frame(width: 350)
    }

    // MARK: Past event page

    private var pastPage: some View {
        VStack(alignment: .leading, spacing: 0) {
            DIPDetailHero(image: .asset("cover_hiking"), tags: [], identifierPrefix: "onboarding.demo.past")
                .frame(width: 350, height: 264)
                .frame(height: 200, alignment: .top)
                .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            Text("SATURDAY HIKE")
                .font(DIPReferenceAssets.font("FjallaOne-Regular", size: 40))
                .foregroundStyle(.black)
                .frame(height: 50, alignment: .leading)
                .padding(.top, 10)
            DIPDetailPeopleRow(
                title: "Who Attended", avatars: [CrewMember.white, .gray, .purple].map { CrewAvatarImages.reference($0) },
                total: 6, emptyText: "", identifierPrefix: "onboarding.demo.past", onMore: {})
                .padding(.top, 14)
        }
        .frame(width: 350, alignment: .leading)
        .offset(x: 20, y: 20)
    }

    // MARK: Album

    private var albumGrid: some View {
        let photos = state.thumbSettled ? [Self.newPhoto] + Self.album : Self.album
        let columns = Array(repeating: GridItem(.fixed(110), spacing: 10), count: 3)
        return VStack(alignment: .leading, spacing: 14) {
            Text("SATURDAY HIKE")
                .font(DIPReferenceAssets.font("FjallaOne-Regular", size: 28))
                .foregroundStyle(.black)
            LazyVGrid(columns: columns, alignment: .leading, spacing: 10) {
                ForEach(Array(photos.enumerated()), id: \.element) { index, photo in
                    let develop = photo == Self.newPhoto ? 1 : state.albumDevelop[min(index, state.albumDevelop.count - 1)]
                    DIPReferenceAssets.image(photo).resizable().scaledToFill()
                        .frame(width: 110, height: 110)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .blur(radius: 6 * (1 - min(1, develop)))
                        .scaleEffect(0.96 + 0.04 * min(1, develop))
                        .opacity(min(1, develop))
                }
            }
        }
        .frame(width: 350, alignment: .leading)
        .offset(x: 20, y: 24)
    }

    private func uploadingThumb(_ progress: Double) -> some View {
        let size = 20 + 60 * progress
        return ZStack {
            DIPReferenceAssets.image(Self.newPhoto).resizable().scaledToFill()
                .frame(width: size, height: size)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            Circle().trim(from: 0, to: progress)
                .stroke(.white, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .frame(width: 28, height: 28)
        }
        .position(x: 195, y: 479 - 70 * progress)
    }
}
