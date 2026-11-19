import { attendeeAddedEmail, challengeReviewedEmail, eventFacts, inviteAnsweredEmail } from "./emailPayload";
import type { NotificationRequest } from "./router";
import type { MemberPager, WeeklyTheme, WeeklyThemeReader } from "./routerPorts";
import { attendeeAddedPush, challengeReviewedPush, inviteAnsweredPush, weeklyThemePush } from "../domain/push";

/**
 * Requests for the triggers that always use the router (PUSH-4). Each builds a `NotificationRequest` with
 * server-derived recipients; callers hand it to `deliverNotification`. In-app notices of these kinds are written
 * by the owning command inside its own transaction (same ids), so no `inApp` is passed here, except for
 * `invite_answered`, which has no other writer.
 */

export interface AttendeeAddedInput {
  companyId: string; eventId: string; eventTitle: string; userId: string; notificationId: string;
  /** Optional event times for the email; without both, no email is requested. */
  eventStartTime?: Date; eventEndTime?: Date;
}
export function attendeeAddedRequest(input: AttendeeAddedInput): NotificationRequest {
  return {
    id: input.notificationId, kind: "attendee_added", companyId: input.companyId,
    recipients: [{ uid: input.userId }],
    push: attendeeAddedPush(input.companyId, input.eventId, input.eventTitle),
    pushFor: (locale) => attendeeAddedPush(input.companyId, input.eventId, input.eventTitle, locale),
    email: attendeeAddedEmail(input.eventId, input.notificationId,
      eventFacts({ eventId: input.eventId, title: input.eventTitle, startTime: input.eventStartTime, endTime: input.eventEndTime })),
  };
}

export interface InviteAcceptedInput {
  companyId: string; eventId: string; eventTitle: string; inviteId: string; senderId: string; responderName: string;
  /** Optional event times for the email; without both, no email is requested. */
  eventStartTime?: Date; eventEndTime?: Date;
}
export function inviteAnsweredRequest(input: InviteAcceptedInput): NotificationRequest {
  const push = inviteAnsweredPush(input.companyId, input.eventId, input.eventTitle, input.inviteId, input.responderName);
  return {
    id: `invite_answered_${input.inviteId}`, kind: "invite_answered", companyId: input.companyId,
    recipients: [{ uid: input.senderId }], push,
    pushFor: (locale) => inviteAnsweredPush(input.companyId, input.eventId, input.eventTitle, input.inviteId, input.responderName, locale),
    inApp: { title: push.title, body: push.body, targetType: "event", targetId: input.eventId },
    email: inviteAnsweredEmail(input.inviteId, input.responderName,
      eventFacts({ eventId: input.eventId, title: input.eventTitle, startTime: input.eventStartTime, endTime: input.eventEndTime })),
  };
}

export interface ChallengeReviewedInput {
  companyId: string; challengeId: string; submissionId: string; userId: string; challengeTitle: string;
  approved: boolean; notificationId: string;
}
export function challengeReviewedRequest(input: ChallengeReviewedInput): NotificationRequest {
  return {
    id: input.notificationId, kind: input.approved ? "challenge_approved" : "challenge_changes_requested", companyId: input.companyId,
    recipients: [{ uid: input.userId }],
    push: challengeReviewedPush(input.companyId, input.challengeId, input.submissionId, input.approved, input.challengeTitle),
    pushFor: (locale) => challengeReviewedPush(input.companyId, input.challengeId, input.submissionId, input.approved, input.challengeTitle, locale),
    email: challengeReviewedEmail(input.challengeId, input.challengeTitle, input.approved, input.notificationId),
  };
}

export function weeklyThemeRequest(theme: WeeklyTheme, uids: readonly string[]): NotificationRequest {
  return {
    id: `weekly_theme_${theme.companyId}_${theme.challengeId}`, kind: "weekly_theme", companyId: theme.companyId,
    recipients: uids.map((uid) => ({ uid })),
    push: weeklyThemePush(theme.companyId, theme.challengeId, theme.title, theme.endDate),
    pushFor: (locale) => weeklyThemePush(theme.companyId, theme.challengeId, theme.title, theme.endDate, locale),
  };
}

