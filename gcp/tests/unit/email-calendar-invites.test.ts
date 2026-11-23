import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { onEventUpdatedForInvites, onRsvpForInvite, type CalendarInviteDeps } from "../../functions/src/modules/email/application/calendarInvites";
import type {
  ClaimResult, EmailProviderPort, InviteEventState, InviteEvent, InviteIntent, NewOutboxEntry, OutboxStore, OutgoingEmail, Recipient,
  SendOutcome,
} from "../../functions/src/modules/email/application/ports";
import { sendOutboxEmail, type EmailRenderer, type SendDeps } from "../../functions/src/modules/email/application/sendOutboxEmail";
import { buildInviteIcs, foldLine, icsAttachmentFor, inviteContentType, inviteUid, type InviteContext } from "../../functions/src/modules/email/domain/ics";
import { categoryOf, type OutboxDocument } from "../../functions/src/modules/email/domain/outbox";
import { renderEmail, validateVariables } from "../../functions/src/modules/email/domain/templates/render";
import { PostmarkProvider } from "../../functions/src/modules/email/infrastructure/postmarkProvider";
import { ResendProvider } from "../../functions/src/modules/email/infrastructure/resendProvider";

const NOW = new Date("2030-01-01T12:00:00Z");
const KEY = "0123456789abcdef0123456789abcdef0123456789abcdef";
const unfold = (ics: string): string[] => ics.replace(/\r\n[ \t]/g, "").split("\r\n").filter(Boolean);

const FACTS = {
  eventId: "evt_1", eventTitle: "Sunset hike", startTime: "2030-01-05T23:30:00Z", endTime: "2030-01-06T01:00:00Z",
  venueName: "Frick Park", venueAddress: "Hot Metal St, Pittsburgh, PA", sequence: 0,
};
const CTX: InviteContext = { attendeeEmail: "jane@example.com", attendeeName: "Jane Doe", memberUid: "u1", now: NOW };

