import DIPCore
import DIPMockData
import XCTest

final class ThemeCatalogTests: XCTestCase {
    func testFitnessKeyResolvesToBundledMascotOnChallengeAccent() {
        let theme = DIPThemeCatalog.theme(coverImageURL: "catalog://theme/fitness")
        XCTAssertTrue(theme.isKnown)
        XCTAssertEqual(theme.key, "fitness")
        XCTAssertEqual(theme.displayName, "Fitness")
        XCTAssertEqual(theme.illustration, .asset("Mascot"))
        XCTAssertEqual(theme.accent, .challenge)
        XCTAssertFalse(theme.goalUnitSuggestions.isEmpty)
        XCTAssertEqual(DIPThemeCatalog.themes.first?.key, "fitness")
        XCTAssertEqual(DIPThemeCatalog.catalogURL(for: "fitness"), "catalog://theme/fitness")
    }

    func testUnknownOrForeignValuesGetNeutralTitleOnlyFallback() {
        for url in ["catalog://theme/yoga", "catalog://theme/", "catalog://default/fitness", "https://example.test/photo.jpg",
                    "catalog://theme/Fitness", "catalog://theme/../fitness", "", "catalog://theme/fitness/extra"] {
            let theme = DIPThemeCatalog.theme(coverImageURL: url)
            XCTAssertFalse(theme.isKnown, url)
            XCTAssertNil(theme.illustration, url)
            XCTAssertEqual(theme.accent, .neutral, url)
        }
        XCTAssertEqual(DIPThemeCatalog.key(coverImageURL: "catalog://theme/yoga"), "yoga")
        XCTAssertEqual(DIPThemeCatalog.theme(key: "yoga").key, "yoga")
        XCTAssertNil(DIPThemeCatalog.key(coverImageURL: "https://example.test/x"))
    }
}

final class WeeklyChallengeTests: XCTestCase {
    let start = DIPChallengeFixtures.weekStart
    let end = DIPChallengeFixtures.weekEnd
    func theme(_ id: String, start: Date, end: Date, type: String = "weekly") -> DIPWeeklyChallenge {
        var value = DIPChallengeFixtures.fitness(); value.id = id; value.startDate = start; value.endDate = end; value.type = type
        return value
    }

    func testSelectionPicksTheStartedWindowAndIgnoresFutureAndOtherTypes() {
        let week = 7 * 86_400.0
        let current = theme("current", start: start, end: end)
        let next = theme("next", start: start + week, end: end + week)
        let other = theme("daily", start: start, end: start + 3600, type: "daily")
        let now = start.addingTimeInterval(3 * 86_400)
        XCTAssertEqual(DIPWeeklyChallengeSelection.current([current, next], now: now)?.id, "current")
        XCTAssertEqual(DIPWeeklyChallengeSelection.current([next, current], now: now)?.id, "current")
        XCTAssertNil(DIPWeeklyChallengeSelection.current([next], now: now), "a future window is not this week's")
        XCTAssertNil(DIPWeeklyChallengeSelection.current([other], now: start.addingTimeInterval(60)))
        XCTAssertNil(DIPWeeklyChallengeSelection.current([], now: now))
    }

    func testPastWindowIsNeverCurrentAndBoundariesAreInclusive() {
        let current = theme("current", start: start, end: end)
        XCTAssertEqual(DIPWeeklyChallengeSelection.current([current], now: start)?.id, "current")
        XCTAssertEqual(DIPWeeklyChallengeSelection.current([current], now: end)?.id, "current")
        XCTAssertNil(DIPWeeklyChallengeSelection.current([current], now: end.addingTimeInterval(1)))
        XCTAssertNil(DIPWeeklyChallengeSelection.current([current], now: start.addingTimeInterval(-1)))
    }

    func testSelectionUsesInstantsNotTheDeviceTimeZone() {
        // Monday 00:00 New York is Sunday 21:00 in Los Angeles: the theme is already current there.
        let current = theme("current", start: start, end: end)
        let sundayEveningLA = start.addingTimeInterval(60)
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(identifier: "America/Los_Angeles")!
        XCTAssertEqual(calendar.component(.weekday, from: sundayEveningLA), 1)
        XCTAssertEqual(DIPWeeklyChallengeSelection.current([current], now: sundayEveningLA)?.id, "current")
    }

