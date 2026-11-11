import XCTest

/// Coworker invitations against the fixture repository (no Firebase): the bell opens the Invitations sheet
/// (badge = pending count), accepting moves a card to "Going", declining removes it, and the event page's
/// Invite a Coworker opens the picker, where a search result can be invited once.
/// `--invites-state=empty|loading|failed|full|search-failed|send-failed` selects the review variants.
final class InvitesTests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    private func launch(_ arguments: [String]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = arguments
        app.launch()
        return app
    }

    private func shot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }

    @MainActor func testBellBadgeCountsPendingInvitesAndOpensTheSheet() {
        let app = launch([])
        let bell = app.buttons["home.notifications"]
        XCTAssertTrue(bell.waitForExistence(timeout: 20))
        XCTAssertTrue(bell.label.contains("2"), "badge is the two pending invitations, got \(bell.label)")
        bell.tap()
        XCTAssertTrue(app.buttons["invitations.accept.e1_me"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["invitations.decline.e1_me"].exists)
        XCTAssertTrue(app.buttons["invitations.open.e1_me"].exists)
        shot("invitations-received")
    }

    @MainActor func testAcceptMovesTheCardToGoingAndDeclineRemovesIt() {
        let app = launch(["--screen=invitations"])
        let accept = app.buttons["invitations.accept.e1_me"]
        XCTAssertTrue(accept.waitForExistence(timeout: 20))
        accept.tap()
        XCTAssertTrue(app.buttons["invitations.going.e1_me"].waitForExistence(timeout: 10), "accepted invitation is listed under Going")
        XCTAssertFalse(app.buttons["invitations.accept.e1_me"].exists)
        app.buttons["invitations.decline.e2_me"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["invitations.toast"].waitForExistence(timeout: 5), "an answered invitation is confirmed")
        shot("invitations-toast")
        XCTAssertTrue(app.buttons["invitations.decline.e2_me"].waitForNonExistence(timeout: 10))
        XCTAssertTrue(app.descendants(matching: .any)["empty.invitations-received"].waitForNonExistence(timeout: 1), "the accepted invitation still shows")
        shot("invitations-answered")
    }

    @MainActor func testSentTabShowsEveryStatus() {
        let app = launch(["--screen=invitations"])
        XCTAssertTrue(app.buttons["invitations.segment.sent"].waitForExistence(timeout: 20))
        app.buttons["invitations.segment.sent"].tap()
        for label in ["Pending", "Accepted", "Declined"] {
            XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", label)).firstMatch.waitForExistence(timeout: 10), label)
        }
        shot("invitations-sent")
    }

    @MainActor func testEmptyLoadingAndFailedStates() {
        let empty = launch(["--screen=invitations", "--invites-state=empty"])
        XCTAssertTrue(empty.descendants(matching: .any)["empty.invitations-received"].waitForExistence(timeout: 20))
        shot("invitations-empty")
        empty.terminate()

        let loading = launch(["--screen=invitations", "--invites-state=loading"])
        XCTAssertTrue(loading.descendants(matching: .any)["invitations.loading"].waitForExistence(timeout: 20))
        shot("invitations-loading")
        loading.terminate()

        let failed = launch(["--screen=invitations", "--invites-state=failed"])
        XCTAssertTrue(failed.descendants(matching: .any)["empty.invitations-error"].waitForExistence(timeout: 20))
        shot("invitations-failed")
    }

    @MainActor func testAcceptingAFullActivityKeepsTheInvitationWithAnActionableError() {
        let app = launch(["--screen=invitations", "--invites-state=full"])
        let accept = app.buttons["invitations.accept.e1_me"]
        XCTAssertTrue(accept.waitForExistence(timeout: 20))
        accept.tap()
        XCTAssertTrue(app.descendants(matching: .any)["invitations.error.e1_me"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["invitations.decline.e1_me"].exists, "the invitation can still be declined")
        XCTAssertFalse(app.buttons["invitations.accept.e1_me"].isEnabled, "a refused Accept is not offered again")
        shot("invitations-full")
    }

    @MainActor func testPickerNeedsTwoLettersThenInvitesOnce() {
        let app = launch(["--screen=invite-picker", "--v1-event-fixtures"])
        let field = app.descendants(matching: .any)["invite.search"]
        XCTAssertTrue(field.waitForExistence(timeout: 20))
        XCTAssertTrue(app.descendants(matching: .any)["empty.invite-start"].exists)
        field.tap()
        field.typeText("p")
        XCTAssertTrue(app.descendants(matching: .any)["empty.invite-hint"].waitForExistence(timeout: 5), "one letter asks for two")
        field.typeText("ri")
        let invite = app.buttons["invite.send.u-priya"]
        XCTAssertTrue(invite.waitForExistence(timeout: 10))
        shot("invite-picker-results")
        invite.tap()
        XCTAssertTrue(app.descendants(matching: .any)["invite.state.u-priya"].waitForExistence(timeout: 10), "row shows Invited")
        XCTAssertFalse(app.buttons["invite.send.u-priya"].exists, "a person cannot be invited twice")
        XCTAssertTrue(app.descendants(matching: .any)["invite.state.u-sam"].exists == false)
    }

    @MainActor func testPickerShowsGoingAndNoMatchAndSearchFailure() {
        let app = launch(["--screen=invite-picker", "--v1-event-fixtures"])
        let field = app.descendants(matching: .any)["invite.search"]
        XCTAssertTrue(field.waitForExistence(timeout: 20))
        field.tap(); field.typeText("sam")
        XCTAssertTrue(app.descendants(matching: .any)["invite.state.u-sam"].waitForExistence(timeout: 10), "a coworker who is going is not invitable")
        app.buttons["invite.search.clear"].tap()
        field.typeText("zzz")
        XCTAssertTrue(app.descendants(matching: .any)["empty.invite-none"].waitForExistence(timeout: 10))
        app.terminate()

        let failing = launch(["--screen=invite-picker", "--v1-event-fixtures", "--invites-state=search-failed"])
        let failingField = failing.descendants(matching: .any)["invite.search"]
        XCTAssertTrue(failingField.waitForExistence(timeout: 20))
        failingField.tap(); failingField.typeText("pr")
        XCTAssertTrue(failing.descendants(matching: .any)["empty.invite-error"].waitForExistence(timeout: 10))
        shot("invite-picker-offline")
    }

    @MainActor func testEventPageOffersInviteACoworkerAndOpensThePicker() {
        let app = launch(["--screen=event", "--v1-event-fixtures"])
        let invite = app.buttons["event.invite"]
        XCTAssertTrue(invite.waitForExistence(timeout: 20))
        shot("event-invite-action")
        invite.tap()
        XCTAssertTrue(app.descendants(matching: .any)["invite.search"].waitForExistence(timeout: 10))
        shot("invite-picker-empty")
    }

    @MainActor func testPastEventHasNoInviteAction() {
        let app = launch(["--screen=past-event", "--v1-event-fixtures"])
        XCTAssertTrue(app.buttons["event.primary"].waitForExistence(timeout: 20))
        XCTAssertFalse(app.buttons["event.invite"].exists)
    }

    @MainActor func testSentTabEmptyAndPickerNoResultsAndSendingAndAlreadyInvited() {
        let empty = launch(["--screen=invitations", "--invites-state=empty"])
        XCTAssertTrue(empty.buttons["invitations.segment.sent"].waitForExistence(timeout: 20))
        empty.buttons["invitations.segment.sent"].tap()
        XCTAssertTrue(empty.descendants(matching: .any)["empty.invitations-sent"].waitForExistence(timeout: 10))
        shot("invitations-sent-empty")
        empty.terminate()

        let none = launch(["--screen=invite-picker", "--v1-event-fixtures"])
        let field = none.descendants(matching: .any)["invite.search"]
        XCTAssertTrue(field.waitForExistence(timeout: 20))
        field.tap(); field.typeText("zzz")
        XCTAssertTrue(none.descendants(matching: .any)["empty.invite-none"].waitForExistence(timeout: 10))
        shot("invite-picker-no-results")
        none.terminate()

        let slow = launch(["--screen=invite-picker", "--v1-event-fixtures", "--invites-state=slow-send"])
        let slowField = slow.descendants(matching: .any)["invite.search"]
        XCTAssertTrue(slowField.waitForExistence(timeout: 20))
        slowField.tap(); slowField.typeText("priya")
        let send = slow.buttons["invite.send.u-priya"]
        XCTAssertTrue(send.waitForExistence(timeout: 10))
        send.tap()
        shot("invite-picker-sending")
        slow.terminate()

        let other = launch(["--screen=invite-picker", "--v1-event-fixtures", "--invites-state=already-invited"])
        let otherField = other.descendants(matching: .any)["invite.search"]
        XCTAssertTrue(otherField.waitForExistence(timeout: 20))
        otherField.tap(); otherField.typeText("priya")
        other.buttons["invite.send.u-priya"].tap()
        XCTAssertTrue(other.descendants(matching: .any)["invite.row.already.u-priya"].waitForExistence(timeout: 10))
        shot("invite-picker-already-invited")
    }

    /// Frames taken right after a tap, while the springs (~0.4 s) are still settling, for the design audit.
    @MainActor func testMotionFramesAreCaptured() {
        let app = launch(["--screen=invitations"])
        let accept = app.buttons["invitations.accept.e1_me"]
        XCTAssertTrue(accept.waitForExistence(timeout: 15))
        accept.tap()
        shot("motion-invitations-accept-mid")
        XCTAssertTrue(app.buttons["invitations.going.e1_me"].waitForExistence(timeout: 15))
        app.terminate()

        let picker = launch(["--screen=invite-picker", "--v1-event-fixtures"])
        let field = picker.descendants(matching: .any)["invite.search"]
        XCTAssertTrue(field.waitForExistence(timeout: 15))
        field.tap(); field.typeText("pr")
        let invite = picker.buttons["invite.send.u-priya"]
        XCTAssertTrue(invite.waitForExistence(timeout: 15))
        shot("motion-picker-entrance-mid")
        invite.tap()
        shot("motion-picker-invite-mid")
        XCTAssertTrue(picker.descendants(matching: .any)["invite.state.u-priya"].waitForExistence(timeout: 15))
        shot("motion-picker-invited-final")
    }

    /// The event page always shows exactly two pills side by side: [Invite Coworker | Share Event] while inviting is
    /// possible, [Directions | Share Event] otherwise (full, past, cancelled). Frames are kept for the design audit.
    @MainActor func testEventPagePillPairInEveryState() {
        func assertPair(_ app: XCUIApplication, first: String, absent: String, _ state: String) {
            let lead = app.buttons[first].exists ? app.buttons[first] : app.descendants(matching: .any)[first]
            XCTAssertTrue(lead.waitForExistence(timeout: 20), "\(state): \(first)")
            XCTAssertFalse(app.descendants(matching: .any)[absent].exists, "\(state): no \(absent)")
            let share = app.buttons["event.share"]
            XCTAssertTrue(share.exists, "\(state): Share Event")
            XCTAssertEqual(lead.frame.minY, share.frame.minY, accuracy: 1, "\(state): side by side")
            XCTAssertEqual(lead.frame.width, share.frame.width, accuracy: 2, "\(state): equal pills")
            XCTAssertEqual(lead.frame.height, share.frame.height, accuracy: 1, "\(state): same height")
            shot("event-pills-\(state)")
        }
        let upcoming = launch(["--screen=event", "--v1-event-fixtures"])
        assertPair(upcoming, first: "event.invite", absent: "event.directions", "upcoming")
        upcoming.terminate()
        let joined = launch(["--screen=event-joined", "--v1-event-fixtures"])
        assertPair(joined, first: "event.invite", absent: "event.directions", "joined")
        joined.terminate()
        let full = launch(["--screen=event", "--v1-event-fixtures", "--event-full"])
        assertPair(full, first: "event.directions", absent: "event.invite", "full")
        full.terminate()
        let cancelled = launch(["--screen=event", "--v1-event-fixtures", "--event-cancelled"])
        assertPair(cancelled, first: "event.directions", absent: "event.invite", "cancelled")
        XCTAssertEqual(cancelled.staticTexts["event.attendeeNote"].label, "Cancelled", "a cancelled activity says so instead of a count")
        cancelled.terminate()
        let past = launch(["--screen=past-event", "--v1-event-fixtures"])
        XCTAssertTrue(past.buttons["event.primary"].waitForExistence(timeout: 20))
        XCTAssertFalse(past.buttons["event.invite"].exists)
        XCTAssertTrue(past.descendants(matching: .any)["event.directions"].waitForExistence(timeout: 5), "past: Directions is the first pill")
        XCTAssertTrue(past.buttons["event.share"].exists)
        XCTAssertTrue(past.staticTexts["event.attendeeNote"].label.hasSuffix(" went"), "a past activity shows how many went")
        shot("event-pills-past")
    }
}
