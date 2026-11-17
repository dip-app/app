import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { RetryableEmailError, sendOutboxEmail, type EmailRenderer, type SendDeps } from "../../functions/src/modules/email/application/sendOutboxEmail";
import type {
  CapStore, ClaimResult, CompanyEmailSettings, EmailPreferencesStore, EmailProviderPort, NewOutboxEntry, OutboxStore,
  OutgoingEmail, Recipient, SendOutcome,
} from "../../functions/src/modules/email/application/ports";
import { resolveEmailPreferences } from "../../functions/src/modules/email/domain/categories";
import { MAX_ATTEMPTS, SEND_LEASE_MS, categoryOf, emailHash, type OutboxDocument, type OutboxStatus } from "../../functions/src/modules/email/domain/outbox";
import { verifyUnsubscribeToken } from "../../functions/src/modules/email/domain/unsubscribeToken";

const NOW = new Date("2030-01-01T12:00:00Z");
const KEY = "k".repeat(40);
const ADDRESS = "Jane.Doe@Example.com";
const vars = { eventId: "e1", eventTitle: "Padel night", startTime: "2030-01-02T18:00:00Z", endTime: "2030-01-02T19:00:00Z", inviterFirstName: "Sam" };

class FakeOutbox implements OutboxStore {
  docs = new Map<string, OutboxDocument>();
  finishes: { id: string; status: string; fields: Record<string, unknown> }[] = [];
  async create(entry: NewOutboxEntry, now: Date) {
    if (this.docs.has(entry.id)) return false;
    this.docs.set(entry.id, {
      id: entry.id, uid: entry.uid, companyId: entry.companyId, category: categoryOf(entry.template), template: entry.template,
      variables: entry.variables, status: "queued", attempts: 0, notAfter: entry.notAfter, createdAt: now, expireAt: now, leaseUntil: null,
    });
    return true;
  }
  async claim(id: string, now: Date, leaseMs: number): Promise<ClaimResult> {
    const d = this.docs.get(id);
    if (!d) return { kind: "missing" };
    if (d.status === "queued") {
      d.status = "sending"; d.attempts += 1; d.leaseUntil = new Date(now.getTime() + leaseMs);
      return { kind: "claimed", doc: { ...d } };
    }
    if (d.status === "sending" && d.leaseUntil && d.leaseUntil.getTime() <= now.getTime()) {
      d.status = "unknown"; d.reason = "abandoned";
      return { kind: "abandoned" };
    }
    return { kind: "not_queued", status: d.status };
  }
  async finish(id: string, status: Exclude<OutboxStatus, "sending">, fields: { reason?: string; providerMessageId?: string; toHash?: string }) {
    const d = this.docs.get(id)!;
    if (d.status !== "sending") return;
    d.status = status; d.leaseUntil = null;
    Object.assign(d, fields);
    this.finishes.push({ id, status, fields });
  }
  async get(id: string) { return this.docs.get(id) ?? null; }
  async recordOpen() { return false; }
}

class FakeProvider implements EmailProviderPort {
  readonly name = "fake";
  sent: OutgoingEmail[] = [];
  outcome: SendOutcome = { kind: "sent", providerMessageId: "pm-1" };
  throws = false;
  async send(m: OutgoingEmail) {
    this.sent.push(m);
    if (this.throws) throw new Error("boom");
    return this.outcome;
  }
}

const renderer: EmailRenderer = {
  render: (template, _v, ctx) => ({ subject: `Subject ${template}`, preheader: "p", html: `<p>${ctx.recipientFirstName ?? "-"} ${ctx.timeZone}</p>`, text: `hi ${ctx.recipientFirstName ?? "-"}` }),
  validate: (_t, value) => (value && typeof value === "object" && !("bad" in value) ? (value as never) : null),
  attachment: () => null,
};

interface World {
  outbox: FakeOutbox; provider: FakeProvider; deps: SendDeps; logs: string[];
  recipient: Recipient | null; company: CompanyEmailSettings | null; emailMap: Record<string, unknown> | null;
  suppressed: Set<string>; suppressWrites: string[]; capResult: "ok" | "member_cap" | "company_cap"; capCalls: unknown[][];
  clockNow: Date;
}