describe("invite ics", () => {
  test("REQUEST golden lines", () => {
    const ics = buildInviteIcs("REQUEST", FACTS, CTX);
    assert.ok(ics.endsWith("\r\n"));
    assert.ok(!/[^\r]\n/.test(ics), "bare LF");
    const lines = unfold(ics);
    assert.deepEqual(lines, [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//DIP//letsdip.work//EN", "CALSCALE:GREGORIAN", "METHOD:REQUEST",
      "BEGIN:VEVENT",
      `UID:${inviteUid("evt_1", "u1")}`,
      "SEQUENCE:0", "DTSTAMP:20300101T120000Z", "DTSTART:20300105T233000Z", "DTEND:20300106T010000Z",
      "SUMMARY:Sunset hike",
      "LOCATION:Frick Park\\, Hot Metal St\\, Pittsburgh\\, PA",
      "DESCRIPTION:Open in DIP: https://letsdip.work/e/evt_1",
      "URL:https://letsdip.work/e/evt_1",
      'ORGANIZER;CN="DIP Events":mailto:events@letsdip.work',
      'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE;CN="Jane Doe":mailto:jane@example.com',
      "STATUS:CONFIRMED", "TRANSP:OPAQUE",
      "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Sunset hike starts soon", "TRIGGER:-PT30M", "END:VALARM",
      "END:VEVENT", "END:VCALENDAR",
    ]);
  });

  test("CANCEL: same UID, higher SEQUENCE, STATUS:CANCELLED, no alarm", () => {
    const request = unfold(buildInviteIcs("REQUEST", FACTS, CTX));
    const cancel = unfold(buildInviteIcs("CANCEL", { ...FACTS, sequence: 1 }, CTX));
    assert.ok(cancel.includes("METHOD:CANCEL"));
    assert.ok(cancel.includes("STATUS:CANCELLED"));
    assert.ok(cancel.includes("SEQUENCE:1"));
    assert.ok(!cancel.includes("BEGIN:VALARM"));
    assert.equal(cancel.find((l) => l.startsWith("UID:")), request.find((l) => l.startsWith("UID:")));
  });

  test("UID is stable per (event, member), differs across members and events, and hides the member id", () => {
    assert.equal(inviteUid("evt_1", "u1"), inviteUid("evt_1", "u1"));
    assert.notEqual(inviteUid("evt_1", "u1"), inviteUid("evt_1", "u2"));
    assert.notEqual(inviteUid("evt_1", "u1"), inviteUid("evt_2", "u1"));
    assert.ok(!inviteUid("evt_1", "u1").includes("u1@"));
    assert.match(inviteUid("evt_1", "u1"), /^dip-evt_1-[0-9a-f]{16}@letsdip\.work$/);
  });

  test("an update changes SEQUENCE and times but keeps the UID", () => {
    const a = unfold(buildInviteIcs("REQUEST", FACTS, CTX));
    const b = unfold(buildInviteIcs("REQUEST", { ...FACTS, sequence: 2, startTime: "2030-01-06T00:30:00Z", venueName: "Schenley Park" }, { ...CTX, now: new Date("2030-01-02T00:00:00Z") }));
    const get = (l: string[], p: string) => l.find((x) => x.startsWith(p));
    assert.equal(get(a, "UID:"), get(b, "UID:"));
    assert.equal(get(b, "SEQUENCE:"), "SEQUENCE:2");
    assert.equal(get(b, "DTSTART:"), "DTSTART:20300106T003000Z");
    assert.ok(get(b, "LOCATION:")!.includes("Schenley Park"));
  });

  test("escaping and 75 octet folding of long, non-ASCII, comma and semicolon titles", () => {
    const title = `Café, taïko; "drums" \\ ${"\u{1F941}éè ".repeat(30)}`;
    const ics = buildInviteIcs("REQUEST", { ...FACTS, eventTitle: title, venueName: "Room 4; level 2, east" }, { ...CTX, attendeeName: 'Jan "JJ" van\r\nder Berg' });
    for (const physical of ics.split("\r\n")) assert.ok(Buffer.byteLength(physical, "utf8") <= 75, physical);
    assert.ok(ics.includes("\r\n "), "expected folding");
    const lines = unfold(ics);
    const summary = lines.find((l) => l.startsWith("SUMMARY:"))!;
    assert.ok(summary.startsWith("SUMMARY:Café\\, taïko\\; \"drums\" \\\\ "));
    assert.ok(lines.find((l) => l.startsWith("LOCATION:"))!.startsWith("LOCATION:Room 4\\; level 2\\, east"));
    // Folding never splits a code point.
    assert.ok(!ics.includes("�"));
    // The CN parameter is quoted and cannot carry quotes or line breaks.
    const attendee = lines.find((l) => l.startsWith("ATTENDEE"))!;
    assert.ok(attendee.includes('CN="Jan JJ van der Berg"'));
    assert.equal(foldLine("x".repeat(75)).includes("\r\n"), false);
  });

  test("time zones and DST: instants are UTC, so a wall-clock shift across DST changes the UTC value, not the entry", () => {
    // 18:00 New York is 23:00Z in winter and 22:00Z after the March 2030 change; both are emitted as UTC instants.
    const winter = unfold(buildInviteIcs("REQUEST", { ...FACTS, startTime: "2030-03-09T23:00:00Z", endTime: "2030-03-10T00:00:00Z" }, CTX));
    const summer = unfold(buildInviteIcs("REQUEST", { ...FACTS, startTime: "2030-03-10T22:00:00Z", endTime: "2030-03-10T23:00:00Z" }, CTX));
    assert.ok(winter.includes("DTSTART:20300309T230000Z"));
    assert.ok(summer.includes("DTSTART:20300310T220000Z"));
    assert.ok(![...winter, ...summer].some((l) => l.startsWith("TZID") || l.includes("DTSTART;TZID")));
  });

  test("rejects bad times, sequences and attendee addresses", () => {
    assert.throws(() => buildInviteIcs("REQUEST", { ...FACTS, startTime: "nope" }, CTX));
    assert.throws(() => buildInviteIcs("REQUEST", { ...FACTS, sequence: -1 }, CTX));
    assert.throws(() => buildInviteIcs("REQUEST", FACTS, { ...CTX, attendeeEmail: "a@b.c\r\nBEGIN:VEVENT" }));
    assert.throws(() => buildInviteIcs("REQUEST", FACTS, { ...CTX, attendeeEmail: "no-at-sign" }));
  });

  test("icsAttachmentFor: invite.ics with method in the content type; null without a recipient context", () => {
    const vars = { ...FACTS, reason: "joined" as const };
    const att = icsAttachmentFor("calendar_invite", vars, 0, NOW, CTX)!;
    assert.equal(att.filename, "invite.ics");
    assert.equal(att.contentType, "text/calendar; charset=UTF-8; method=REQUEST");
    assert.ok(att.content.includes("METHOD:REQUEST"));
    const cancel = icsAttachmentFor("calendar_cancel", { ...FACTS, reason: "left" as const, sequence: 1 }, 0, NOW, CTX)!;
    assert.equal(cancel.contentType, inviteContentType("CANCEL"));
    assert.equal(icsAttachmentFor("calendar_invite", vars, 0, NOW), null);
  });
});

