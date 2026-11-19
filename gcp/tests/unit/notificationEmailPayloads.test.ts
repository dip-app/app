import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import {
  attendeeAddedEmail, challengeReviewedEmail, changedFieldsOf, eventFacts, firstNameOf, inviteAnsweredEmail, inviteReceivedEmail,
} from "../../functions/src/modules/notifications/application/emailPayload";
import { onChatMessageCreatedViaRouter, onEventDocumentUpdatedViaRouter, sendDueRemindersViaRouter } from "../../functions/src/modules/notifications/application/handlers";
import {
  attendeeAddedRequest, challengeReviewedRequest, inviteAnsweredRequest, weeklyThemeRequest,
} from "../../functions/src/modules/notifications/application/newTriggers";
import type { DeviceToken, EventSummary, MessagingPort, SendResult } from "../../functions/src/modules/notifications/application/ports";
import type { EmailChannelPort, NotificationRequest, RouterDependencies } from "../../functions/src/modules/notifications/application/router";
import { deliverNotification } from "../../functions/src/modules/notifications/application/router";
import { routerEmailChannel } from "../../functions/src/modules/email/application/routerChannel";
import { TEMPLATE_CATEGORY, isTemplateId } from "../../functions/src/modules/email/domain/templates/types";
import { renderEmail, validateVariables } from "../../functions/src/modules/email/domain/templates/render";
import { NOTIFICATION_KINDS } from "../../functions/src/modules/notifications/domain/categories";

const HOUR = 3_600_000;
const NOW = new Date("2030-01-01T12:00:00Z");
const C = "alpha";
const E = "event";
const START = new Date(NOW.getTime() + 30 * 60_000);
const END = new Date(NOW.getTime() + 2 * HOUR);

/** The payload must pass the email module's real strict allow-list and match the notification kind's category. */
function assertValidEmail(request: NotificationRequest, template: string) {
  const email = request.email;
  assert.ok(email, "email payload present");
  assert.equal(email.template, template);
  assert.ok(isTemplateId(email.template));
  assert.equal(TEMPLATE_CATEGORY[email.template], NOTIFICATION_KINDS[request.kind].category);
  assert.ok(validateVariables(email.template, email.variables), `variables pass the allow-list: ${JSON.stringify(email.variables)}`);
  assert.doesNotMatch(JSON.stringify(email.variables), /@|token/i);
}

class Fixture {
  emailCalls: { request: NotificationRequest; uid: string; pushWillDeliver: boolean }[] = [];
  events = new Map<string, EventSummary>();
  logs: unknown[] = [];
  subs = new Map<string, "all" | "changes" | "reminders">();
  email: EmailChannelPort = {
    deliver: async (request, recipient, pushWillDeliver) => { this.emailCalls.push({ request, uid: recipient.uid, pushWillDeliver }); return true; },
  };
  messaging: MessagingPort = { sendMulticast: async (tokens): Promise<SendResult[]> => tokens.map(() => ({ success: true })) };
  receipts = new Set<string>();

  deps() {
    const router: RouterDependencies = {
      messaging: this.messaging,
      devices: { tokensFor: async (uids) => uids.map((uid): DeviceToken => ({ uid, tokenHash: `h-${uid}`, token: `tok-${uid}` })), remove: async () => undefined },
      preferences: { preferencesFor: async () => new Map() },
      receipts: { claim: async (id) => { if (this.receipts.has(id)) return false; this.receipts.add(id); return true; }, complete: async () => undefined, isDone: async (id) => this.receipts.has(id) },
      rateLimiter: { admit: async (uids) => new Set(uids) },
      inbox: { createMany: async (items) => items.length },
      email: this.email,
      clock: { now: () => NOW },
    };
    const levels = (wanted: readonly string[]) => [...this.subs].filter(([, level]) => wanted.includes(level)).map(([uid, level]) => ({ uid, level }));
    return {
      ...router,
      recipients: {
        subscribers: async () => [], subscribersWithLevels: async (_c: string, _e: string, wanted: readonly string[]) => levels(wanted),
        going: async (_c: string, _e: string, uids: readonly string[]) => new Set(uids),
      },
      events: { get: async (c: string, e: string) => this.events.get(`${c}/${e}`) ?? null },
      upcoming: { scheduledStartingIn: async (from: Date, to: Date) => [...this.events.values()].filter((e) => e.startTime > from && e.startTime <= to) },
      changeLog: { append: async () => { this.logs.push(1); return true; } },
    };
  }
}