function world(overrides: Partial<SendDeps["config"]> = {}): World {
  const w = {
    outbox: new FakeOutbox(), provider: new FakeProvider(), logs: [] as string[],
    recipient: { uid: "u1", companyId: "c1", email: ADDRESS, displayName: "  Jane Q Doe ", status: "active" } as Recipient | null,
    company: { enabled: true, dailyCap: 100, timeZone: "Europe/Amsterdam" } as CompanyEmailSettings | null,
    emailMap: null as Record<string, unknown> | null,
    suppressed: new Set<string>(), suppressWrites: [] as string[], capResult: "ok" as "ok" | "member_cap" | "company_cap", capCalls: [] as unknown[][],
    clockNow: NOW,
  } as World;
  const caps: CapStore = { consume: async (...args) => { w.capCalls.push(args); return w.capResult; } };
  const preferences: EmailPreferencesStore = { getEmailMap: async () => w.emailMap, disable: async () => true };
  w.deps = {
    outbox: w.outbox,
    recipients: { get: async () => w.recipient, uidsByEmail: async () => [] },
    companies: { get: async () => w.company },
    suppressions: { isSuppressed: async (h) => w.suppressed.has(h), suppress: async (h) => { w.suppressWrites.push(h); } },
    caps, preferences, provider: w.provider, renderer,
    clock: { now: () => w.clockNow },
    config: { enabled: true, unsubscribeKey: KEY, defaultTimeZone: "UTC", publicOrigin: "https://letsdip.work", openTracking: false, ...overrides },
    log: (event, fields) => { w.logs.push(`${event} ${JSON.stringify(fields)}`); },
  };
  return w;
}

async function enqueue(w: World, id = "invites_e1_u1_r1", extra: Partial<NewOutboxEntry> = {}) {
  await w.outbox.create({ id, uid: "u1", companyId: "c1", template: "invite_received", variables: vars, notAfter: null, ...extra }, NOW);
  return id;
}