describe("invite templates", () => {
  const ctx = { recipientFirstName: "Sam", timeZone: "America/New_York", unsubscribeURL: "https://letsdip.work/u/t" };
  test("validate allow-list and enums", () => {
    assert.ok(validateVariables("calendar_invite", { ...FACTS, reason: "joined" }));
    assert.equal(validateVariables("calendar_invite", { ...FACTS, reason: "left" }), null);
    assert.equal(validateVariables("calendar_cancel", { ...FACTS, reason: "joined" }), null);
    assert.equal(validateVariables("calendar_invite", { ...FACTS, reason: "joined", email: "a@b.c" }), null);
    assert.equal(validateVariables("calendar_invite", { ...FACTS, sequence: -1, reason: "joined" }), null);
    assert.equal(validateVariables("calendar_invite", { ...FACTS, sequence: 1.5, reason: "joined" }), null);
  });
  test("render: short body with title, when, where, guidance, event link, unsubscribe", () => {
    const v = validateVariables("calendar_invite", { ...FACTS, reason: "joined" })!;
    const mail = renderEmail("calendar_invite", v, ctx);
    assert.match(mail.subject, /^Calendar invite: Sunset hike/);
    for (const part of [mail.html, mail.text]) {
      assert.ok(part.includes("Sunset hike"));
      assert.ok(part.includes("Frick Park"));
      assert.ok(part.includes("https://letsdip.work/e/evt_1"));
      assert.ok(part.includes("https://letsdip.work/u/t"));
      assert.ok(part.includes("support@letsdip.work"));
    }
    assert.ok(mail.text.includes("Add to calendar"));
    assert.ok(mail.text.includes("calendar invite emails are on"));
    const cancel = renderEmail("calendar_cancel", validateVariables("calendar_cancel", { ...FACTS, reason: "canceled", sequence: 2 })!, ctx);
    assert.match(cancel.subject, /^Canceled: /);
  });
});

// ---- in-memory world for trigger and sender flows ---------------------------------------------------------------------------

class MemOutbox implements OutboxStore {
  docs = new Map<string, OutboxDocument>();
  async create(entry: NewOutboxEntry, now: Date) {
    if (this.docs.has(entry.id)) return false;
    this.docs.set(entry.id, {
      id: entry.id, uid: entry.uid, companyId: entry.companyId, category: categoryOf(entry.template, entry.variables), template: entry.template,
      variables: entry.variables, status: "queued", attempts: 0, notAfter: entry.notAfter, createdAt: now, expireAt: now, leaseUntil: null,
    });
    return true;
  }
  async claim(id: string, now: Date, leaseMs: number): Promise<ClaimResult> {
    const d = this.docs.get(id);
    if (!d) return { kind: "missing" };
    if (d.status !== "queued") return { kind: "not_queued", status: d.status };
    d.status = "sending"; d.attempts += 1; d.leaseUntil = new Date(now.getTime() + leaseMs);
    return { kind: "claimed", doc: { ...d } };
  }
  async finish(id: string, status: Exclude<OutboxDocument["status"], "sending">, fields: { reason?: string }) {
    const d = this.docs.get(id)!;
    d.status = status; d.leaseUntil = null;
    if (fields.reason) d.reason = fields.reason;
  }
  async get(id: string) { return this.docs.get(id) ?? null; }
  async recordOpen() { return false; }
}

