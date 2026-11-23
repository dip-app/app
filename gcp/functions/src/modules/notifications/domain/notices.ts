import type { Locale } from "../../i18n";
import { tPush } from "./i18n";

/**
 * In-app notice copy (`users/{uid}/notifications` title and body) for the notices that commands write inside their own
 * transaction, in the recipient's language. The push catalog holds the copy (`push.*` keys); server and user content
 * (event and theme titles, names) is never translated. English output is byte-identical to the strings these commands
 * wrote before localization (pinned in gcp/tests/unit/notification-text-i18n.test.ts).
 */
export interface NoticeText { title: string; body: string }

const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

/** `invite` notice (sendInviteV1). The sender name is capped at 40 and the event title at 60 characters. */
export function inviteNotice(fromName: string, eventTitle: string, locale: Locale = "en"): NoticeText {
  const from = clip(fromName || tPush(locale, "push.invite.fallbackFrom"), 40);
  return { title: tPush(locale, "push.invite.title"), body: tPush(locale, "push.invite.body", { from, title: clip(eventTitle, 60) }) };
}

/** `attendee_added` notice (addEventAttendeeV1). The caller caps the stored lengths. */
export function attendeeAddedNotice(eventTitle: string, locale: Locale = "en"): NoticeText {
  return { title: tPush(locale, "push.notice.attendeeAdded.title"), body: tPush(locale, "push.attendeeAdded.body", { title: eventTitle }) };
}

/** `challenge_approved` notice (approveChallengeV1). `points` is what this approval awarded (0 when already awarded). */
export function challengeApprovedNotice(points: number, locale: Locale = "en"): NoticeText {
  return {
    title: tPush(locale, "push.notice.challengeApproved.title"),
    body: points > 0 ? tPush(locale, "push.notice.challengeApproved.points", { points }) : tPush(locale, "push.notice.challengeApproved.body"),
  };
}
