/**
 * Stable message keys for the typed errors the admin portal can receive (issue #259 backend phase). The English text of
 * a typed error stays exactly what clients saw before (`HttpsError.message`); the callable mappers add
 * `details.messageKey` (and `messageParams`) so the portal renders the message from its own catalog (`errors.*`) in the
 * viewer's language. Unknown messages carry no key and the portal shows the server text.
 *
 * English values are unique (a reverse lookup by text finds the key). Parameterized messages use ICU slots and have an
 * explicit matcher in `errorMessageDetails`. scripts/backend-i18n/portalKeys.ts checks the portal catalogs against this
 * list and that every literal error message in the backend modules is covered.
 */
export const ERROR_MESSAGES = {
  "errors.generic": "Something went wrong. Try again later.",
  // Sign-in, account and permissions.
  "errors.unauthenticated": "Sign in to continue.",
  "errors.unauthenticated.again": "Sign in again.",
  "errors.emailNotVerified": "Verified email required.",
  "errors.providerNotAllowed": "Google sign-in required.",
  "errors.membershipConflict": "Company membership required.",
  "errors.accountDeactivated": "This account is deactivated.",
  "errors.insufficientRole": "You don't have permission to do this.",
  "errors.companyMismatch": "You can only manage your own company.",
  "errors.companyMismatch.events": "You can only manage your own company's events.",
  "errors.companyMismatch.themes": "You can only manage your own company's weekly themes.",
  "errors.companyMismatch.submissions": "You can only review your own company's submissions.",
  "errors.notOrganizer.events": "Only organizers can manage events.",
  "errors.notOrganizer.themes": "Only organizers can manage weekly themes.",
  "errors.notOrganizer.submissions": "Only organizers can review submissions.",
  "errors.rateLimited": "Too many requests. Try again later.",
  "errors.requestReused": "This request ID was already used with different details.",
  // Validation.
  "errors.validationFailed": "Invalid request.",
  "errors.validationFailed.fields": "Check the highlighted fields.",
  "errors.validationFailed.linkExpired": "This link has expired. Open the latest ideas email or the event ideas page.",
  "errors.validationFailed.cover": "Choose a cover from the library.",
  "errors.validationFailed.eventFuture": "New events must start in the future.",
  "errors.validationFailed.themeDatesPassed": "This theme's dates have already passed.",
  "errors.validationFailed.endAfterStart": "The end must be after the start.",
  "errors.validationFailed.maxSpan": "A theme can last at most 14 days.",
  "errors.tagNotFound": "Choose tags from the list.",
  "errors.teamNotFound": "Team not found.",
  "errors.teamNotFound.choose": "Choose teams from the catalog.",
  "errors.teamNameTaken": "A team with this name already exists.",
  "errors.emailDomainMismatch": "Email is outside the company's domain.",
  "errors.emailAlreadyMember": "This person already has an account. Edit them as a member.",
  // Not found.
  "errors.eventNotFound": "Event not found.",
  "errors.eventNotFound.organizer": "That event doesn't exist.",
  "errors.memberNotFound": "Member not found.",
  "errors.photoNotFound": "Photo not found.",
  "errors.companyNotFound": "Company not found.",
  "errors.bugReportNotFound": "Bug report not found.",
  "errors.assigneeNotFound": "That person can't be assigned. Pick an admin of your company.",
  "errors.rosterEntryNotFound": "Roster entry not found.",
  "errors.importJobNotFound": "Import not found.",
  "errors.placeNotFound": "That place could not be found. Pick a suggestion.",
  "errors.challengeNotFound": "That weekly theme doesn't exist.",
  "errors.challengeNotFound.theme": "Weekly theme not found.",
  "errors.submissionNotFound": "Submission not found.",
  "errors.submitterNotFound": "The member is no longer in this company.",
  // Concurrency and state.
  "errors.revisionConflict.member": "Someone else changed this member. Reload and try again.",
  "errors.revisionConflict.bugReport": "Someone else updated this report. Reload it and try again.",
  "errors.revisionConflict.event": "Someone else changed this event. Reload it and try again.",
  "errors.revisionConflict.theme": "Someone else changed this weekly theme. Reload it and try again.",
  "errors.requestInProgress.ideas": "These ideas are still being written. Wait a moment.",
  "errors.requestInProgress.weekly": "This week's ideas are still being prepared. Try again in a moment.",
  "errors.lastAdmin": "A company needs at least one admin.",
  "errors.lastAdmin.active": "A company needs at least one active admin.",
  "errors.cannotDeactivateSelf": "You can't deactivate your own account.",
  "errors.insufficientPoints": "The balance can't go below zero.",
  "errors.attendanceLocked": "Points were already awarded for this attendance.",
  "errors.notGoing": "Only going attendees can be checked in.",
  "errors.eventClosed": "Event is closed.",
  "errors.eventClosed.ended": "This event has ended.",
  "errors.eventNotStarted": "Attendance can be recorded once the event has started.",
  "errors.eventNotEnded": "The event hasn't ended yet.",
  "errors.eventFull": "Event is full.",
  "errors.capacityBelowAttendees": "Capacity can't be lower than the number of people already going.",
  "errors.timeChangeBlocked": "The times can't be changed once anyone has responded. Cancel and recreate the event instead.",
  "errors.statusTransitionBlocked.completed": "Only a scheduled event can be marked completed.",
  "errors.statusTransitionBlocked.reopen": "A completed event with photos can only be reopened by an admin with a reason.",
  "errors.challengeWindowOverlap": "Another weekly theme already runs during these dates.",
  "errors.windowChangeBlocked": "People have already joined, so the start can't move and the end can't be set in the past.",
  "errors.challengeClosed": "This theme has ended.",
  "errors.challengeNotOpen": "This theme has not started yet.",
  "errors.submissionChanged": "The member changed this entry. Reload it and review again.",
  "errors.submissionLocked": "This entry was already approved.",
  "errors.submissionNotPending": "Only pending submissions can be approved.",
  "errors.selfReview": "You cannot review your own submission.",
  "errors.uploadInvalid": "The uploaded file is not an accepted photo.",
  "errors.uploadNotFound": "Upload the photo before submitting.",
  // Roster and import.
  "errors.rosterEntryClaimed": "This person already signed in.",
  "errors.rosterEntryNotInvited": "Invite this person again before resending.",
  "errors.resendLimit": "This invite was already resent several times. Reach out to the person directly.",
  "errors.importJobBusy": "This import is already being applied.",
  "errors.importPlanMismatch": "The plan changed. Review it again.",
  "errors.importTooLarge": "The directory is too large to import in one pass.",
  "errors.importTooLarge.rows": "At most {max} rows per import.",
  // Dipbot, covers, places and email suggestions.
  "errors.aiDisabled": "AI event ideas are turned off for this company.",
  "errors.aiUnavailable": "The AI service is busy. Try again in a minute.",
  "errors.aiUnavailable.suggestions": "Suggested ideas aren't available on this server yet.",
  "errors.aiUnavailable.weeklyEmail": "The weekly ideas email isn't set up on this server yet.",
  "errors.aiPromptRejected": "We couldn't use that note. Describe the kind of event you want and try again.",
  "errors.aiPromptRejected.contacts": "Leave out links, email addresses and phone numbers.",
  "errors.aiOutputInvalid": "The ideas didn't come out right. Try again or change your choices.",
  "errors.aiFlagLimit": "Too many notes were declined today. Try again tomorrow.",
  "errors.aiDailyLimit": "You have used today's idea requests. Try again tomorrow.",
  "errors.aiMonthlyLimit": "This company has used this month's idea requests.",
  "errors.aiBudgetExhausted.month": "This month's idea budget is used up.",
  "errors.aiBudgetExhausted.today": "Today's idea budget is used up. Try again tomorrow.",
  "errors.aiCreditsExhausted": "This company has used this month's Dipbot credits.",
  "errors.aiIdeasRefreshLimit": "You have used today's idea refreshes. Try again tomorrow.",
  "errors.aiThemeSuggestDisabled": "Theme suggestions are turned off for this company.",
  "errors.aiThemeSuggestLimit": "You have used today's theme suggestions. Try again tomorrow.",
  "errors.aiPromptRejected.themeHint": "We couldn't use that hint. Describe the kind of theme you want and try again.",
  "errors.aiVenuesDisabled": "Venue search is not available right now.",
  "errors.coverSearchUnavailable": "More cover photos are not available right now.",
  "errors.coverCandidateExpired": "That photo is no longer available. Search again.",
  "errors.coverImportFailed": "The photo could not be imported. Try another one.",
  "errors.officeNotSet": "Set the office location before searching for venues.",
  "errors.venueSearchLimit": "The daily venue search limit was reached. Try again tomorrow.",
  "errors.venuesUnavailable": "Venue search is unavailable right now. Try again later.",
  "errors.placesDisabled": "Place search is not available right now.",
  "errors.placesLimit": "The daily place lookup limit was reached. Try again tomorrow.",
  "errors.placesUnavailable": "Place search is unavailable right now. Try again later.",
} as const;