class Provider implements EmailProviderPort {
  readonly name = "fake";
  sent: OutgoingEmail[] = [];
  outcome: SendOutcome = { kind: "sent", providerMessageId: "pm-1" };
  async send(m: OutgoingEmail) { this.sent.push(m); return this.outcome; }
}

function world() {
  const outbox = new MemOutbox();
  const provider = new Provider();
  const state = new Map<string, { sequence: number; active: boolean; delivered: boolean; lastKey?: string; lastIntent?: string; lastSequence?: number }>();
  const w = {
    outbox, provider, now: NOW,
    event: { eventId: "evt_1", title: "Sunset hike", status: "scheduled", startTime: new Date("2030-01-05T23:30:00Z"), endTime: new Date("2030-01-06T01:00:00Z"), revision: 3, venueName: "Frick Park" } as InviteEvent | null,
    going: new Set<string>(["u1"]),
    emailMap: null as Record<string, unknown> | null,
    companyEnabled: true,
    enabled: true,
    recipient: { uid: "u1", companyId: "c1", email: "jane@example.com", displayName: "Jane Doe", status: "active" } as Recipient,
    state,
  };
  const sequences = {
    assign: async (_c: string, e: string, uid: string, intent: InviteIntent, key: string) => {
      const id = `${e}|${uid}`;
      const s = state.get(id) ?? { sequence: -1, active: false, delivered: false };
      if (s.lastKey === key && s.lastIntent === intent && s.lastSequence !== undefined) return s.lastSequence;
      if ((intent === "update" || intent === "cancel") && !s.active) return null;
      const sequence = s.sequence + 1;
      state.set(id, { ...s, sequence, active: intent !== "cancel", lastKey: key, lastIntent: intent, lastSequence: sequence });
      return sequence;
    },
    isDelivered: async (_c: string, e: string, uid: string) => state.get(`${e}|${uid}`)?.delivered === true,
    setDelivered: async (_c: string, e: string, uid: string, delivered: boolean) => {
      const s = state.get(`${e}|${uid}`) ?? { sequence: -1, active: false, delivered: false };
      state.set(`${e}|${uid}`, { ...s, delivered });
    },
  };
  const eligibility = {
    state: async (_c: string, _e: string, uid: string): Promise<InviteEventState> => ({
      going: w.going.has(uid), eventStatus: w.event?.status ?? null, endTime: w.event?.endTime ?? null,
    }),
  };
  const inviteDeps = (): CalendarInviteDeps => ({
    outbox, clock: { now: () => w.now }, validate: validateVariables,
    companies: { get: async () => ({ enabled: w.companyEnabled, dailyCap: 100, timeZone: null }) },
    preferences: { getEmailMap: async () => w.emailMap, disable: async () => true },
    config: { enabled: w.enabled }, sequences,
    events: { get: async () => w.event, goingUids: async () => [...w.going] },
  });
  const renderer: EmailRenderer = {
    render: (t, v, c) => renderEmail(t, v as never, c),
    validate: validateVariables,
    attachment: (t, v, r, invite) => icsAttachmentFor(t, v, r, invite?.now ?? new Date(), invite),
  };
  const sendDeps = (): SendDeps => ({
    outbox, provider, renderer, clock: { now: () => w.now },
    recipients: { get: async () => w.recipient, uidsByEmail: async () => [] },
    companies: { get: async () => ({ enabled: w.companyEnabled, dailyCap: 100, timeZone: "America/New_York" }) },
    suppressions: { isSuppressed: async () => false, suppress: async () => undefined },
    caps: { consume: async () => "ok" },
    preferences: { getEmailMap: async () => w.emailMap, disable: async () => true },
    config: { enabled: w.enabled, unsubscribeKey: KEY, defaultTimeZone: "UTC", publicOrigin: "https://letsdip.work", openTracking: false },
    inviteSequences: sequences, inviteEligibility: eligibility, log: () => undefined,
  });
  const sendAll = async () => { for (const id of [...outbox.docs.keys()]) await sendOutboxEmail(sendDeps(), id); };
  return Object.assign(w, { inviteDeps, sendDeps, sendAll });
}

