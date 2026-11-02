import DIPDesignSystem
import SwiftUI

/// Development fixture gallery; it does not load accounts/events or call Firebase.
/// The integrator can present it in a debug-only destination or Xcode preview.
struct DIPFoundationGallery: View {
    @State private var destination: DIPDestination = .home
    @State private var callbackCount = 0
    @State private var isLoading = false
    @State private var message = "Explore a component to exercise its callback."
    private let eventImage: Image?
    private let avatarImage: Image?
    private let person = DIPAvatarIdentity(id: "fixture-alex", name: "Alex Morgan")
    private let people = [
        DIPAvatarIdentity(id: "fixture-alex", name: "Alex Morgan"),
        DIPAvatarIdentity(id: "fixture-taylor", name: "Taylor Lee"),
        DIPAvatarIdentity(id: "fixture-sam", name: "Sam Rivera"),
    ]

    init(eventImage: Image? = nil, avatarImage: Image? = nil) {
        self.eventImage = eventImage
        self.avatarImage = avatarImage
    }
    var body: some View {
        DIPTabBar(selection: $destination) { destination in
            switch destination {
            case .home: gallery
            case .myEvents:
                DIPStateView(
                    .empty(
                        title: "No joined events",
                        message:
                            "This is a presentation fixture. Your events will appear here after the participation workstream is integrated."
                    )
                )
                .accessibilityIdentifier("foundation.my-events")
            case .profile:
                DIPStateView(
                    .empty(
                        title: "Profile preview",
                        message: "Account and profile workflows are owned by the accounts workstream.")
                )
                .accessibilityIdentifier("foundation.profile")
            }
        }
        .preferredColorScheme(.light)
    }
    private var gallery: some View {
        GeometryReader { geometry in
            ScrollView {
                VStack(alignment: .leading, spacing: DIPTokens.Spacing.sectionGap) {
                    DIPHeader(
                        title: "Components", person: person, avatar: avatarImage,
                        onProfile: { record("Profile callback") })
                    Text("UI foundations").font(.largeTitle.bold()).accessibilityAddTraits(.isHeader)
                    Text(
                        "Fixture-driven components for V1. Data, navigation destinations and approved assets are supplied by feature owners."
                    ).font(.body).foregroundStyle(.secondary)
                    Text(message).font(.callout).accessibilityIdentifier("foundation.callback-message")
                    Text("Action callbacks: \(callbackCount)").font(.caption).accessibilityIdentifier(
                        "foundation.callback-count")
                    sectionTitle("Event card")
                    DIPEventCard(
                        content: .init(
                            title: "Puppy Yoga", dateText: "Thu, Nov 5 · 6:30–7:30 PM", locality: "Lawrenceville, PA",
                            attendeeCount: 7, registration: .joined),
                        image: eventImage.map(DIPEventImage.image) ?? .missing, attendees: people,
                        attendeeImage: { _ in avatarImage }
                    ) {
                        record("Event details callback")
                    }.accessibilityIdentifier("foundation.event-card")
                    sectionTitle("Actions")
                    Toggle("Simulate in-flight action", isOn: $isLoading).accessibilityIdentifier(
                        "foundation.loading-toggle")
                    DIPButton("Join activity", isLoading: isLoading) {
                        callbackCount += 1
                        record("Join action callback")
                    }
                    .accessibilityIdentifier("foundation.primary-action")
                    DIPButton("Disabled action", isEnabled: false) { record("Unexpected disabled callback") }
                        .accessibilityIdentifier("foundation.disabled-action")
                    DIPButton("View attendees", emphasis: .secondary) { record("Attendees callback") }
                        .accessibilityIdentifier("foundation.attendees-action")
                    sectionTitle("Avatars")
                    DIPAvatarGroup(people: people, totalCount: 7) { _ in avatarImage }
                    DIPAvatar(person: .init(id: "fixture-missing", name: ""))
                    sectionTitle("Loading")
                    DIPStateView(.loading(message: "Loading upcoming events"))
                    sectionTitle("Empty")
                    DIPStateView(.empty(title: "No upcoming events", message: "Try another date or check back later."))
                    sectionTitle("Error and retry")
                    DIPStateView(
                        .failure(
                            title: "Couldn't load events",
                            message: "Check your connection, then try loading the event list again."),
                        retryTitle: "Reload events"
                    ) { record("Retry callback") }
                    .accessibilityIdentifier("foundation.retry-state")
                    sectionTitle("Missing metadata and image error")
                    DIPEventCard(
                        content: .init(title: "", dateText: "", locality: "", registration: .unavailable),
                        image: .failed
                    ) { record("Missing-data card callback") }
                    sectionTitle("Image loading")
                    DIPEventCard(
                        content: .init(
                            title: "A very long coworker activity title that must wrap rather than be clipped",
                            dateText: "Wednesday, November 11 · 5:00 PM",
                            locality: "A longer neighborhood and location name"), image: .loading
                    ) { record("Loading-image card callback") }
                }
                .frame(width: max(0, geometry.size.width - 2 * DIPTokens.Spacing.contentInset), alignment: .leading)
                .padding(DIPTokens.Spacing.contentInset)
            }
        }
        .background(DIPTokens.Color.surfaceDefault.swiftUIColor)
    }
    private func sectionTitle(_ title: String) -> some View {
        Text(title).font(.title2.bold()).accessibilityAddTraits(.isHeader)
    }
    private func record(_ message: String) { self.message = message }
}

#Preview("V1 component gallery") { DIPFoundationGallery() }
#Preview("Accessibility text") { DIPFoundationGallery().environment(\.dynamicTypeSize, .accessibility3) }
