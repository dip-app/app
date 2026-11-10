import XCTest

@testable import DIPDesignSystem

final class PresentationTests: XCTestCase {
    func testMissingEventMetadataDoesNotInventDateOrLocation() {
        let content = DIPEventCardContent(
            title: "  ", dateText: "", locality: "\n", attendeeCount: nil, registration: .unavailable)
        XCTAssertEqual(content.displayTitle, "Untitled event")
        XCTAssertEqual(content.displayDate, "Date to be confirmed")
        XCTAssertEqual(content.displayLocality, "Location to be confirmed")
        XCTAssertTrue(content.accessibilityLabel.contains("Attendees unavailable"))
        XCTAssertEqual(content.registrationText, "Registration unavailable")
    }
    func testEventLabelIncludesDecisionDetailsAndJoinedValue() {
        let content = DIPEventCardContent(
            title: " Yoga ", dateText: "Thursday at 6 PM", locality: "Lawrenceville", attendeeCount: 1,
            registration: .joined)
        XCTAssertEqual(content.accessibilityLabel, "Yoga, Thursday at 6 PM, Lawrenceville, 1 attending")
        XCTAssertEqual(content.registrationText, "Joined")
        XCTAssertEqual(
            DIPEventCardContent(title: "x", dateText: "x", locality: "x", attendeeCount: -5).attendanceText,
            "0 attending")
    }
    func testAvatarOverflowDeduplicatesKnownPeopleAndIncludesUnknownAttendees() {
        let alex = DIPAvatarIdentity(id: "a", name: "Alex Morgan")
        let taylor = DIPAvatarIdentity(id: "t", name: "Taylor Lee")
        let summary = DIPAvatarGroupSummary(people: [alex, alex, taylor], totalCount: 7, maximumVisible: 1)
        XCTAssertEqual(summary.visiblePeople, [alex])
        XCTAssertEqual(summary.overflowCount, 6)
        XCTAssertEqual(summary.accessibilityLabel, "7 attendees: Alex Morgan, 6 more")
    }
    func testAvatarInputsHandleNoPeopleAndUnicodeNames() {
        XCTAssertEqual(DIPAvatarGroupSummary(people: [], totalCount: -2).accessibilityLabel, "No attendees yet")
        XCTAssertEqual(
            DIPAvatarGroupSummary(people: [.init(id: "a", name: "Alex")], maximumVisible: -3).overflowCount, 1)
        XCTAssertEqual(DIPAvatarIdentity(id: "u", name: " Élodie   王 ").initials, "É王")
        XCTAssertEqual(DIPAvatarIdentity(id: "u", name: " ").displayName, "Coworker")
    }
    func testV1DestinationsHaveRecognizableLabelsAndExcludeRewards() {
        XCTAssertEqual(DIPDestination.allCases.map(\.title), ["Home", "My Events", "Profile"])
        XCTAssertEqual(DIPDestination.myEvents.systemImage, "calendar")
    }
    func testBottomBarProgressIsAdditiveAndPartOfEquality() {
        let plain = DIPBottomBarAction(title: "Continue", identifier: "x")
        XCTAssertFalse(plain.showsProgress)
        XCTAssertNil(plain.icon)
        let busy = DIPBottomBarAction(title: "Continue", identifier: "x", showsProgress: true)
        XCTAssertTrue(busy.showsProgress)
        XCTAssertNotEqual(plain, busy)
    }
    func testFloatingNavigationStandardPlacementMatchesRootBar() {
        XCTAssertEqual(DIPFloatingNavigation.barCenterInset, 61)
        XCTAssertEqual(DIPFloatingNavigation.horizontalInset, 20)
        XCTAssertEqual(DIPFloatingNavigation.standardInsets.bottom, 21)
        XCTAssertEqual(DIPFloatingNavigation.standardInsets.leading, 20)
        XCTAssertEqual(DIPFloatingNavigation.standardInsets.trailing, 20)
        // On a 874 pt screen the bar occupies y 773...853.
        XCTAssertEqual(874 - DIPFloatingNavigation.barCenterInset - DIPFloatingNavigation.height / 2, 773)
    }
}
