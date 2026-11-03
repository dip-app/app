# Profile and social UI rubric — November 3, 2026

Independent review requested by the user. Scope: consistency with the existing app, native interaction quality, accessibility, resilient editing, and the interest/profile contract. This is a review of code and simulator evidence, not a claim of zero-pixel Figma equivalence or production readiness.

## Evidence and result

The initial November 3 review inspected normal Profile, interest catalog, failure/retry, large-text Profile/picker, and no-results captures from the eight-test account/profile run. A subsequent three-test run passed and supplied final evidence for account-backed profile persistence, large-text layout, and search/cancel behavior:

- `OnboardingFlowTests.testInterestChangesUseAccountRepositoryAndSurviveSignOut`
- `ProfileInterestTests.testLargeTextProfileAndPickerRemainUsable`
- `ProfileInterestTests.testSearchEmptyAndCancelPreserveProfileAndEditDraft`

The reviewer read the completed follow-up receipt `Test-Preview-2026.11.03_08-06-42--0500.xcresult`: three tests, zero failures, `TEST SUCCEEDED`. The final captures were exported and inspected independently. The account-backed screenshot uses the preview account repository; it does not establish a live Firebase deployment or a physical-device Google sign-in result.

[Profile screenshots and reproduction](../../../ui/ComponentPreview/Review/ProfileInterests/README.md) provide the review surface. [The interest contract](../../contracts/profile-interests.md) distinguishes the configured account adapter from the remaining mock-backed event/social experience.

## Qualified rubric

Scores describe this implementation and the inspected evidence; they are not an automated pixel-diff score.

| Area | Score | Finding |
| --- | --- | --- |
| Normal Profile consistency | 9.2/10 | Preserves the established artwork, display face, semantic palette, pill treatment and memory composition. Add interests is a clear adjacent action. |
| Interest picker | 9.0/10 | Readable native grouping, explicit Save/Cancel, searchable catalog, visible selection and stable-ID identity. |
| Large-text Profile and picker | 9.0/10 | Profile uses an adaptive header and a full-width Add interests control. The final sheet capture now visibly scales search, selection count and option text; it no longer relies only on a reachability assertion. |
| Failure, empty state and retry | 9.2/10 | Failure feedback is pinned and readable; the keyboard dismisses on Save while selection remains intact. The final compact no-results block remains readable above the software keyboard. |
| Profile/interest boundary | 9.5/10 | Selection uses opaque tag IDs, resolves labels separately, preserves missing IDs, enforces the ten-item maximum and delegates saves/sign-out through account-owned boundaries. Runtime evidence covers the preview account bridge, not a deployed service. |

**Profile/interests outcome: ready for review.** No remaining blocker was found in the inspected profile captures. These scores do not waive CI, security review, live-adapter validation, or manual VoiceOver/device checks.

## Findings resolved during review

- The large-text Add interests label originally broke into fragments in a narrow horizontal pill. Accessibility sizes now use a vertical entry and full-width action; ordinary-size layout remains horizontal.
- Failed-save feedback originally fell below the software keyboard. Save now dismisses search focus and failure/retry feedback stays visible at the top.
- The original large-text picker capture retained near-normal text sizing. Dynamic Type is now explicitly propagated into sheets, and the redundant explanation is hidden at accessibility sizes. The final capture shows readable scaled controls.
- The oversized native search-empty composition originally placed its heading behind the keyboard. The final compact message, “No matching interests / Try a different search,” is visible above it.
- Display labels originally supplied SwiftUI identity and command values. The current projection and picker use stable tag IDs, including separate identities for two unavailable or identically named interests.
- Native search mode originally hid the Save control. A native text-field row keeps Save/Cancel reachable while searching.

## Social review and remaining receipt

Earlier independent social review identified and the implementation addressed: alternate attendee-to-chat entry without joining, unconditional scrolling away from history, initial history opening at the oldest message, small comment tap targets, inaccessible collapse, unreachable older comments, stale photo errors and missing import attribution. The normal comment artwork remains compact while its touch area is larger. Earlier/newer comment actions retain a maximum of four visible bubbles and do not add the rejected thread panel.

The earlier social rubric was **8.8/10 provisionally** after code review. That was not a final visual or runtime approval. The parent reported eight individual social tests passing, including a real software-keyboard check, but disk exhaustion prevented a trustworthy final result-bundle receipt. A clean social-suite rerun is required before claiming its final verification gate passed. Do not substitute the profile receipt above for that social receipt.

The user explicitly deferred redesign of fixed photo edge/corner comment placement. Passing interaction tests is not visual approval of that arrangement. The weekly activity/challenge page was also added to the backlog rather than implemented in this round; both are tracked in [feature status](../../milestones/v2/FEATURE_STATUS.md).


## Final social receipt

The clean Nov3 rerun passes all eight ConversationFlowTests with a valid result bundle (`Test-Preview-2026.11.03_08-08-33--0500.xcresult`). It verifies real software-keyboard bounds, latest-message-on-open, history/focus, empty send, retry/reopen/isolation, joined-only entry, four compact/expanded bubbles and older-comment paging. This supersedes the earlier disk-corrupted receipt qualification. The functional gate is cleared; the user-requested placement redesign remains deferred and is not visually approved by these tests.
