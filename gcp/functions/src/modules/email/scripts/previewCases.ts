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
};

const EVENT = {
  eventId: "evt_sunset_hike",
  eventTitle: "Sunset hike at Frick Park",
  startTime: "2026-11-20T23:30:00Z",
  endTime: "2026-11-21T01:00:00Z",
  venueName: "Frick Park, Hot Metal Street entrance",
  venueAddress: "Hot Metal St, Pittsburgh, PA",
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
  make("calendar_invite_joined", "calendar_invite", { ...EVENT, sequence: 0, reason: "joined" }),
  make("calendar_invite_updated", "calendar_invite", { ...EVENT, sequence: 2, reason: "updated" }),
  make("calendar_cancel_left", "calendar_cancel", { ...EVENT, sequence: 3, reason: "left" }),
  make("calendar_cancel_canceled", "calendar_cancel", { ...EVENT, sequence: 3, reason: "canceled" }),
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
  make("event_changed_time", "event_changed", {
    ...EVENT,
    changedFields: ["time"],
    previous: { startTime: "2026-11-20T22:30:00Z", endTime: "2026-11-21T00:00:00Z" },
  }),
  make("event_changed_date", "event_changed", {
    ...EVENT,
    changedFields: ["time"],
    previous: { startTime: "2026-11-19T23:30:00Z", endTime: "2026-11-20T01:00:00Z" },
  }),
  make("event_changed_venue", "event_changed", {
    ...EVENT,
    changedFields: ["venue"],
    previous: { venueName: "Schenley Park, Bartlett Street entrance" },
  }),
  make("event_changed_address", "event_changed", {
    ...EVENT,
    changedFields: ["venue"],
    previous: { venueAddress: "Beechwood Blvd, Pittsburgh, PA" },
  }),
  make("event_changed_both", "event_changed", {
    ...EVENT,
    changedFields: ["time", "venue"],
    previous: {
      startTime: "2026-11-20T22:30:00Z",
      endTime: "2026-11-21T00:00:00Z",
      venueName: "Schenley Park, Bartlett Street entrance",
      venueAddress: "Bartlett St, Pittsburgh, PA",
    },
  }),
  make("event_changed_title", "event_changed", {
    ...EVENT,
    changedFields: ["title"],
    previous: { eventTitle: "Evening walk at Frick Park" },
  }),
  make("invite_received_with_pixel", "invite_received", { ...EVENT, inviterFirstName: "Priya" }, { ...SAMPLE_CTX, openPixelURL: "https://letsdip.work/o/sample-token.gif" }),
];

const TOKEN = "eyJ2IjoxLCJjIjoiYWNtZSIsInciOiIyMDI2LVc0OSIsImkiOiJzdW5zZXQtaGlrZSIsImUiOjE3OTY4NDAwMDB9.c2lnbmF0dXJl";
const link = (n: number): string => `https://letsdip.work/admin/ideas/suggested/?t=${TOKEN}${n}`;
const LONG = (len: number, seed: string): string => {
  let out = "";
  while (out.length < len) out += `${seed} `;
  return out.slice(0, len).trimEnd();
};

const SUGGESTIONS_RICH = {
  weekKey: "2026-W49",
  weekLabel: "Week of Nov 30",
  dataNote: null,
  ideas: [
    {
      ideaId: "winter-trail-walk", title: "Winter trail walk and cocoa", theme: "outdoors" as const, fitLabel: "perfect" as const,
      pitch: "A relaxed loop through the park with a hot drink at the halfway point.",
      reasons: ["Your last outdoor event, \u201CSunset hike\u201D, filled 24 of 30 spots", "Outdoors is one of your top interests, 20+ members"],
      facts: "90 min \u00B7 8 to 30 people \u00B7 Under $10 per person", whenHint: "Works well on a Thursday afternoon", linkURL: link(1),
    },
    {
      ideaId: "lunch-and-learn-music", title: "Lunch and listen: team playlist", theme: "music" as const, fitLabel: "great" as const,
      pitch: "Everyone adds a song and shares the story behind it over lunch.",
      reasons: ["3 more teammates picked Music this month"],
      facts: "60 min \u00B7 6 to 40 people \u00B7 Free", whenHint: null, linkURL: link(2),
    },
    {
      ideaId: "board-game-tournament", title: "Board game tournament", theme: "games" as const, fitLabel: null,
      pitch: "Small tables, short rounds, and a friendly trophy for the winners.",
      reasons: ["No games events in the last 8 weeks"],
      facts: "2 hours \u00B7 8 to 24 people \u00B7 Under $15 per person", whenHint: "The week of Nov 30 is quiet on your calendar", linkURL: link(3),
    },
    {
      ideaId: "cookie-swap", title: "Holiday cookie swap", theme: "food" as const, fitLabel: "good" as const,
      pitch: "Bring a dozen, leave with a mixed box and a few new recipes.",
      reasons: [],
      facts: "60 min \u00B7 10 to 50 people \u00B7 Under $15 per person", whenHint: null, linkURL: link(4),
    },
  ],
};

PREVIEW_CASES.push(
  make("admin_suggestions", "admin_suggestions", SUGGESTIONS_RICH),
  make("admin_suggestions_no_data", "admin_suggestions", {
    weekKey: "2026-W49",
    weekLabel: "Week of Nov 30",
    dataNote: "We don't have much activity from your team yet, so these come from our catalog of crowd favorites.",
    ideas: SUGGESTIONS_RICH.ideas.slice(0, 3).map((i) => ({ ...i, fitLabel: null, reasons: [], whenHint: null })),
  }),
  make("admin_suggestions_long", "admin_suggestions", {
    weekKey: "2026-W50",
    weekLabel: "Week of Dec 7, 2026 (holiday)",
    dataNote: LONG(200, "Your calendar is busy this fortnight"),
    ideas: (["fitness", "arts", "learning", "volunteering", "wellness"] as const).map((theme, n) => ({
      ideaId: `long-idea-${n}`, theme, fitLabel: (["perfect", "great", "good", null, "good"] as const)[n]!,
      title: LONG(80, `Extra long idea title ${n}`), pitch: LONG(160, "A pitch that runs all the way to the limit"),
      reasons: [LONG(120, "A reason that fills the whole line"), LONG(120, "Another reason that fills the line")],
      facts: LONG(120, "90 min \u00B7 8 to 20 people"), whenHint: LONG(80, "Best on a quiet afternoon"), linkURL: link(n),
    })),
  }, { ...SAMPLE_CTX, recipientFirstName: null }),
);