    func testWindowTextShowsInclusiveNewYorkDaysOnEveryDevice() {
        let en = Locale(identifier: "en_US")
        XCTAssertEqual(DIPChallengeProjection.windowText(start: start, end: end, locale: en), "Nov 9 - Nov 15")
        // An exclusive Monday 00:00 end still shows Sunday.
        XCTAssertEqual(DIPChallengeProjection.windowText(start: start, end: end.addingTimeInterval(1), locale: en), "Nov 9 - Nov 15")
        // Formatting in the device zone would show Nov 8 on the West coast; the display zone is fixed.
        XCTAssertEqual(DIPChallengeProjection.windowText(start: start, end: end, timeZone: TimeZone(identifier: "America/Los_Angeles")!, locale: en), "Nov 8 - Nov 15")
        XCTAssertEqual(DIPChallengeProjection.displayTimeZone.identifier, "America/New_York")
    }

    func testProjectionUsesCatalogArtworkAndMemberCopy() {
        let summary = DIPChallengeProjection.summary(DIPChallengeFixtures.fitness(participantCount: 128))
        XCTAssertEqual(summary.category, "Fitness")
        XCTAssertEqual(summary.artwork, .asset("Mascot"))
        XCTAssertEqual(summary.accent, .challenge)
        XCTAssertTrue(summary.avatars.isEmpty, "v1 live data has no participant faces")
        XCTAssertEqual(summary.participationText, "+ 128 others participating")
        XCTAssertEqual(summary.accessibilityLabel, "This week’s challenge: Fitness, 128 others participating")
        XCTAssertEqual(DIPChallengeProjection.summary(DIPChallengeFixtures.fitness(participantCount: 1)).participationText, "+ 1 other participating")
        let empty = DIPChallengeProjection.summary(DIPChallengeFixtures.fitness(participantCount: 0))
        XCTAssertEqual(empty.participationText, "Be the first this week")
        XCTAssertEqual(empty.accessibilityLabel, "This week’s challenge: Fitness, be the first this week")

        let detail = DIPChallengeProjection.detail(DIPChallengeFixtures.fitness(), locale: Locale(identifier: "en_US"))
        XCTAssertEqual(detail.timing, "Nov 9 - Nov 15")
        XCTAssertEqual(detail.goalText, "3 workouts")
        XCTAssertEqual(detail.rewardText, "+50 points")
        XCTAssertEqual(detail.image, .asset("Mascot"))
        XCTAssertEqual(DIPChallengeProjection.goalText(goal: 2.5, unit: " km "), "2.5 km")
        XCTAssertNil(DIPChallengeProjection.goalText(goal: 0, unit: "workouts"))
        XCTAssertNil(DIPChallengeProjection.rewardText(0))
    }

    func testUnknownThemeProjectsTitleOnlyNeutralCard() {
        var value = DIPChallengeFixtures.fitness(); value.coverImageURL = "catalog://theme/sleep"; value.title = "Sleep"
        let summary = DIPChallengeProjection.summary(value)
        XCTAssertNil(summary.artwork); XCTAssertEqual(summary.accent, .neutral); XCTAssertEqual(summary.category, "Sleep")
    }

    func testCardStateAccessors() {
        let summary = DIPChallengeFixtures.referenceSummary
        XCTAssertEqual(DIPChallengeCardState.current(summary, stale: true).summary, summary)
        XCTAssertTrue(DIPChallengeCardState.current(summary, stale: true).isStale)
        XCTAssertFalse(DIPChallengeCardState.current(summary, stale: false).isStale)
        for state in [DIPChallengeCardState.loading, .none, .failed("x")] { XCTAssertNil(state.summary); XCTAssertFalse(state.isStale) }
    }

    func testReferenceFixtureKeepsTheFigmaCardContent() {
        let reference = DIPMockFixtures.reference
        let card = try? XCTUnwrap(reference.home.challenge)
        XCTAssertEqual(card?.category, "Fitness")
        XCTAssertEqual(card?.participantCount, 128)
        XCTAssertEqual(card?.avatars.count, 3)
        XCTAssertEqual(card?.participationText, "+ 128 others participating")
        let detail = reference.challengeDetails[DIPChallengeFixtures.referenceID]
        XCTAssertEqual(detail?.title, "Fitness"); XCTAssertEqual(detail?.timing, "Nov 9 - Nov 15")
    }
}
