import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { describe, test } from "node:test";
import { sendOutboxEmail, type EmailRenderer, type SendDeps } from "../../functions/src/modules/email/application/sendOutboxEmail";
import type {
  ClaimResult, CompanyEmailSettings, EmailProviderPort, NewOutboxEntry, OutboxStore, OutgoingEmail, Recipient, RosterInvitee,
} from "../../functions/src/modules/email/application/ports";
import { handleUnsubscribe } from "../../functions/src/modules/email/application/unsubscribe";
import { onMemberCreatedForWelcome, type WelcomeDeps } from "../../functions/src/modules/email/application/welcome";
import { EMAIL_CATEGORIES } from "../../functions/src/modules/email/domain/categories";
import { categoryOf, emailHash, newOutboxData, outboxId, type OutboxDocument, type OutboxStatus } from "../../functions/src/modules/email/domain/outbox";
import { renderEmail, validateVariables } from "../../functions/src/modules/email/domain/templates/render";
import { rosterEntryOf, rosterRecipientKey, templateKind, type TemplateVariables } from "../../functions/src/modules/email/domain/templates/types";
import { signUnsubscribeToken, verifyUnsubscribeToken } from "../../functions/src/modules/email/domain/unsubscribeToken";
import { updateBugReport } from "../../functions/src/modules/admin/application/bugReports";
import { listRoster, sendRosterInviteEmail, upsertRosterEntry } from "../../functions/src/modules/admin/application/roster";
import { AdminError } from "../../functions/src/modules/admin/domain/errors";
import { NOW as ADMIN_NOW, caller, makeDeps, rid, seedCompany, type FakeAdminStore } from "./helpers/adminFakes";
import { PREVIEW_CASES, PREVIEW_CASES_ES, SAMPLE_CTX } from "../../functions/src/modules/email/scripts/previewCases";

const KEY = "k".repeat(40);
const NOW = new Date("2030-01-01T12:00:00Z");
const ADDRESS = "jordan.lee@acme.com";
const ENTRY = emailHash(ADDRESS);
const ROSTER_KEY = rosterRecipientKey(ENTRY);
const INVITE: TemplateVariables["roster_invite"] = { entryId: ENTRY, companyName: "Acme", inviterFirstName: "Priya", role: "member", reminder: false };
const ACCOUNT = ["roster_invite", "welcome", "bug_report_resolved"];
const accountCases = (cases: typeof PREVIEW_CASES) => cases.filter((c) => ACCOUNT.includes(c.template));

// ---------------------------------------------------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------------------------------------------------

