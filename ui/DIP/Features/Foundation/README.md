# UI foundation fixtures and integration handoff

DIPFoundationGallery is an interactive development fixture, not the Home screen or a mocked production RSVP flow. Its only state is selected tab, callback message/count and a loading toggle. The standalone host in ui/ComponentPreview renders it without changing DIPApp. See that host's README for simulator tests.

Consumers map DTOs/domain state into presentation values:

```swift
DIPEventCard(
    content: DIPEventCardContent(
        title: eventTitle,
        dateText: formattedDateAndTime,
        locality: venueLocality,
        attendeeCount: attendingCount,
        registration: isJoined ? .joined : .available
    ),
    image: loadedImage.map(DIPEventImage.image) ?? .missing,
    attendees: attendeeIdentities
) {
    openEventDetails()
}
```

The feature owns formatting, image loading/authorization, async commands and navigation. Pass loaded images through the avatar/card APIs; no Firebase snapshot, URL token, callable client or backend error belongs in these components. DIPButton receives feature-owned enabled/loading flags and one callback. DIPStateView receives user-facing copy and an optional retry callback. DIPTabBar takes a Binding<DIPDestination> and a content builder for each V1 destination; the binding is the selection callback boundary.

The integrator can add the gallery to a debug-only destination once app composition is ready. Do not replace the production startup with this gallery or wire account/event/organizer screens from this packet. Public APIs and state behavior are summarized in [component contracts](../../../../docs/design/components.md).