const base = {
  title: "Sunset run", description: "", tagIds: [], coverImageURL: "c", startTime: new Date(NOW.getTime() + 5 * HOUR), endTime: new Date(NOW.getTime() + 6 * HOUR),
  venue: { name: "Park", address: "1 Main St", locality: "P", latitude: 1, longitude: 1 }, costCents: 0, costNote: "", capacity: 10, isOutdoor: true,
  status: "scheduled", attendeeCount: 3, revision: 4, createdBy: "org",
};

describe("email payloads from router-mode handlers", () => {
  test("event change carries event_changed with revision id, venue name only and mapped fields", async () => {
    const f = new Fixture();
    f.subs.set("fan", "changes");
    await onEventDocumentUpdatedViaRouter(f.deps(), C, E, base, { ...base, title: "Sunrise run", revision: 5, updatedBy: "editor" }, NOW);
    assert.equal(f.emailCalls.length, 1);
    const { request, uid, pushWillDeliver } = f.emailCalls[0]!;
    assert.equal(uid, "fan");
    assert.equal(pushWillDeliver, true);
    assertValidEmail(request, "event_changed");
    assert.equal(request.email!.objectId, E);
    assert.equal(request.email!.revisionOrWindow, "5");
    assert.deepEqual(request.email!.variables, {
      eventId: E, eventTitle: "Sunrise run", startTime: base.startTime.toISOString(), endTime: base.endTime.toISOString(),
      venueName: "Park", venueAddress: "1 Main St, P", revision: 5, changedFields: ["title"], previous: { eventTitle: "Sunset run" },
    });
  });

  describe("event_changed previous values", () => {
    async function change(patch: Record<string, unknown>) {
      const f = new Fixture();
      f.subs.set("fan", "changes");
      await onEventDocumentUpdatedViaRouter(f.deps(), C, E, base, { ...base, ...patch, revision: 5, updatedBy: "editor" }, NOW);
      return f.emailCalls[0]?.request;
    }
    const vars = (r: NotificationRequest | undefined) => r!.email!.variables as Record<string, unknown>;
    const hour = (n: number) => new Date(base.startTime.getTime() + n * HOUR);

    test("time-only change carries old start and end only for what moved", async () => {
      const r = await change({ startTime: hour(1) });
      assert.deepEqual(vars(r).previous, { startTime: base.startTime.toISOString() });
      assertValidEmail(r!, "event_changed");
    });

    test("date change carries both old times", async () => {
      const day = 24 * HOUR;
      const r = await change({ startTime: hour(24), endTime: new Date(base.endTime.getTime() + day) });
      assert.deepEqual(vars(r).previous, { startTime: base.startTime.toISOString(), endTime: base.endTime.toISOString() });
      assertValidEmail(r!, "event_changed");
    });

    test("venue name, address and title changes", async () => {
      const name = await change({ venue: { ...base.venue, name: "Beach" } });
      assert.deepEqual(vars(name).previous, { venueName: "Park" });
      assertValidEmail(name!, "event_changed");
      const addr = await change({ venue: { ...base.venue, address: "2 Side St" } });
      assert.deepEqual(vars(addr).previous, { venueAddress: "1 Main St, P" });
      assert.equal(vars(addr).venueAddress, "2 Side St, P");
      assertValidEmail(addr!, "event_changed");
      const loc = await change({ venue: { ...base.venue, locality: "Q" } });
      assert.deepEqual(vars(loc).previous, { venueAddress: "1 Main St, P" });
      const title = await change({ title: "Renamed" });
      assert.deepEqual(vars(title).previous, { eventTitle: "Sunset run" });
      assertValidEmail(title!, "event_changed");
    });

    test("a change with nothing visible in the email yields no email", async () => {
      assert.equal(await change({ capacity: 20 }), undefined);
      assert.equal(await change({ description: "More details" }), undefined);
    });

    test("a cancellation is unaffected and has no previous", async () => {
      const r = await change({ status: "cancelled" });
      assertValidEmail(r!, "event_canceled");
      assert.equal("previous" in vars(r), false);
    });
  });

  test("a cancellation carries event_canceled", async () => {
    const f = new Fixture();
    f.subs.set("fan", "changes");
    await onEventDocumentUpdatedViaRouter(f.deps(), C, E, base, { ...base, status: "cancelled", revision: 5, updatedBy: "editor" }, NOW);
    assertValidEmail(f.emailCalls[0]!.request, "event_canceled");
    assert.equal(f.emailCalls[0]!.request.email!.revisionOrWindow, "5");
  });

  test("reminders carry event_reminder with window_startMs and notAfter = event start", async () => {
    const f = new Fixture();
    f.subs.set("a", "reminders");
    f.events.set(`${C}/${E}`, { companyId: C, eventId: E, title: "Sunset run", status: "scheduled", startTime: START, endTime: END });
    await sendDueRemindersViaRouter(f.deps());
    assert.equal(f.emailCalls.length, 1);
    const { request } = f.emailCalls[0]!;
    assertValidEmail(request, "event_reminder");
    assert.equal(request.email!.objectId, E);
    assert.equal(request.email!.revisionOrWindow, `1h_${START.getTime()}`);
    assert.equal(request.email!.notAfter?.getTime(), START.getTime());
    assert.equal((request.email!.variables as { window: string }).window, "1h");
  });

  test("reminders carry the venue name and address for the Where row, and the email still opens the event", async () => {
    const f = new Fixture();
    f.subs.set("a", "reminders");
    f.events.set(`${C}/${E}`, {
      companyId: C, eventId: E, title: "Sunset run", status: "scheduled", startTime: START, endTime: END,
      venueName: "Frick Park", venueAddress: "Hot Metal St, Pittsburgh, PA",
    });
    await sendDueRemindersViaRouter(f.deps());
    const { request } = f.emailCalls[0]!;
    assertValidEmail(request, "event_reminder");
    const variables = request.email!.variables as Record<string, unknown>;
    assert.equal(variables.venueName, "Frick Park");
    assert.equal(variables.venueAddress, "Hot Metal St, Pittsburgh, PA");
    const rendered = renderEmail("event_reminder", validateVariables("event_reminder", variables)!, { recipientFirstName: "Sam", timeZone: "UTC", unsubscribeURL: "https://letsdip.work/u/t" });
    assert.ok(rendered.text.includes("Where: Frick Park") && rendered.text.includes("Hot Metal St, Pittsburgh, PA"));
    assert.ok(rendered.text.includes(`Open in DIP: https://letsdip.work/e/${E}`));
  });

  test("reminders without a venue still email (no Where row)", async () => {
    const f = new Fixture();
    f.subs.set("a", "reminders");
    f.events.set(`${C}/${E}`, { companyId: C, eventId: E, title: "Sunset run", status: "scheduled", startTime: START, endTime: END });
    await sendDueRemindersViaRouter(f.deps());
    const variables = f.emailCalls[0]!.request.email!.variables as Record<string, unknown>;
    assert.equal("venueName" in variables || "venueAddress" in variables, false);
  });

  test("chat never carries an email payload and the email port is not called", async () => {
    const f = new Fixture();
    f.subs.set("fan", "all");
    f.events.set(`${C}/${E}`, { companyId: C, eventId: E, title: "Sunset run", status: "scheduled", startTime: START, endTime: END });
    await onChatMessageCreatedViaRouter(f.deps(), C, E, "m1", { authorId: "x", authorName: "X", text: "hello a@b.co" });
    assert.equal(f.emailCalls.length, 0);
  });
});