export type Deliver = (request: NotificationRequest) => Promise<unknown>;

/**
 * Post-commit, best-effort pushes for the commands that own the triggers. Every method swallows failures
 * (the business command has already committed) and reports only a reason code through `onFailure`.
 */
/** A code or error class name only: messages can echo user text or tokens, so they are never logged. */
function reasonOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" || typeof code === "number") return String(code).slice(0, 60);
  return error instanceof Error ? error.name : "UNKNOWN";
}

export class RoutedPushNotifier {
  constructor(private readonly deliver: Deliver, private readonly onFailure: (kind: string, reason: string) => void = () => undefined) {}

  private async send(kind: string, request: () => NotificationRequest): Promise<void> {
    try {
      await this.deliver(request());
    } catch (error) {
      try { this.onFailure(kind, reasonOf(error)); } catch { /* logging must not throw */ }
    }
  }

  attendeeAdded(input: AttendeeAddedInput): Promise<void> {
    return this.send("attendee_added", () => attendeeAddedRequest(input));
  }

  accepted(input: InviteAcceptedInput): Promise<void> {
    return this.send("invite_answered", () => inviteAnsweredRequest(input));
  }

  approved(input: Omit<ChallengeReviewedInput, "approved">): Promise<void> {
    return this.send("challenge_approved", () => challengeReviewedRequest({ ...input, approved: true }));
  }

  changesRequested(input: Omit<ChallengeReviewedInput, "approved">): Promise<void> {
    return this.send("challenge_changes_requested", () => challengeReviewedRequest({ ...input, approved: false }));
  }
}

/** Themes whose window opened within the last `lookbackMs` (default 24 h); the scheduler runs Monday morning. */
export const WEEKLY_THEME_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const MEMBER_PAGE = 300;
const MAX_MEMBER_PAGES = 100;

export function themesStartedWithin(themes: readonly WeeklyTheme[], now: Date, lookbackMs = WEEKLY_THEME_LOOKBACK_MS): WeeklyTheme[] {
  const from = now.getTime() - lookbackMs;
  return themes.filter((theme) => theme.startDate.getTime() > from && theme.startDate.getTime() <= now.getTime()
    && theme.endDate.getTime() > now.getTime() && theme.title.trim().length > 0);
}

export interface WeeklyThemeDeps { themes: WeeklyThemeReader; members: MemberPager; deliver: Deliver; now: () => Date }
export interface WeeklyThemeStats { themes: number; delivered: number; failed: number }

/**
 * Delivers the `weekly_theme` push to every active member of each started theme's company, one router request per
 * page of members (id `weekly_theme_{companyId}_{challengeId}`, later pages suffixed `_p{n}`) so memory stays bounded.
 * Receipts make a scheduler retry skip pages that already went out; a failing theme never blocks the others.
 */
export async function runWeeklyThemePushes(deps: WeeklyThemeDeps): Promise<WeeklyThemeStats> {
  const now = deps.now();
  const started = themesStartedWithin(await deps.themes.startedBetween(new Date(now.getTime() - WEEKLY_THEME_LOOKBACK_MS), now), now);
  const stats: WeeklyThemeStats = { themes: started.length, delivered: 0, failed: 0 };
  for (const theme of started) {
    try {
      let after: string | null = null;
      for (let page = 0; page < MAX_MEMBER_PAGES; page++) {
        const members = await deps.members.page(theme.companyId, after, MEMBER_PAGE);
        if (members.uids.length > 0) {
          const request = weeklyThemeRequest(theme, members.uids);
          await deps.deliver(page === 0 ? request : { ...request, id: `${request.id}_p${page}` });
        }
        after = members.last;
        if (after === null) break;
      }
      stats.delivered++;
    } catch {
      stats.failed++;
    }
  }
  return stats;
}