describe("sendOutboxEmail", () => {
  test("happy path: headers, metadata, context, finish sent with hash only", async () => {
    const w = world();
    const id = await enqueue(w);
    const result = await sendOutboxEmail(w.deps, id);
    assert.deepEqual(result, { status: "sent" });
    assert.equal(w.provider.sent.length, 1);
    const m = w.provider.sent[0]!;
    assert.equal(m.to, ADDRESS);
    assert.deepEqual(m.metadata, { outboxId: id });
    assert.equal(m.tag, "invite_received");
    assert.equal(m.stream, "notifications");
    assert.equal(m.html, "<p>Jane Europe/Amsterdam</p>");
    assert.equal(m.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
    const url = m.headers["List-Unsubscribe"]!.slice(1, -1);
    assert.ok(url.startsWith("https://letsdip.work/u/"));
    const verified = verifyUnsubscribeToken(KEY, url.split("/u/")[1], Math.floor(NOW.getTime() / 1000));
    assert.ok(verified.ok && verified.claims.uid === "u1" && verified.claims.category === "invites");
    const doc = w.outbox.docs.get(id)!;
    assert.equal(doc.status, "sent");
    assert.equal(doc.providerMessageId, "pm-1");
    assert.equal(doc.toHash, emailHash(ADDRESS));
    assert.ok(!JSON.stringify([...w.outbox.docs.values()]).toLowerCase().includes("example.com"));
    assert.ok(!w.logs.join("\n").toLowerCase().includes("example.com"));
    assert.ok(!w.logs.join("\n").includes("Jane"));
    assert.deepEqual(w.capCalls[0]!.slice(0, 5), ["u1", "c1", "2030-01-01", 20, 100]);
  });

  test("duplicate delivery sends once", async () => {
    const w = world();
    const id = await enqueue(w);
    await sendOutboxEmail(w.deps, id);
    const second = await sendOutboxEmail(w.deps, id);
    assert.equal(second.status, "sent");
    assert.equal(second.reason, "not_queued");
    assert.equal(w.provider.sent.length, 1);
  });

  test("abandoned lease becomes unknown and is not sent", async () => {
    const w = world();
    const id = await enqueue(w);
    const doc = w.outbox.docs.get(id)!;
    doc.status = "sending"; doc.leaseUntil = new Date(NOW.getTime() - 1);
    const result = await sendOutboxEmail(w.deps, id);
    assert.deepEqual(result, { status: "unknown", reason: "abandoned" });
    assert.equal(w.provider.sent.length, 0);
    // A lease still running is left alone.
    const id2 = await enqueue(w, "invites_e2_u1_r1");
    const d2 = w.outbox.docs.get(id2)!;
    d2.status = "sending"; d2.leaseUntil = new Date(NOW.getTime() + SEND_LEASE_MS);
    assert.equal((await sendOutboxEmail(w.deps, id2)).reason, "not_queued");
    assert.equal(w.provider.sent.length, 0);
  });

  test("missing document", async () => {
    assert.deepEqual(await sendOutboxEmail(world().deps, "nope"), { status: "missing" });
  });

  const skipCases: Array<[string, (w: World) => void, string, Partial<SendDeps["config"]>?]> = [
    ["disabled", () => undefined, "disabled", { enabled: false }],
    ["config_incomplete key", () => undefined, "config_incomplete", { unsubscribeKey: "short" }],
    ["company missing", (w) => { w.company = null; }, "company_disabled"],
    ["company disabled", (w) => { w.company = { enabled: false, dailyCap: 5, timeZone: null }; }, "company_disabled"],
    ["no member", (w) => { w.recipient = null; }, "no_member"],
    ["tenant mismatch", (w) => { w.recipient = { ...w.recipient!, companyId: "other" }; }, "tenant_mismatch"],
    ["deactivated", (w) => { w.recipient = { ...w.recipient!, status: "deactivated" }; }, "inactive_member"],
    ["no email", (w) => { w.recipient = { ...w.recipient!, email: null }; }, "no_email"],
    ["preference off", (w) => { w.emailMap = { invites: false }; }, "preference_off"],
    ["suppressed", (w) => { w.suppressed.add(emailHash(ADDRESS)); }, "suppressed"],
    ["member cap", (w) => { w.capResult = "member_cap"; }, "member_cap"],
    ["company cap", (w) => { w.capResult = "company_cap"; }, "company_cap"],
  ];
  for (const [name, setup, reason, config] of skipCases) {
    test(`skip: ${name}`, async () => {
      const w = world(config);
      setup(w);
      const id = await enqueue(w);
      const result = await sendOutboxEmail(w.deps, id);
      assert.deepEqual(result, { status: "skipped", reason });
      assert.equal(w.provider.sent.length, 0);
      assert.equal(w.outbox.docs.get(id)!.status, "skipped");
    });
  }

  test("skip: invalid variables", async () => {
    const w = world();
    const id = await enqueue(w, "invites_e1_u1_r1", { variables: { ...vars, bad: true } as never });
    assert.deepEqual(await sendOutboxEmail(w.deps, id), { status: "skipped", reason: "invalid_variables" });
  });

  test("reminders default off at send time", async () => {
    assert.equal(resolveEmailPreferences(null).reminders, false);
    const w = world();
    const id = await enqueue(w, "reminders_e1_u1_24h", { template: "event_reminder", variables: { ...vars, window: "24h" } as never });
    assert.equal((await sendOutboxEmail(w.deps, id)).reason, "preference_off");
    w.emailMap = { reminders: true };
    const id2 = await enqueue(w, "reminders_e1_u1_1h", { template: "event_reminder", variables: { ...vars, window: "1h" } as never });
    assert.equal((await sendOutboxEmail(w.deps, id2)).status, "sent");
  });

  test("notAfter expiry", async () => {
    const w = world();
    const id = await enqueue(w, "invites_e1_u1_r1", { notAfter: new Date(NOW.getTime() - 1) });
    assert.deepEqual(await sendOutboxEmail(w.deps, id), { status: "expired", reason: "expired" });
    assert.equal(w.provider.sent.length, 0);
  });

  test("retryable requeues and throws, then fails at MAX_ATTEMPTS", async () => {
    const w = world();
    w.provider.outcome = { kind: "retryable", code: "http_429" };
    const id = await enqueue(w);
    await assert.rejects(sendOutboxEmail(w.deps, id), (e: unknown) => e instanceof RetryableEmailError && e.code === "http_429");
    const doc = w.outbox.docs.get(id)!;
    assert.equal(doc.status, "queued");
    assert.equal(doc.reason, "http_429");
    assert.equal(doc.attempts, 1);
    for (let i = 2; i < MAX_ATTEMPTS; i++) await assert.rejects(sendOutboxEmail(w.deps, id), RetryableEmailError);
    assert.equal(doc.attempts, MAX_ATTEMPTS - 1);
    assert.deepEqual(await sendOutboxEmail(w.deps, id), { status: "failed", reason: "http_429" });
    assert.equal(doc.attempts, MAX_ATTEMPTS);
  });

  test("retryable at MAX_ATTEMPTS fails without throwing", async () => {
    const w = world();
    w.provider.outcome = { kind: "retryable", code: "http_503" };
    const id = await enqueue(w);
    w.outbox.docs.get(id)!.attempts = MAX_ATTEMPTS - 1;
    assert.deepEqual(await sendOutboxEmail(w.deps, id), { status: "failed", reason: "http_503" });
  });

  test("rejected with suppress writes a suppression", async () => {
    const w = world();
    w.provider.outcome = { kind: "rejected", code: "pm_406_inactive", suppress: true };
    const id = await enqueue(w);
    assert.deepEqual(await sendOutboxEmail(w.deps, id), { status: "failed", reason: "pm_406_inactive" });
    assert.deepEqual(w.suppressWrites, [emailHash(ADDRESS)]);
  });

  test("rejected without suppress does not suppress", async () => {
    const w = world();
    w.provider.outcome = { kind: "rejected", code: "pm_422" };
    const id = await enqueue(w);
    assert.equal((await sendOutboxEmail(w.deps, id)).status, "failed");
    assert.equal(w.suppressWrites.length, 0);
  });

  test("unknown outcome is final and never resent", async () => {
    const w = world();
    w.provider.outcome = { kind: "unknown", code: "timeout" };
    const id = await enqueue(w);
    assert.deepEqual(await sendOutboxEmail(w.deps, id), { status: "unknown", reason: "timeout" });
    await sendOutboxEmail(w.deps, id);
    assert.equal(w.provider.sent.length, 1);
  });

  test("unexpected provider exception becomes unknown without rethrow", async () => {
    const w = world();
    w.provider.throws = true;
    const id = await enqueue(w);
    assert.deepEqual(await sendOutboxEmail(w.deps, id), { status: "unknown", reason: "unexpected_error" });
    assert.equal(w.outbox.docs.get(id)!.status, "unknown");
    assert.ok(!w.logs.join("\n").includes("boom"));
  });

  test("attachment is passed through", async () => {
    const w = world();
    w.deps.renderer = { ...renderer, attachment: () => ({ filename: "e.ics", contentType: "text/calendar", content: "BEGIN" }) };
    const id = await enqueue(w);
    await sendOutboxEmail(w.deps, id);
    assert.deepEqual(w.provider.sent[0]!.attachments.map((a) => a.filename), ["e.ics"]);
  });
});

describe("sendOutboxEmail hardening", () => {
  test("a pre-send failure (recipient read) requeues with transient_error and throws retryable", async () => {
    const w = world();
    const id = await enqueue(w);
    w.deps.recipients = { get: async () => { throw new Error("firestore unavailable"); }, uidsByEmail: async () => [] };
    await assert.rejects(sendOutboxEmail(w.deps, id), RetryableEmailError);
    const doc = w.outbox.docs.get(id)!;
    assert.equal(doc.status, "queued");
    assert.equal(doc.reason, "transient_error");
    assert.equal(w.provider.sent.length, 0);
  });

  test("a cap transaction failure retries, and gives up as failed at MAX_ATTEMPTS", async () => {
    const w = world();
    const id = await enqueue(w);
    w.deps.caps = { consume: async () => { throw new Error("ABORTED"); } };
    for (let i = 1; i < MAX_ATTEMPTS; i++) await assert.rejects(sendOutboxEmail(w.deps, id), RetryableEmailError);
    assert.equal(w.outbox.docs.get(id)!.status, "queued");
    const last = await sendOutboxEmail(w.deps, id);
    assert.deepEqual(last, { status: "failed", reason: "transient_error" });
    assert.equal(w.outbox.docs.get(id)!.status, "failed");
    assert.equal(w.provider.sent.length, 0);
  });

  test("recovers: transient failure then success sends once", async () => {
    const w = world();
    const id = await enqueue(w);
    const original = w.deps.companies;
    w.deps.companies = { get: async () => { throw new Error("blip"); } };
    await assert.rejects(sendOutboxEmail(w.deps, id), RetryableEmailError);
    w.deps.companies = original;
    assert.deepEqual(await sendOutboxEmail(w.deps, id), { status: "sent" });
    assert.equal(w.provider.sent.length, 1);
  });

  test("a throw after the provider call is still unknown (never resent)", async () => {
    const w = world();
    const id = await enqueue(w);
    w.provider.throws = true;
    assert.deepEqual(await sendOutboxEmail(w.deps, id), { status: "unknown", reason: "unexpected_error" });
  });

  test("a claim failure is rethrown as retryable", async () => {
    const w = world();
    const id = await enqueue(w);
    w.outbox.claim = async () => { throw new Error("transaction aborted"); };
    await assert.rejects(sendOutboxEmail(w.deps, id), RetryableEmailError);
    assert.equal(w.outbox.docs.get(id)!.status, "queued");
  });

  test("retryable provider failures pass the same outbox id to the cap on every attempt (consumed once)", async () => {
    const w = world();
    const id = await enqueue(w);
    w.provider.outcome = { kind: "retryable", code: "http_429" };
    const seen = new Set<string>();
    let units = 0;
    w.deps.caps = { consume: async (_u, _c, _d, _m, _l, _n, outboxId) => { if (!seen.has(outboxId)) { seen.add(outboxId); units++; } return "ok"; } };
    for (let i = 0; i < 3; i++) await assert.rejects(sendOutboxEmail(w.deps, id), RetryableEmailError);
    assert.equal(units, 1);
    assert.deepEqual([...seen], [id]);
  });
});