export type ErrorMessageKey = keyof typeof ERROR_MESSAGES;

export interface ErrorMessageDetails {
  messageKey: string;
  messageParams?: Record<string, string | number>;
}

const KEY_BY_TEXT: ReadonlyMap<string, string> = new Map(Object.entries(ERROR_MESSAGES).map(([key, text]) => [text, key]));

/** Messages with a number in them: matched explicitly because the text is built from a constant. */
const PARAMETERIZED: ReadonlyArray<{ pattern: RegExp; key: ErrorMessageKey; params: (match: RegExpExecArray) => Record<string, number> }> = [
  { pattern: /^At most (\d+) rows per import\.$/, key: "errors.importTooLarge.rows", params: (match) => ({ max: Number(match[1]) }) },
];

/**
 * The message key (and params) for a typed error's English message, to add to the callable error details. Unknown
 * messages yield `{}`: the portal then shows the server text as is.
 */
export function errorMessageDetails(message: string): ErrorMessageDetails | Record<string, never> {
  const key = KEY_BY_TEXT.get(message);
  if (key) return { messageKey: key };
  for (const entry of PARAMETERIZED) {
    const match = entry.pattern.exec(message);
    if (match) return { messageKey: entry.key, messageParams: entry.params(match) };
  }
  return {};
}
