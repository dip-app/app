import DIPCore
import DIPDesignSystem
import SwiftUI

/// Local presentation of the original upcoming-events and memories reference frames.
/// Callbacks cross the feature boundary; these fixtures do not read or mutate Firebase.
struct DIPMyEventsScreen: View {
    private enum Section: String {
        case active
        case memories
    }

    @State private var section: Section
    /// The page the paging scroll view rests on; nil until first appear, then set without animation.
    @State private var pageID: Section?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let activeEvents: [DIPEventSummary]
    let memoryAlbums: [DIPMemory]
    let unreadCount: Int
    let profileAvatar: MediaReference
    private let showsBottomBar: Bool
    let onSelectTab: (DIPHomeTab) -> Void
    let onEvent: (String) -> Void
    let onAlbum: (String) -> Void
    let onNotifications: () -> Void
    let onProfile: () -> Void

    init(
        activeEvents: [DIPEventSummary],
        memories: [DIPMemory],
        unreadCount: Int,
        profileAvatar: MediaReference,
        initialMemories: Bool = false,
        showsBottomBar: Bool = true,
        onSelectTab: @escaping (DIPHomeTab) -> Void,
        onEvent: @escaping (String) -> Void,
        onAlbum: @escaping (String) -> Void,
        onNotifications: @escaping () -> Void,
        onProfile: @escaping () -> Void
    ) {
        self.activeEvents = activeEvents
        self.memoryAlbums = memories
        self.unreadCount = unreadCount
        self.profileAvatar = profileAvatar
        _section = State(initialValue: initialMemories ? .memories : .active)
        self.showsBottomBar = showsBottomBar
        self.onSelectTab = onSelectTab
        self.onEvent = onEvent
        self.onAlbum = onAlbum
        self.onNotifications = onNotifications
        self.onProfile = onProfile
    }

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .top) {
                DIPTokens.Color.surfaceDefault.swiftUIColor
                VStack(spacing: 0) {
                    DIPHomeHeader(
                        title: "My Events", unreadCount: unreadCount,
                        profileAvatar: { DIPMedia(profileAvatar) },
                        onNotifications: onNotifications, onProfile: onProfile
                    )
                    .padding(.horizontal, 20).padding(.top, 60).padding(.bottom, 10)
                    // The toggle is pinned above the pages. Each page is a full-width vertical scroll view that carries
                    // its own 20pt page padding, so while swiping the content travels to the display edge and the
                    // padding is the gap between the two pages (nothing is clipped at the padding).
                    sectionPicker.padding(.horizontal, 20).padding(.bottom, 18)
                    pager(width: geometry.size.width)
                }
                if showsBottomBar {
                    DIPFloatingNavigation(selected: .events, onSelect: onSelectTab)
                        .padding(.horizontal, 20)
                        .position(x: geometry.size.width / 2, y: geometry.size.height - 61)
                }
            }
            .clipped()
        }
        .ignoresSafeArea()
        .preferredColorScheme(.light)
        .accessibilityElement(children: .contain)
    }

    /// Two real pages side by side in a paging scroll view. The toggle and the pages stay in sync both ways:
    /// tapping the toggle animates to the page, and swiping the content moves the toggle's thumb.
    private func pager(width: CGFloat) -> some View {
        ScrollView(.horizontal) {
            HStack(spacing: 0) {
                page(.active, width: width) { activeEvents(width: width - 40) }
                page(.memories, width: width) { memories }
            }
            .scrollTargetLayout()
        }
        .scrollTargetBehavior(.paging)
        .scrollPosition(id: $pageID)
        .onAppear { var t = Transaction(animation: nil); t.disablesAnimations = true; withTransaction(t) { pageID = section } }
        .onChange(of: pageID) { _, next in
            // A swipe moved the page: the toggle follows and VoiceOver hears the new page. (A toggle tap already
            // speaks the selected segment, so it does not announce twice.)
            guard let next, next != section else { return }
            section = next
            AccessibilityNotification.Announcement(next == .active ? "Active Events" : "Memories").post()
        }
        .scrollIndicators(.hidden)
        .accessibilityIdentifier("events.content")
    }

    private func page<Content: View>(_ id: Section, width: CGFloat, @ViewBuilder _ content: () -> Content) -> some View {
        ScrollView(.vertical) {
            VStack(spacing: 18) { content() }
                .frame(maxWidth: .infinity, alignment: .topLeading)
                .padding(.horizontal, 20).padding(.bottom, 120)
        }
        .scrollIndicators(.hidden)
        .frame(width: width)
        // The page that is off screen is not an accessibility target (VoiceOver would scroll the pager under
        // the user); the toggle, with its selected trait, is how VoiceOver switches pages.
        .accessibilityHidden(section != id)
        .id(id)
        .accessibilityIdentifier("events.page.\(id.rawValue)")
    }

    private var sectionPicker: some View {
        DIPSegmentedToggle(
            segments: [
                .init(id: Section.active, title: "Active Events", identifier: "events.segment.active"),
                .init(id: Section.memories, title: "Memories", identifier: "events.segment.memories"),
            ],
            selection: section, accent: segmentAccent, onSelect: selectSection)
    }

    private var sectionAnimation: Animation {
        // Original prototype: PUSH, SLOW, 0.625061452 seconds in either direction.
        DIPMotion.section(reduceMotion: reduceMotion)
    }

    private func selectSection(_ next: Section) {
        guard next != section else { return }
        withAnimation(sectionAnimation) { section = next; pageID = next }
    }

    private var segmentAccent: Color {
        DIPTokens.Color.eventsAccent.swiftUIColor
    }

    private func activeEvents(width: CGFloat) -> some View {
        VStack(spacing: 18) {
            if activeEvents.isEmpty {
                DIPEmptyState(
                    screen: "my-events-active", title: "No upcoming events",
                    message: "Events you join will show up here.",
                    actionTitle: "Find an event", action: { onSelectTab(.home) })
            }
            ForEach(activeEvents) { event in
                Button {
                    onEvent(event.id)
                } label: {
                    VStack(alignment: .leading, spacing: 6) {
                        // Wraps onto up to three lines inside the card padding; shrinks only as a last resort.
                        Text(event.title.uppercased())
                            .font(DIPReferenceAssets.font("FjallaOne-Regular", size: 40, relativeTo: .largeTitle))
                            .lineLimit(3).minimumScaleFactor(0.6).multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Text(event.locality)
                            .font(DIPReferenceAssets.font("Inter-LightItalic", size: 11))
                            .lineLimit(2).multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .foregroundStyle(.white)
                    .padding(15)
                    .frame(width: width, height: 246, alignment: .bottomLeading)
                    .background {
                        DIPMedia(event.image)
                            .resizable().scaledToFill().frame(width: width, height: 246)
                            .overlay(.black.opacity(event.imageShade))
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 20))
                    .contentShape(RoundedRectangle(cornerRadius: 20))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(event.title), \(event.locality)")
                .accessibilityIdentifier("events.card.\(event.id)")
            }
        }
    }

    @ViewBuilder private var memories: some View {
        if memoryAlbums.isEmpty {
            DIPEmptyState(
                screen: "my-events-memories", title: "No memories yet",
                message: "Events you’ve attended will show up here.")
        }
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 18), GridItem(.flexible(), spacing: 18)], spacing: 18) {
            ForEach(Array(memoryAlbums.enumerated()), id: \.offset) { index, memory in
                GeometryReader { geometry in
                    Button {
                        onAlbum(memory.id)
                    } label: {
                        VStack(alignment: .leading, spacing: 0) {
                            HStack(spacing: -4) {
                                ForEach(Array(memory.avatars.enumerated()), id: \.offset) { _, avatar in
                                    DIPMedia(avatar)
                                        .resizable().frame(width: 22, height: 22)
                                }
                                Text("View Album")
                                    .font(DIPReferenceAssets.font("Inter-Light", size: 10))
                                    .foregroundStyle(.black).frame(height: 22).padding(.horizontal, 10)
                                    .background(.white, in: Capsule())
                            }
                            .fixedSize().accessibilityHidden(true)
                            Spacer(minLength: 0)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(memory.title.uppercased())
                                    .font(DIPReferenceAssets.font("FjallaOne-Regular", size: 20, relativeTo: .title3))
                                    .lineLimit(3).minimumScaleFactor(0.75).multilineTextAlignment(.leading)
                                    .fixedSize(horizontal: false, vertical: true)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                Text(memory.locality)
                                    .font(DIPReferenceAssets.font("Inter-LightItalic", size: 11))
                                    .lineLimit(2).multilineTextAlignment(.leading)
                                    .fixedSize(horizontal: false, vertical: true)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .foregroundStyle(.white).padding(10)
                        }
                        .padding(5)
                        .frame(width: geometry.size.width, height: 205, alignment: .leading)
                        .background {
                            Group {
                                if memory.id == "boat-ride" {
                                    // Original Boat Ride instance uses this explicit image-fill transform.
                                    DIPMedia(memory.image).resizable()
                                        .frame(width: geometry.size.width * 1.6798, height: 205)
                                        .frame(width: geometry.size.width, height: 205).clipped()
                                } else {
                                    DIPMedia(memory.image)
                                        .resizable().scaledToFill()
                                        .frame(width: geometry.size.width, height: 205)
                                }
                            }
                            .overlay(.black.opacity(memory.imageShade))
                        }
                        .clipShape(RoundedRectangle(cornerRadius: 20))
                        .contentShape(RoundedRectangle(cornerRadius: 20))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("View album, \(memory.title), \(memory.locality)")
                    .accessibilityIdentifier("events.album.\(index)")
                }
                .frame(height: 205)
            }
        }
    }

}
