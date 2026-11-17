import type { RenderContext, TemplateId, TemplateVariables } from "../domain/templates/types";

/** Sample data shared by the preview script and the golden snapshot tests. */
export interface PreviewCase<T extends TemplateId = TemplateId> {
  name: string;
  template: T;
  variables: TemplateVariables[T];
  ctx: RenderContext;
}

export const SAMPLE_CTX: RenderContext = {
  recipientFirstName: "Sam",
  timeZone: "America/New_York",
  unsubscribeURL: "https://letsdip.work/u/sample-token",
  postalAddress: "123 Example Street, Pittsburgh, PA 15213 (placeholder)",
};

const EVENT = {
  eventId: "evt_sunset_hike",
  eventTitle: "Sunset hike at Frick Park",
  startTime: "2026-11-20T23:30:00Z",
  endTime: "2026-11-21T01:00:00Z",
  venueName: "Frick Park, Hot Metal Street entrance",
  coverImageURL: "catalog://default/hiking",
};

function make<T extends TemplateId>(name: string, template: T, variables: TemplateVariables[T], ctx: RenderContext = SAMPLE_CTX): PreviewCase {
  return { name, template, variables, ctx } as PreviewCase;
}

export const PREVIEW_CASES: PreviewCase[] = [
  make("invite_received", "invite_received", { ...EVENT, inviterFirstName: "Priya" }),
  make("invite_answered_accepted", "invite_answered", { ...EVENT, inviteeFirstName: "Jordan", answer: "accepted" }),
  make("invite_answered_declined", "invite_answered", { ...EVENT, inviteeFirstName: "Jordan", answer: "declined" }),
  make("event_changed", "event_changed", { ...EVENT, changedFields: ["time", "venue"] }),
  make("event_canceled", "event_canceled", EVENT),
  make("attendee_added", "attendee_added", EVENT),
  make("event_reminder_24h", "event_reminder", { ...EVENT, window: "24h" }),
  make("event_reminder_1h", "event_reminder", { ...EVENT, window: "1h" }),
  make("challenge_approved", "challenge_reviewed", {
    challengeId: "chal_step_week",
    challengeTitle: "10,000 steps for a week",
    outcome: "approved",
    points: 50,
  }),
  make("challenge_changes_requested", "challenge_reviewed", {
    challengeId: "chal_step_week",
    challengeTitle: "10,000 steps for a week",
    outcome: "changes_requested",
  }),
  make(
    "long_title",
    "invite_received",
    {
      eventId: "evt_long",
      eventTitle:
        "Quarterly cross-functional offsite planning session with lunch, lightning talks, team games, and a very long closing retrospective for everyone",
      startTime: "2026-11-20T15:00:00Z",
      endTime: "2026-11-20T21:00:00Z",
      inviterFirstName: "Alexandria",
    },
  ),
  make("emoji_title", "attendee_added", {
    eventId: "evt_emoji",
    eventTitle: "Pizza and board games \u{1F355}\u{1F3B2}",
    startTime: "2026-11-21T00:00:00Z",
    endTime: "2026-11-21T02:00:00Z",
    venueName: "Break room",
  }),
  make("rtl_title_arabic", "event_reminder", {
    eventId: "evt_ar",
    eventTitle: "اجتماع الفريق الأسبوعي",
    startTime: "2026-11-20T14:00:00Z",
    endTime: "2026-11-20T15:00:00Z",
    window: "24h",
  }),
  make("rtl_title_hebrew", "event_changed", {
    eventId: "evt_he",
    eventTitle: "ארוחת צהריים של הצוות",
    startTime: "2026-11-20T17:00:00Z",
    endTime: "2026-11-20T18:00:00Z",
    changedFields: ["time"],
  }),
  make("invite_received_with_pixel", "invite_received", { ...EVENT, inviterFirstName: "Priya" }, { ...SAMPLE_CTX, openPixelURL: "https://letsdip.work/o/sample-token.gif" }),
];