describe("email payloads from the always-routed triggers", () => {
  test("attendee added", () => {
    const request = attendeeAddedRequest({ companyId: C, eventId: E, eventTitle: "Sunset run", userId: "u", notificationId: "admin_r1", eventStartTime: START, eventEndTime: END });
    assertValidEmail(request, "attendee_added");
    assert.equal(request.email!.objectId, E);
    assert.equal(request.email!.revisionOrWindow, "admin_r1");
  });

  test("attendee added without event times requests no email", () => {
    assert.equal(attendeeAddedRequest({ companyId: C, eventId: E, eventTitle: "Sunset run", userId: "u", notificationId: "admin_r1" }).email, undefined);
  });

  test("invite answered uses the invitee first name and the invite id", () => {
    const request = inviteAnsweredRequest({
      companyId: C, eventId: E, eventTitle: "Pasta Night", inviteId: "inv1", senderId: "s", responderName: "Fran Friend", eventStartTime: START, eventEndTime: END,
    });
    assertValidEmail(request, "invite_answered");
    assert.equal((request.email!.variables as { inviteeFirstName: string }).inviteeFirstName, "Fran");
    assert.equal(request.email!.objectId, "inv1");
    assert.equal(request.email!.revisionOrWindow, "accepted");
  });

  test("challenge reviewed maps the outcome from the kind", () => {
    const input = { companyId: C, challengeId: "ch1", submissionId: "s1", userId: "u", challengeTitle: "Walk 5k", notificationId: "challenge_approved_ch1" };
    const approved = challengeReviewedRequest({ ...input, approved: true });
    assertValidEmail(approved, "challenge_reviewed");
    assert.equal((approved.email!.variables as { outcome: string }).outcome, "approved");
    assert.equal(approved.email!.revisionOrWindow, "challenge_approved_ch1");
    const changes = challengeReviewedRequest({ ...input, approved: false, notificationId: "challenge_changes_ch1_2" });
    assert.equal((changes.email!.variables as { outcome: string }).outcome, "changes_requested");
    assert.equal(changes.email!.objectId, "ch1");
  });

  test("weekly theme has no template and requests no email", () => {
    const theme = { companyId: C, challengeId: "ch1", title: "Theme", startDate: NOW, endDate: END };
    assert.equal(weeklyThemeRequest(theme, ["a"]).email, undefined);
  });

  test("invite received payload (used by the invite notifier)", () => {
    const facts = eventFacts({ eventId: E, title: "Pasta Night", startTime: START, endTime: END });
    const email = inviteReceivedEmail("inv1", "Sam Sender", facts)!;
    assert.deepEqual([email.template, email.objectId, email.revisionOrWindow], ["invite_received", "inv1", "invite"]);
    assert.ok(validateVariables("invite_received", email.variables));
    assert.equal(inviteReceivedEmail("inv1", "  ", facts), undefined);
    assert.equal(inviteReceivedEmail("inv1", "Sam", null), undefined);
  });
});