describe("account email templates", () => {
  test("every account template renders in English and Spanish with the shared header, card, footer and one button", () => {
    const cases = [...accountCases(PREVIEW_CASES), ...accountCases(PREVIEW_CASES_ES)];
    assert.ok(cases.length >= 12);
    for (const c of cases) {
      const out = renderEmail(c.template, c.variables as never, c.ctx);
      assert.ok(out.html.includes('src="https://letsdip.work/img/email/header.png"'), c.name);
      assert.ok(out.html.includes('src="https://letsdip.work/img/email/footer.png"'), c.name);
      assert.ok(out.html.includes('class="container bg-card border"'), c.name);
      assert.equal((out.html.match(/class="btn-a"/g) ?? []).length, 1, `${c.name}: one primary button`);
      assert.equal((out.html.match(/<v:roundrect/g) ?? []).length, 1, c.name);
      assert.ok(out.html.includes(SAMPLE_CTX.unsubscribeURL) && out.text.includes(SAMPLE_CTX.unsubscribeURL), c.name);
      assert.ok(out.text.includes("support@letsdip.work") && !/<[a-z]/i.test(out.text), c.name);
      assert.ok(out.subject.length <= 78 && out.preheader.length <= 110, c.name);
      for (const s of [out.subject, out.html, out.text]) assert.ok(!s.includes("—"), c.name);
      assert.equal(out.html.includes(`lang="${c.ctx.locale ?? "en"}"`), true, c.name);
    }
  });

  test("roster invitation: the sign-in address in bold, the right link per role, no app settings path, an opt-out link", () => {
    const member = renderEmail("roster_invite", INVITE, { ...SAMPLE_CTX, recipientAddress: ADDRESS });
    assert.equal(member.subject, "Priya invited you to join Acme on DIP");
    assert.ok(member.html.includes(`<strong style="font-weight:700;">${ADDRESS}</strong>`));
    assert.ok(member.text.includes(`sign in with Google using ${ADDRESS}`));
    assert.ok(member.text.includes("Get DIP: https://letsdip.work/"));
    assert.ok(member.text.includes("Stop invitation emails: https://letsdip.work/u/"));
    assert.ok(!member.text.includes("Profile > Notifications"), "a person without an account has no settings to manage");
    assert.ok(member.text.includes("You are getting this because Priya added you to DIP at Acme."));
    const staff = renderEmail("roster_invite", { ...INVITE, role: "organizer", reminder: true, inviterFirstName: undefined } as never, { ...SAMPLE_CTX, recipientFirstName: null });
    assert.equal(staff.subject, "Reminder: join Acme on DIP");
    assert.ok(staff.text.includes("Open the admin portal: https://letsdip.work/admin/"));
    assert.ok(staff.text.includes("sign in with Google using this email address"));
    assert.ok(staff.text.includes("because Acme added you to DIP."));
    const es = renderEmail("roster_invite", INVITE, { ...SAMPLE_CTX, recipientAddress: ADDRESS, locale: "es" });
    assert.equal(es.subject, "Priya te invitó a unirte a Acme en DIP");
    assert.ok(es.text.includes("Dejar de recibir invitaciones: https://letsdip.work/u/"));
  });

  test("welcome lists steps (admins get the portal step and button); the problem report email names only the date", () => {
    const welcome = renderEmail("welcome", { companyName: "Acme", role: "member" }, SAMPLE_CTX);
    assert.ok(welcome.text.includes("- Join an event") && !welcome.text.includes("admin portal"));
    assert.ok(welcome.text.includes("Open DIP: https://letsdip.work/") && welcome.text.includes("Profile > Notifications"));
    const admin = renderEmail("welcome", { companyName: "Acme", role: "admin" }, SAMPLE_CTX);
    assert.ok(admin.text.includes("- Plan events and weekly themes in the admin portal.") && admin.text.includes("https://letsdip.work/admin/"));
    const bug = renderEmail("bug_report_resolved", { reportId: "r1", submittedAt: "2030-01-05T02:00:00Z" }, { ...SAMPLE_CTX, timeZone: "America/New_York" });
    assert.ok(bug.text.includes("reported on January 4 was marked resolved"), "the date is in the company zone");
    assert.equal(renderEmail("bug_report_resolved", { reportId: "r1", submittedAt: "2030-01-05T02:00:00Z" }, { ...SAMPLE_CTX, locale: "es" }).subject, "Se resolvió el problema que reportaste");
  });

  test("server content is escaped", () => {
    const evil = '<script>alert("x")</script>';
    const out = renderEmail("roster_invite", { ...INVITE, companyName: evil, inviterFirstName: evil }, { ...SAMPLE_CTX, recipientFirstName: evil, recipientAddress: `${evil}@x.com` });
    assert.ok(!out.html.includes("<script>") && out.html.includes("&lt;script&gt;"));
  });

  test("strict variable allow-lists", () => {
    assert.deepEqual(validateVariables("roster_invite", INVITE), INVITE);
    assert.equal(validateVariables("roster_invite", { ...INVITE, email: ADDRESS }), null, "never an address in the outbox");
    assert.equal(validateVariables("roster_invite", { ...INVITE, entryId: "not-a-hash" }), null);
    assert.equal(validateVariables("roster_invite", { ...INVITE, role: "owner" }), null);
    assert.equal(validateVariables("roster_invite", { ...INVITE, reminder: "yes" }), null);
    assert.equal(validateVariables("roster_invite", { ...INVITE, companyName: "x".repeat(121) }), null);
    assert.deepEqual(validateVariables("welcome", { companyName: "Acme", role: "admin" }), { companyName: "Acme", role: "admin" });
    assert.equal(validateVariables("welcome", { companyName: "Acme", role: "admin", note: "x" }), null);
    assert.equal(validateVariables("bug_report_resolved", { reportId: "r1", submittedAt: "yesterday" }), null);
    assert.equal(validateVariables("bug_report_resolved", { reportId: "r1", submittedAt: "2030-01-01T00:00:00Z", text: "crash" }), null);
  });

  test("account templates never go through the shared router and keep their own outbox category", () => {
    for (const t of ["roster_invite", "welcome", "bug_report_resolved"] as const) {
      assert.equal(templateKind(t), null);
      assert.equal(categoryOf(t), "account");
    }
    assert.equal(rosterEntryOf(ROSTER_KEY), ENTRY);
    assert.equal(rosterEntryOf("u1"), null);
    assert.equal(rosterEntryOf(`roster-${"A".repeat(64)}`), null);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Sender
// ---------------------------------------------------------------------------------------------------------------------

class FakeOutbox implements OutboxStore {
  docs = new Map<string, OutboxDocument>();
  async create(entry: NewOutboxEntry, now: Date) {
    if (this.docs.has(entry.id)) return false;
    this.docs.set(entry.id, {
      id: entry.id, uid: entry.uid, companyId: entry.companyId, category: categoryOf(entry.template, entry.variables), template: entry.template,
      variables: entry.variables, status: "queued", attempts: 0, notAfter: entry.notAfter, createdAt: now, expireAt: now, leaseUntil: null,
      ...(entry.locale ? { locale: entry.locale } : {}),
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
  async finish(id: string, status: Exclude<OutboxStatus, "sending">, fields: { reason?: string }) {
    const d = this.docs.get(id)!;
    if (d.status !== "sending") return;
    d.status = status; Object.assign(d, fields);
  }
  async get(id: string) { return this.docs.get(id) ?? null; }
  async recordOpen() { return false; }
}

const realRenderer: EmailRenderer = { render: renderEmail, validate: validateVariables, attachment: () => null };

function world() {
  const w = {
    outbox: new FakeOutbox(), sent: [] as OutgoingEmail[], contexts: [] as unknown[],
    invitee: { entryId: ENTRY, companyId: "c1", email: ADDRESS, displayName: "Jordan Lee", status: "invited" } as RosterInvitee | null,
    recipient: { uid: "u1", companyId: "c1", email: "sam@acme.com", displayName: "Sam Lee", status: "active", locale: "es" } as Recipient | null,
    company: { enabled: true, dailyCap: 100, timeZone: null } as CompanyEmailSettings | null,
    emailMap: null as Record<string, unknown> | null, optedOut: new Set<string>(), suppressed: new Set<string>(), capKeys: [] as string[],
  };
  const provider: EmailProviderPort = { name: "fake", send: async (m) => { w.sent.push(m); return { kind: "sent", providerMessageId: "pm" }; } };
  const deps: SendDeps = {
    outbox: w.outbox,
    recipients: { get: async () => w.recipient, uidsByEmail: async () => [] },
    companies: { get: async () => w.company },
    suppressions: { isSuppressed: async (h) => w.suppressed.has(h), suppress: async () => {} },
    caps: { consume: async (uid) => { w.capKeys.push(uid); return "ok"; } },
    preferences: { getEmailMap: async () => w.emailMap, disable: async () => true },
    provider, renderer: { ...realRenderer, render: (t, v, ctx) => { w.contexts.push(ctx); return renderEmail(t, v, ctx); } },
    clock: { now: () => NOW },
    config: { enabled: true, unsubscribeKey: KEY, defaultTimeZone: "UTC", publicOrigin: "https://letsdip.work", openTracking: false },
    invitees: { get: async (companyId, entryId) => (w.invitee && w.invitee.entryId === entryId && companyId === "c1" ? w.invitee : null) },
    inviteOptOuts: { isOptedOut: async (h) => w.optedOut.has(h), optOut: async (h) => { w.optedOut.add(h); } },
    log: () => {},
  };
  return { ...w, deps, w };
}

async function queueInvite(o: FakeOutbox, extra: Partial<NewOutboxEntry> = {}) {
  const id = `account_${ENTRY.slice(0, 8)}_invite1`;
  await o.create({ id, uid: ROSTER_KEY, companyId: "c1", template: "roster_invite", variables: INVITE, notAfter: null, locale: "es", ...extra }, NOW);
  return id;
}

describe("sendOutboxEmail: roster invitations and account emails", () => {
  test("sends to the roster entry's own address in the inviter's language, with an invitation opt-out link; redelivery sends once", async () => {
    const { deps, w } = world();
    const id = await queueInvite(w.outbox);
    assert.deepEqual(await sendOutboxEmail(deps, id), { status: "sent" });
    assert.deepEqual(await sendOutboxEmail(deps, id), { status: "sent", reason: "not_queued" });
    assert.equal(w.sent.length, 1);
    const m = w.sent[0]!;
    assert.equal(m.to, ADDRESS);
    assert.equal(m.subject, "Priya te invitó a unirte a Acme en DIP");
    assert.ok(m.text.includes(`usando ${ADDRESS}`));
    const token = m.headers["List-Unsubscribe"]!.slice(1, -1).split("/u/")[1]!;
    const claims = verifyUnsubscribeToken(KEY, token, Math.floor(NOW.getTime() / 1000));
    assert.ok(claims.ok && claims.claims.uid === ROSTER_KEY && claims.claims.category === "account");
    assert.deepEqual(w.capKeys, [ROSTER_KEY], "caps count against the roster key, not a member");
    assert.ok(!JSON.stringify([...w.outbox.docs.values()]).includes(ADDRESS), "the outbox never stores the address");
  });

  test("send-time gates: joined, revoked, other tenant, changed address, opted out, bounced, missing entry, wiring absent", async () => {
    const cases: Array<[string, (w: ReturnType<typeof world>["w"], deps: SendDeps) => void]> = [
      ["not_invited", (w) => { w.invitee!.status = "claimed"; }],
      ["not_invited", (w) => { w.invitee!.status = "revoked"; }],
      ["tenant_mismatch", (w) => { w.invitee!.companyId = "c2"; }],
      ["tenant_mismatch", (w) => { w.invitee!.email = "someone.else@acme.com"; }],
      ["opted_out", (w) => { w.optedOut.add(ENTRY); }],
      ["suppressed", (w) => { w.suppressed.add(ENTRY); }],
      ["no_member", (w) => { w.invitee = null; }],
      ["config_incomplete", (_w, deps) => { delete deps.invitees; }],
    ];
    for (const [reason, mutate] of cases) {
      const { deps, w } = world();
      mutate(w, deps);
      const id = await queueInvite(w.outbox);
      assert.deepEqual(await sendOutboxEmail(deps, id), { status: "skipped", reason }, reason);
      assert.equal(w.sent.length, 0, reason);
    }
    const { deps, w } = world();
    const forged = await queueInvite(w.outbox, { uid: "u1" });
    assert.deepEqual(await sendOutboxEmail(deps, forged), { status: "skipped", reason: "tenant_mismatch" }, "a member uid cannot carry a roster invitation");
  });

  test("member account emails use the member's own language and stop only when every email category is off", async () => {
    const { deps, w } = world();
    await w.outbox.create({ id: "account_c1_u1_welcome", uid: "u1", companyId: "c1", template: "welcome", variables: { companyName: "Acme", role: "member" }, notAfter: null }, NOW);
    w.emailMap = { reminders: false, invites: false };
    assert.equal((await sendOutboxEmail(deps, "account_c1_u1_welcome")).status, "sent");
    assert.equal(w.sent[0]!.subject, "Te damos la bienvenida a DIP en Acme");
    const off = world();
    off.w.emailMap = Object.fromEntries(EMAIL_CATEGORIES.map((c) => [c, false]));
    await off.w.outbox.create({ id: "w2", uid: "u1", companyId: "c1", template: "welcome", variables: { companyName: "Acme", role: "member" }, notAfter: null }, NOW);
    assert.deepEqual(await sendOutboxEmail(off.deps, "w2"), { status: "skipped", reason: "all_off" });
    const other = world();
    other.w.recipient!.companyId = "c2";
    await other.w.outbox.create({ id: "w3", uid: "u1", companyId: "c1", template: "bug_report_resolved", variables: { reportId: "r1", submittedAt: "2030-01-01T00:00:00Z" }, notAfter: null }, NOW);
    assert.deepEqual(await sendOutboxEmail(other.deps, "w3"), { status: "skipped", reason: "tenant_mismatch" });
  });

  test("the shared outbox shape carries the inviter's locale only when set", () => {
    const data = newOutboxData({ uid: ROSTER_KEY, companyId: "c1", template: "roster_invite", variables: INVITE, notAfter: null, locale: "es" }, NOW);
    assert.equal(data.category, "account");
    assert.equal(data.status, "queued");
    assert.equal(data.locale, "es");
    assert.equal("locale" in newOutboxData({ uid: "u1", companyId: "c1", template: "welcome", variables: {}, notAfter: null }, NOW), false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Unsubscribe
// ---------------------------------------------------------------------------------------------------------------------

describe("unsubscribe from account emails", () => {
  const nowS = Math.floor(NOW.getTime() / 1000);
  function setup() {
    const disabled: Array<{ uid: string; categories: string[] }> = [];
    const optOuts: string[] = [];
    const deps = {
      preferences: { getEmailMap: async () => null, disable: async (uid: string, categories: readonly string[]) => { disabled.push({ uid, categories: [...categories] }); return true; } },
      inviteOptOuts: { isOptedOut: async () => false, optOut: async (h: string) => { optOuts.push(h); } },
      clock: { now: () => NOW }, key: KEY, publicOrigin: "https://letsdip.work",
    };
    return { deps, disabled, optOuts };
  }
  const req = (method: string, token: string, body?: string) => ({ method, path: `/u/${token}`, body, contentType: "application/x-www-form-urlencoded" });

  test("a roster invitation link shows a confirmation on GET and records an opt-out of invitations on the one-click POST", async () => {
    const { deps, disabled, optOuts } = setup();
    const token = signUnsubscribeToken(KEY, ROSTER_KEY, "account", nowS);
    const page = await handleUnsubscribe(deps, req("GET", token));
    assert.equal(page.status, 200);
    assert.ok(page.body.includes("Stop invitation emails"));
    assert.deepEqual(optOuts, [], "GET never changes anything");
    const done = await handleUnsubscribe(deps, req("POST", token, "List-Unsubscribe=One-Click"));
    assert.equal(done.status, 200);
    assert.deepEqual(optOuts, [ENTRY]);
    assert.deepEqual(disabled, []);
  });

  test("a member's account email link turns every email category off", async () => {
    const { deps, disabled } = setup();
    const token = signUnsubscribeToken(KEY, "u1", "account", nowS);
    assert.ok((await handleUnsubscribe(deps, req("GET", token))).body.includes("all DIP emails"));
    await handleUnsubscribe(deps, req("POST", token, "List-Unsubscribe=One-Click"));
    assert.deepEqual(disabled, [{ uid: "u1", categories: [...EMAIL_CATEGORIES] }]);
  });

  test("a roster key with a member category is refused", async () => {
    const { deps, disabled, optOuts } = setup();
    const token = signUnsubscribeToken(KEY, ROSTER_KEY, "invites", nowS);
    assert.equal((await handleUnsubscribe(deps, req("POST", token, "List-Unsubscribe=One-Click"))).status, 400);
    assert.deepEqual([disabled, optOuts], [[], []]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Welcome trigger
// ---------------------------------------------------------------------------------------------------------------------

describe("welcome email on member creation", () => {
  function deps(enabled = true, companyOn = true): WelcomeDeps & { outbox: FakeOutbox } {
    return {
      outbox: new FakeOutbox(), clock: { now: () => NOW }, validate: validateVariables, config: { enabled },
      companies: { get: async () => (companyOn ? { enabled: true, dailyCap: 10, timeZone: null } : null) },
      companyName: async (id) => (id === "c1" ? "Acme" : null),
    };
  }
  const member = { uid: "u1", data: { companyId: "c1", role: "organizer", status: "active", email: "sam@acme.com" } };

  test("queues one welcome per member; a redelivered trigger is a no-op", async () => {
    const d = deps();
    const first = await onMemberCreatedForWelcome(d, member);
    assert.equal(first.enqueued, true);
    assert.deepEqual(await onMemberCreatedForWelcome(d, member), { enqueued: false, id: first.enqueued ? first.id : "", reason: "duplicate" });
    const doc = [...d.outbox.docs.values()][0]!;
    assert.deepEqual([doc.template, doc.category, doc.uid, doc.companyId], ["welcome", "account", "u1", "c1"]);
    assert.deepEqual(doc.variables, { companyName: "Acme", role: "organizer" });
    assert.ok(doc.notAfter && doc.notAfter.getTime() > NOW.getTime());
  });

  test("nothing is queued while email is off, for a company without email, or for a document that is not an active member", async () => {
    assert.equal((await onMemberCreatedForWelcome(deps(false), member)).enqueued, false);
    assert.equal((await onMemberCreatedForWelcome(deps(true, false), member)).enqueued, false);
    assert.equal((await onMemberCreatedForWelcome(deps(), { uid: "u1", data: { role: "member" } })).enqueued, false);
    assert.equal((await onMemberCreatedForWelcome(deps(), { uid: "u1", data: { companyId: "c1", role: "owner" } })).enqueued, false);
    assert.equal((await onMemberCreatedForWelcome(deps(), { uid: "u1", data: { companyId: "c1", role: "member", status: "deactivated" } })).enqueued, false);
    assert.equal((await onMemberCreatedForWelcome(deps(), { uid: "u2", data: { companyId: "c9", role: "member" } })).enqueued, false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Admin commands: sendRosterInviteEmailV1 and the problem report email
// ---------------------------------------------------------------------------------------------------------------------

const base = { contractVersion: 1, companyId: "alpha" };
const admin = caller("admin1");
const sha = (email: string) => createHash("sha256").update(email).digest("hex");
const outbox = (store: FakeAdminStore) => store.children("emailOutbox").map((c) => ({ id: c.id, ...c.data }));

async function fails(promise: Promise<unknown>, code: string, reason: string) {
  await assert.rejects(promise, (e: unknown) => { assert.ok(e instanceof AdminError, String(e)); assert.equal(e.code, code); assert.equal(e.reason, reason); return true; });
}

describe("sendRosterInviteEmailV1", () => {
  async function setup(emailOn = true) {
    const ctx = makeDeps();
    ctx.deps.email = { enabled: () => emailOn };
    seedCompany(ctx.store);
    ctx.store.seed("emailSettings/alpha", { enabled: true });
    ctx.store.seed("users/admin1", { ...ctx.store.get("users/admin1")!, locale: "es" });
    await upsertRosterEntry(ctx.deps, admin, { ...base, requestId: rid(), entry: { email: "new.hire@alpha.test", displayName: "New Hire", role: "member" } });
    return { ...ctx, body: { ...base, requestId: rid(), entryId: sha("new.hire@alpha.test") } };
  }

  test("queues one invitation in the admin's language, counts it on the entry, audits, and a replay queues nothing more", async () => {
    const { deps, store, body } = await setup();
    const first = await sendRosterInviteEmail(deps, admin, body);
    assert.deepEqual(first, { contractVersion: 1, entryId: body.entryId, status: "invited", inviteEmailCount: 1, lastInviteEmailAt: ADMIN_NOW.toISOString() });
    assert.deepEqual(await sendRosterInviteEmail(deps, admin, body), first);
    const queued = outbox(store);
    assert.equal(queued.length, 1);
    const doc = queued[0]!;
    assert.equal(doc.id, outboxId("account", body.entryId, rosterRecipientKey(body.entryId), "invite1"));
    assert.deepEqual([doc.uid, doc.companyId, doc.template, doc.category, doc.status, doc.locale], [`roster-${body.entryId}`, "alpha", "roster_invite", "account", "queued", "es"]);
    assert.deepEqual(doc.variables, { entryId: body.entryId, companyName: "Alpha", role: "member", reminder: false, inviterFirstName: "Ada" });
    assert.ok(!JSON.stringify(doc).includes("new.hire@alpha.test"), "the outbox never stores the address");
    const entry = store.get(`companies/alpha/roster/${body.entryId}`)!;
    assert.deepEqual([entry.inviteEmailCount, entry.lastInviteEmailBy], [1, "admin1"]);
    const audits = store.children("companies/alpha/auditLog").map((c) => c.data).filter((a) => a.action === "roster.inviteEmail");
    assert.equal(audits.length, 1);
    assert.equal(audits[0]!.summaryKey, "roster.inviteEmail");
    const listed = await listRoster(deps, admin, { ...base, pageSize: 10 });
    assert.equal(listed.inviteEmail, true);
    const row = listed.entries.find((e) => e.id === body.entryId)!;
    assert.deepEqual([row.inviteEmailCount, row.lastInviteEmailAt], [1, ADMIN_NOW.toISOString()]);
  });

  test("auth denial, role denial and tenant isolation", async () => {
    const { deps, store, body } = await setup();
    await fails(sendRosterInviteEmail(deps, null, body), "unauthenticated", "UNAUTHENTICATED");
    await fails(sendRosterInviteEmail(deps, caller("admin1", { emailVerified: false }), { ...body, requestId: rid() }), "permission-denied", "EMAIL_NOT_VERIFIED");
    await fails(sendRosterInviteEmail(deps, caller("org1"), { ...body, requestId: rid() }), "permission-denied", "INSUFFICIENT_ROLE");
    await fails(sendRosterInviteEmail(deps, caller("m1"), { ...body, requestId: rid() }), "permission-denied", "INSUFFICIENT_ROLE");
    await fails(sendRosterInviteEmail(deps, caller("bo"), { ...body, requestId: rid() }), "permission-denied", "COMPANY_MISMATCH");
    await fails(sendRosterInviteEmail(deps, caller("bo"), { ...body, companyId: "beta", requestId: rid() }), "not-found", "ROSTER_ENTRY_NOT_FOUND");
    assert.equal(outbox(store).length, 0);
  });

  test("refused while email is off, after an opt-out or bounce, for joined or revoked entries, too soon, and past the limit", async () => {
    const off = await setup(false);
    await fails(sendRosterInviteEmail(off.deps, admin, off.body), "failed-precondition", "EMAIL_NOT_ENABLED");
    const companyOff = await setup();
    companyOff.store.seed("emailSettings/alpha", { enabled: false });
    await fails(sendRosterInviteEmail(companyOff.deps, admin, companyOff.body), "failed-precondition", "EMAIL_NOT_ENABLED");

    const { deps, store, body } = await setup();
    store.seed(`emailInviteOptOuts/${body.entryId}`, { createdAt: ADMIN_NOW });
    await fails(sendRosterInviteEmail(deps, admin, { ...body, requestId: rid() }), "failed-precondition", "INVITE_EMAIL_OPTED_OUT");
    store.docs.delete(`emailInviteOptOuts/${body.entryId}`);
    store.seed(`emailSuppressions/${body.entryId}`, { reason: "hard_bounce" });
    await fails(sendRosterInviteEmail(deps, admin, { ...body, requestId: rid() }), "failed-precondition", "INVITE_EMAIL_UNDELIVERABLE");
    store.docs.delete(`emailSuppressions/${body.entryId}`);

    await sendRosterInviteEmail(deps, admin, { ...body, requestId: rid() });
    await fails(sendRosterInviteEmail(deps, admin, { ...body, requestId: rid() }), "resource-exhausted", "INVITE_EMAIL_TOO_SOON");
    const path = `companies/alpha/roster/${body.entryId}`;
    store.seed(path, { ...store.get(path)!, lastInviteEmailAt: new Date(ADMIN_NOW.getTime() - 2 * 3600_000) });
    const second = await sendRosterInviteEmail(deps, admin, { ...body, requestId: rid() });
    assert.equal(second.inviteEmailCount, 2);
    assert.equal(outbox(store).find((d) => d.id.endsWith("_invite2"))!.variables.reminder, true, "a second email is a reminder");
    store.seed(path, { ...store.get(path)!, inviteEmailCount: 5, lastInviteEmailAt: new Date(0) });
    await fails(sendRosterInviteEmail(deps, admin, { ...body, requestId: rid() }), "resource-exhausted", "INVITE_EMAIL_LIMIT");
    store.seed(path, { ...store.get(path)!, status: "claimed" });
    await fails(sendRosterInviteEmail(deps, admin, { ...body, requestId: rid() }), "failed-precondition", "ROSTER_ENTRY_CLAIMED");
    store.seed(path, { ...store.get(path)!, status: "revoked" });
    await fails(sendRosterInviteEmail(deps, admin, { ...body, requestId: rid() }), "failed-precondition", "ROSTER_ENTRY_NOT_INVITED");
    assert.equal(outbox(store).length, 2);
  });

  test("listRosterV1 reports invitation email as unavailable while email is off", async () => {
    const { deps } = await setup(false);
    assert.equal((await listRoster(deps, admin, { ...base, pageSize: 5 })).inviteEmail, false);
  });
});

describe("updateBugReportV1: problem report resolved email", () => {
  function setup(emailOn = true) {
    const ctx = makeDeps();
    ctx.deps.email = { enabled: () => emailOn };
    seedCompany(ctx.store);
    ctx.store.seed("emailSettings/alpha", { enabled: true });
    ctx.store.seed("bugReports/rep-1", { uid: "m1", category: "bug", description: "secret crash text", createdAt: new Date("2030-01-01T09:00:00Z") });
    ctx.store.seed("bugReports/rep-b", { uid: "bea", category: "bug", description: "beta", createdAt: new Date("2030-01-01T09:00:00Z") });
    return ctx;
  }
  const update = (status: string, reportId = "rep-1") => ({ ...base, requestId: rid(), reportId, status });

  test("queues one email to the reporter when the report is first resolved; reopening and resolving again queues nothing more", async () => {
    const { deps, store } = setup();
    await updateBugReport(deps, admin, update("triaged"));
    assert.equal(outbox(store).length, 0);
    await updateBugReport(deps, admin, update("resolved"));
    await updateBugReport(deps, admin, update("triaged"));
    await updateBugReport(deps, admin, update("resolved"));
    const queued = outbox(store);
    assert.equal(queued.length, 1);
    assert.deepEqual([queued[0]!.uid, queued[0]!.template, queued[0]!.category], ["m1", "bug_report_resolved", "account"]);
    assert.deepEqual(queued[0]!.variables, { reportId: "rep-1", submittedAt: "2030-01-01T09:00:00.000Z" });
    assert.ok(!JSON.stringify(queued).includes("secret crash text"), "no report text in the email");
  });

  test("nothing is queued while email is off; another company's report stays invisible", async () => {
    const { deps, store } = setup(false);
    await updateBugReport(deps, admin, update("resolved"));
    assert.equal(outbox(store).length, 0);
    const on = setup();
    await fails(updateBugReport(on.deps, admin, update("resolved", "rep-b")), "not-found", "BUG_REPORT_NOT_FOUND");
    assert.equal(outbox(on.store).length, 0);
  });
});