const rsvp = (over: Partial<Parameters<typeof onRsvpForInvite>[1]> = {}) => ({
  companyId: "c1", eventId: "evt_1", uid: "u1", before: null, after: "going", writeTime: new Date("2030-01-01T11:00:00Z"), ...over,
});
const icsOf = (m: OutgoingEmail) => m.attachments.find((a) => a.filename === "invite.ics")!.content;

describe("join, update and cancel flows", () => {
  test("join enqueues one invite; replay of the same write is idempotent and keeps SEQUENCE", async () => {
    const x = world();
    assert.equal(await onRsvpForInvite(x.inviteDeps(), rsvp()), "enqueued");
    assert.equal(await onRsvpForInvite(x.inviteDeps(), rsvp()), "duplicate");
    assert.equal(x.outbox.docs.size, 1);
    const doc = [...x.outbox.docs.values()][0]!;
    assert.equal(doc.template, "calendar_invite");
    assert.equal(doc.category, "calendar_invites");
    assert.equal((doc.variables as { sequence: number }).sequence, 0);
    assert.equal(doc.notAfter?.toISOString(), "2030-01-06T01:00:00.000Z");
    assert.ok(!JSON.stringify(doc).includes("example.com"), "outbox never stores the address");
  });

  test("sent email: From events@, Reply-To support@, one invite.ics with method=REQUEST, unsubscribe headers", async () => {
    const x = world();
    await onRsvpForInvite(x.inviteDeps(), rsvp());
    await x.sendAll();
    assert.equal(x.provider.sent.length, 1);
    const m = x.provider.sent[0]!;
    assert.equal(m.from, "DIP Events <events@letsdip.work>");
    assert.equal(m.replyTo, "support@letsdip.work");
    assert.equal(m.attachments.length, 1);
    assert.equal(m.attachments[0]!.contentType, "text/calendar; charset=UTF-8; method=REQUEST");
    assert.ok(unfold(icsOf(m)).includes("ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE;CN=\"Jane Doe\":mailto:jane@example.com"));
    assert.equal(m.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
    assert.equal(m.tag, "calendar_invite");
  });

  test("update re-sends REQUEST with the same UID and a higher SEQUENCE; leave sends CANCEL with SEQUENCE+1", async () => {
    const x = world();
    await onRsvpForInvite(x.inviteDeps(), rsvp());
    await x.sendAll();
    const before = { title: "Sunset hike", startTime: x.event!.startTime, endTime: x.event!.endTime, status: "scheduled", revision: 3, venue: { name: "Frick Park" } };
    const after = { ...before, startTime: new Date("2030-01-06T00:30:00Z"), endTime: new Date("2030-01-06T02:00:00Z"), revision: 4 };
    x.event = { ...x.event!, startTime: after.startTime, endTime: after.endTime, revision: 4 };
    const stats = await onEventUpdatedForInvites(x.inviteDeps(), { companyId: "c1", eventId: "evt_1", before, after, updateTime: new Date("2030-01-01T12:00:00Z") });
    assert.deepEqual(stats, { recipients: 1, enqueued: 1, skipped: 0 });
    // Replay of the same trigger: no second email.
    const again = await onEventUpdatedForInvites(x.inviteDeps(), { companyId: "c1", eventId: "evt_1", before, after, updateTime: new Date("2030-01-01T12:00:00Z") });
    assert.equal(again.enqueued, 0);
    await x.sendAll();
    x.going.delete("u1");
    assert.equal(await onRsvpForInvite(x.inviteDeps(), rsvp({ before: "going", after: "not_going", writeTime: new Date("2030-01-01T13:00:00Z") })), "enqueued");
    x.now = new Date("2030-01-01T13:00:00Z");
    await x.sendAll();
    assert.equal(x.provider.sent.length, 3);
    const [first, second, third] = x.provider.sent.map((m) => unfold(icsOf(m)));
    const uid = (l: string[]) => l.find((p) => p.startsWith("UID:"));
    assert.equal(uid(first!), uid(second!));
    assert.equal(uid(second!), uid(third!));
    assert.deepEqual([first, second, third].map((l) => l!.find((p) => p.startsWith("SEQUENCE:"))), ["SEQUENCE:0", "SEQUENCE:1", "SEQUENCE:2"]);
    assert.ok(second!.includes("DTSTART:20300106T003000Z"));
    assert.ok(third!.includes("METHOD:CANCEL") && third!.includes("STATUS:CANCELLED"));
    assert.equal(x.provider.sent[2]!.attachments[0]!.contentType, "text/calendar; charset=UTF-8; method=CANCEL");
  });

  test("event cancellation sends CANCEL to going members who hold the entry; others and later edits send nothing", async () => {
    const x = world();
    x.going = new Set(["u1", "u2"]);
    await onRsvpForInvite(x.inviteDeps(), rsvp());
    await x.sendAll();
    const before = { title: "Sunset hike", startTime: x.event!.startTime, endTime: x.event!.endTime, status: "scheduled", revision: 3 };
    const after = { ...before, status: "cancelled", revision: 4 };
    x.event = { ...x.event!, status: "cancelled" };
    const stats = await onEventUpdatedForInvites(x.inviteDeps(), { companyId: "c1", eventId: "evt_1", before, after, updateTime: new Date("2030-01-01T12:05:00Z") });
    assert.deepEqual(stats, { recipients: 2, enqueued: 1, skipped: 1 }, "u2 never held an entry");
    await x.sendAll();
    assert.equal(x.provider.sent.length, 2);
    assert.ok(icsOf(x.provider.sent[1]!).includes("METHOD:CANCEL"));
    // Editing a cancelled event does not revive the entry.
    const edited = { ...after, title: "Renamed", revision: 5 };
    const none = await onEventUpdatedForInvites(x.inviteDeps(), { companyId: "c1", eventId: "evt_1", before: after, after: edited, updateTime: new Date("2030-01-01T12:10:00Z") });
    assert.equal(none.enqueued, 0);
  });

  test("reopening a canceled event sends the REQUEST again (same UID, higher SEQUENCE) to going members", async () => {
    const x = world();
    await onRsvpForInvite(x.inviteDeps(), rsvp());
    await x.sendAll();
    const scheduled = { title: "Sunset hike", startTime: x.event!.startTime, endTime: x.event!.endTime, status: "scheduled", revision: 3 };
    const cancelled = { ...scheduled, status: "cancelled", revision: 4 };
    x.event = { ...x.event!, status: "cancelled" };
    await onEventUpdatedForInvites(x.inviteDeps(), { companyId: "c1", eventId: "evt_1", before: scheduled, after: cancelled, updateTime: new Date("2030-01-01T12:05:00Z") });
    await x.sendAll();
    const reopened = { ...scheduled, revision: 5 };
    x.event = { ...x.event!, status: "scheduled", revision: 5 };
    const stats = await onEventUpdatedForInvites(x.inviteDeps(), { companyId: "c1", eventId: "evt_1", before: cancelled, after: reopened, updateTime: new Date("2030-01-01T12:10:00Z") });
    assert.deepEqual(stats, { recipients: 1, enqueued: 1, skipped: 0 });
    await x.sendAll();
    const files = x.provider.sent.map((m) => unfold(icsOf(m)));
    assert.equal(files.length, 3);
    assert.deepEqual(files.map((l) => l.find((p) => p.startsWith("METHOD:"))), ["METHOD:REQUEST", "METHOD:CANCEL", "METHOD:REQUEST"]);
    assert.deepEqual(files.map((l) => l.find((p) => p.startsWith("SEQUENCE:"))), ["SEQUENCE:0", "SEQUENCE:1", "SEQUENCE:2"]);
    assert.equal(new Set(files.map((l) => l.find((p) => p.startsWith("UID:")))).size, 1);
  });

  test("changes that do not touch the entry send nothing", async () => {
    const x = world();
    await onRsvpForInvite(x.inviteDeps(), rsvp());
    const base = { title: "Sunset hike", startTime: x.event!.startTime, endTime: x.event!.endTime, status: "scheduled", revision: 3, capacity: 10 };
    const stats = await onEventUpdatedForInvites(x.inviteDeps(), { companyId: "c1", eventId: "evt_1", before: base, after: { ...base, capacity: 12, revision: 4 }, updateTime: NOW });
    assert.equal(stats.recipients, 0);
  });

  test("a member who leaves before the invite is sent gets neither email", async () => {
    const x = world();
    await onRsvpForInvite(x.inviteDeps(), rsvp());
    x.going.delete("u1");
    await onRsvpForInvite(x.inviteDeps(), rsvp({ before: "going", after: "not_going", writeTime: new Date("2030-01-01T11:05:00Z") }));
    await x.sendAll();
    assert.equal(x.provider.sent.length, 0);
    assert.deepEqual([...x.outbox.docs.values()].map((d) => d.reason).sort(), ["never_invited", "not_going"]);
  });

  test("leave then rejoin: stale cancel is skipped, the new invite carries a higher SEQUENCE", async () => {
    const x = world();
    await onRsvpForInvite(x.inviteDeps(), rsvp());
    await x.sendAll();
    await onRsvpForInvite(x.inviteDeps(), rsvp({ before: "going", after: "not_going", writeTime: new Date("2030-01-01T11:10:00Z") }));
    await onRsvpForInvite(x.inviteDeps(), rsvp({ writeTime: new Date("2030-01-01T11:11:00Z") }));
    x.going.add("u1");
    await x.sendAll();
    assert.equal(x.provider.sent.length, 2);
    assert.ok(icsOf(x.provider.sent[1]!).includes("SEQUENCE:2"));
    assert.ok([...x.outbox.docs.values()].some((d) => d.reason === "rejoined"));
  });

  test("gates: past event, cancelled event, global switch, company switch, preference, wrong tenant", async () => {
    const past = world();
    past.now = new Date("2030-01-07T00:00:00Z");
    assert.equal(await onRsvpForInvite(past.inviteDeps(), rsvp()), "event_over");
    const cancelled = world();
    cancelled.event = { ...cancelled.event!, status: "cancelled" };
    assert.equal(await onRsvpForInvite(cancelled.inviteDeps(), rsvp()), "event_over");
    const off = world(); off.enabled = false;
    assert.equal(await onRsvpForInvite(off.inviteDeps(), rsvp()), "blocked");
    const co = world(); co.companyEnabled = false;
    assert.equal(await onRsvpForInvite(co.inviteDeps(), rsvp()), "blocked");
    const pref = world(); pref.emailMap = { calendar_invites: false };
    assert.equal(await onRsvpForInvite(pref.inviteDeps(), rsvp()), "blocked");
    assert.equal(pref.outbox.docs.size, 0);
    // Preference turned off between queueing and sending.
    const late = world();
    await onRsvpForInvite(late.inviteDeps(), rsvp());
    late.emailMap = { calendar_invites: false };
    await late.sendAll();
    assert.equal(late.provider.sent.length, 0);
    assert.equal([...late.outbox.docs.values()][0]!.reason, "preference_off");
    const tenant = world();
    tenant.recipient = { ...tenant.recipient, companyId: "other" };
    await onRsvpForInvite(tenant.inviteDeps(), rsvp());
    await tenant.sendAll();
    assert.equal(tenant.provider.sent.length, 0);
    assert.equal([...tenant.outbox.docs.values()][0]!.reason, "tenant_mismatch");
  });

  test("default is on: a member with no stored preference gets the invite", async () => {
    const x = world();
    assert.equal(await onRsvpForInvite(x.inviteDeps(), rsvp()), "enqueued");
  });

  test("an invite that ends up without a calendar part is not sent", async () => {
    const x = world();
    await onRsvpForInvite(x.inviteDeps(), rsvp());
    x.recipient = { ...x.recipient, email: "bad address@example.com" };
    await x.sendAll();
    assert.equal(x.provider.sent.length, 0);
  });

  test("at most once: an ambiguous provider outcome is never resent", async () => {
    const x = world();
    x.provider.outcome = { kind: "unknown", code: "timeout" };
    await onRsvpForInvite(x.inviteDeps(), rsvp());
    await x.sendAll();
    await x.sendAll();
    assert.equal(x.provider.sent.length, 1);
    assert.equal([...x.outbox.docs.values()][0]!.status, "unknown");
  });
});

// ---- provider adapters against fake servers ---------------------------------------------------------------------------------

describe("provider adapters carry the invite", () => {
  let server: Server;
  let url = "";
  const seen: Array<{ url: string; body: Record<string, unknown> }> = [];
  before(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        seen.push({ url: req.url ?? "", body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(req.url === "/postmark" ? { ErrorCode: 0, MessageID: "pm-1" } : { id: "re-1" }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }));

  const content = buildInviteIcs("REQUEST", FACTS, CTX);
  const message: OutgoingEmail = {
    to: "jane@example.com", from: "DIP Events <events@letsdip.work>", replyTo: "support@letsdip.work", subject: "Calendar invite", html: "<p>x</p>", text: "x",
    headers: {}, attachments: [{ filename: "invite.ics", contentType: inviteContentType("REQUEST"), content }],
    stream: "notifications", metadata: { outboxId: "calendar_invites_evt_1_u1_r1" }, tag: "calendar_invite",
  };

  test("Resend: from override, reply_to, base64 invite.ics with method content type", async () => {
    const p = new ResendProvider({ apiKey: "re_test", endpoint: `${url}/resend` });
    assert.equal((await p.send(message)).kind, "sent");
    const body = seen.at(-1)!.body as { from: string; reply_to: string; attachments: Array<{ filename: string; content: string; content_type: string }> };
    assert.equal(body.from, "DIP Events <events@letsdip.work>");
    assert.equal(body.reply_to, "support@letsdip.work");
    assert.equal(body.attachments.length, 1);
    assert.equal(body.attachments[0]!.filename, "invite.ics");
    assert.equal(body.attachments[0]!.content_type, "text/calendar; charset=UTF-8; method=REQUEST");
    assert.equal(Buffer.from(body.attachments[0]!.content, "base64").toString("utf8"), content);
  });

  test("Resend and Postmark keep the default notify@ sender when no override is given", async () => {
    const { from: _f, replyTo: _r, ...plain } = message;
    await new ResendProvider({ apiKey: "re_test", endpoint: `${url}/resend` }).send(plain);
    assert.equal((seen.at(-1)!.body as { from: string }).from, "DIP <notify@letsdip.work>");
  });

  test("Postmark: From override, ReplyTo, base64 Attachments with ContentType", async () => {
    const fetchImpl: typeof fetch = (_input, init) => fetch(`${url}/postmark`, init);
    const p = new PostmarkProvider({ serverToken: "tok", fetchImpl });
    assert.equal((await p.send(message)).kind, "sent");
    const body = seen.at(-1)!.body as { From: string; ReplyTo: string; Attachments: Array<{ Name: string; Content: string; ContentType: string }> };
    assert.equal(body.From, "DIP Events <events@letsdip.work>");
    assert.equal(body.ReplyTo, "support@letsdip.work");
    assert.equal(body.Attachments[0]!.Name, "invite.ics");
    assert.equal(body.Attachments[0]!.ContentType, "text/calendar; charset=UTF-8; method=REQUEST");
    assert.equal(Buffer.from(body.Attachments[0]!.Content, "base64").toString("utf8"), content);
    const { from: _f, ...plain } = message;
    await p.send(plain);
    assert.equal((seen.at(-1)!.body as { From: string }).From, "DIP <notify@letsdip.work>");
  });
});