describe("helpers", () => {
  test("eventFacts requires title and both times; first names; changed fields", () => {
    assert.equal(eventFacts({ eventId: E, title: "", startTime: START, endTime: END }), null);
    assert.equal(eventFacts({ eventId: E, title: "T", startTime: START, endTime: undefined }), null);
    assert.equal(firstNameOf("  Ada   Lovelace "), "Ada");
    assert.equal(firstNameOf(" "), null);
    assert.deepEqual(changedFieldsOf(["startTime", "endTime", "venue.name", "capacity", "title"]), ["time", "venue", "details", "title"]);
    assert.equal(attendeeAddedEmail(E, "n", null), undefined);
    assert.equal(inviteAnsweredEmail("i", "", eventFacts({ eventId: E, title: "T", startTime: START, endTime: END })), undefined);
    assert.equal(challengeReviewedEmail("c", " ", true, "n"), undefined);
  });
});

describe("router with the real email channel adapter", () => {
  test("the adapter accepts these payloads and enqueues via the port; a mismatched category is skipped", async () => {
    const enqueued: unknown[] = [];
    const channel = routerEmailChannel({
      outbox: { create: async (doc: unknown) => { enqueued.push(doc); return true; } },
      companies: { get: async () => ({ enabled: true }) },
      preferences: { getEmailMap: async () => null },
      clock: { now: () => NOW },
      validate: validateVariables,
      config: { enabled: true },
    } as never);
    const f = new Fixture();
    f.email = channel;
    f.subs.set("fan", "changes");
    const stats = await onEventDocumentUpdatedViaRouter(f.deps(), C, E, base, { ...base, title: "Sunrise run", revision: 5, updatedBy: "editor" }, NOW);
    assert.equal(stats.push.emailsEnqueued, 1);
    assert.equal(enqueued.length, 1);
    // A reminder-category payload on a change notification is ignored by the adapter.
    const request = attendeeAddedRequest({ companyId: C, eventId: E, eventTitle: "T", userId: "u", notificationId: "n", eventStartTime: START, eventEndTime: END });
    const wrong: NotificationRequest = { ...request, email: { ...request.email!, template: "event_reminder" } };
    assert.equal(await channel.deliver(wrong, { uid: "u" }, true), false);
    // The router also tolerates an absent email dependency.
    const deps = f.deps();
    delete (deps as { email?: unknown }).email;
    assert.equal((await deliverNotification(deps, { ...request, id: "x1" })).emailsEnqueued, 0);
  });
});
