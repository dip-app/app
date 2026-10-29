import DIPDesignSystem
import SwiftUI

/// Local, deterministic navigation and interaction state for the supplied prototype.
/// No identities, memberships, counts or messages are written to a backend.
struct DIPPrototypeApp: View {
    private enum Route: Hashable {
        case event(String)
        case participants(String)
        case album
    }
    @State private var selectedTab: DIPHomeTab
    @State private var routes: [Route]
    @State private var joinedEvents: Set<String>
    @State private var notice: String?
    @State private var showChat = false
    @State private var chatTitle = "Puppy Yoga"
    private let initialMemories: Bool

    init(initialScreen: String? = nil) {
        let argument = ProcessInfo.processInfo.arguments.first { $0.hasPrefix("--screen=") }
        let screen = initialScreen ?? argument.map { String($0.dropFirst("--screen=".count)) } ?? "home"
        _selectedTab = State(
            initialValue: screen == "profile" ? .profile : ["events", "memories"].contains(screen) ? .events : .home)
        initialMemories = screen == "memories"
        switch screen {
        case "event", "event-joined": _routes = State(initialValue: [.event("Puppy Yoga")])
        case "attendees": _routes = State(initialValue: [.participants("Puppy Yoga")])
        case "album": _routes = State(initialValue: [.album])
        default: _routes = State(initialValue: [])
        }
        _joinedEvents = State(initialValue: screen == "event-joined" ? ["puppy-yoga"] : [])
    }

    var body: some View {
        NavigationStack(path: $routes) {
            TabView(selection: $selectedTab) {
                DIPHomeScreen(onSelect: homeSelection)
                    .tag(DIPHomeTab.home)
                    .toolbar(.hidden, for: .tabBar)
                DIPMyEventsScreen(
                    initialMemories: initialMemories, onSelectTab: selectTab,
                    onEvent: { routes.append(.event($0)) }, onAlbum: { _ in routes.append(.album) },
                    onNotifications: { notice = "Notifications" }, onProfile: { selectTab(.profile) }
                )
                .tag(DIPHomeTab.events)
                .toolbar(.hidden, for: .tabBar)
                DIPProfileScreen(onSelectTab: selectTab, onMemory: { _ in routes.append(.album) })
                    .tag(DIPHomeTab.profile)
                    .toolbar(.hidden, for: .tabBar)
            }
            .toolbar(.hidden, for: .tabBar)
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: Route.self) { route in
                destination(route)
                    .navigationBarBackButtonHidden()
                    .toolbar(.hidden, for: .navigationBar)
            }
        }
        .preferredColorScheme(.light)
        .alert(
            "Prototype preview",
            isPresented: Binding(
                get: { notice != nil }, set: { if !$0 { notice = nil } })
        ) {
            Button("OK") { notice = nil }
        } message: {
            Text("\(notice ?? "") is not connected yet.")
        }
        .sheet(isPresented: $showChat) { DIPEventChatFixture(eventTitle: chatTitle) }
    }

    @ViewBuilder private func destination(_ route: Route) -> some View {
        switch route {
        case .event(let title):
            let fixture = DIPEventDetailFixture.named(title)
            DIPEventDetailsScreen(
                event: fixture, initiallyJoined: joinedEvents.contains(fixture.id),
                onBack: pop, onAttendees: { routes.append(.participants(title)) },
                onJoined: { joined in
                    if joined { joinedEvents.insert(fixture.id) } else { joinedEvents.remove(fixture.id) }
                })
        case .participants(let title):
            DIPParticipantsScreen(
                onBack: pop,
                onChat: {
                    chatTitle = title
                    showChat = true
                })
        case .album:
            DIPAlbumScreen(onBack: pop)
        }
    }

    private func selectTab(_ tab: DIPHomeTab) {
        guard tab != .rewards else {
            notice = "Rewards"
            return
        }
        selectedTab = tab
        routes = []
    }
    private func pop() { if !routes.isEmpty { routes.removeLast() } }
    private func homeSelection(_ selection: String) {
        switch selection {
        case "Profile": selectTab(.profile)
        case "My Events": selectTab(.events)
        case "Home": selectTab(.home)
        case "Recent attendees": routes.append(.participants("Puppy Yoga"))
        case "Puppy Yoga", "Kayaking", "Hike": routes.append(.event(selection))
        default: notice = selection
        }
    }
}
