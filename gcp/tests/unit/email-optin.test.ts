import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { DIGEST_HOUR, digestVariables, digestWindow, runAdminDigests, zonedMidnight, type AdminDigestDeps, type DigestSource, type FinishedImport, type RosterJoin } from "../../functions/src/modules/email/application/adminDigest";
import type { CompanyEmailSettings, EmailPreferencesStore, NewOutboxEntry, OutboxStore, OutgoingEmail, Recipient } from "../../functions/src/modules/email/application/ports";
import { sendOutboxEmail, type SendDeps } from "../../functions/src/modules/email/application/sendOutboxEmail";
import { handleUnsubscribe } from "../../functions/src/modules/email/application/unsubscribe";
import { runWeeklyThemeEmails, weeklyThemeVariables, type WeeklyThemeEmailDeps } from "../../functions/src/modules/email/application/weeklyThemeEmails";
import { categoryOf, outboxId, type OutboxDocument, type OutboxStatus } from "../../functions/src/modules/email/domain/outbox";
import { renderEmail, validateVariables } from "../../functions/src/modules/email/domain/templates/render";
import { TEMPLATE_CATEGORY, templateKind, type TemplateVariables } from "../../functions/src/modules/email/domain/templates/types";
import { signUnsubscribeToken, verifyUnsubscribeToken } from "../../functions/src/modules/email/domain/unsubscribeToken";
import type { WeeklyTheme } from "../../functions/src/modules/notifications/application/routerPorts";
import { NOTIFICATION_KINDS, channelOffers } from "../../functions/src/modules/notifications/domain/categories";
import { PREVIEW_CASES, PREVIEW_CASES_ES, SAMPLE_CTX } from "../../functions/src/modules/email/scripts/previewCases";

const KEY = "k".repeat(40);
const NOW = new Date("2026-11-23T14:00:00Z"); // Monday 09:00 America/New_York
const OPTIN = ["weekly_theme", "admin_digest"];

// ---------------------------------------------------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------------------------------------------------

class FakeOutbox implements OutboxStore {
  docs = new Map<string, OutboxDocument>();
  async create(entry: NewOutboxEntry, now: Date) {
    if (this.docs.has(entry.id)) return false;
    this.docs.set(entry.id, {
      id: entry.id, uid: entry.uid, companyId: entry.companyId, category: categoryOf(entry.template, entry.variables), template: entry.template,
      variables: entry.variables, status: "queued", attempts: 0, notAfter: entry.notAfter, createdAt: now, expireAt: now, leaseUntil: null,
    });
    return true;
  }
  async claim(id: string) {
    const d = this.docs.get(id);
    if (!d) return { kind: "missing" as const };
    if (d.status !== "queued") return { kind: "not_queued" as const, status: d.status };
    d.status = "sending"; d.attempts += 1;
    return { kind: "claimed" as const, doc: { ...d } };
  }
  async finish(id: string, status: Exclude<OutboxStatus, "sending">, fields: { reason?: string }) {
    const d = this.docs.get(id)!;
    d.status = status;
    if (fields.reason) d.reason = fields.reason;
  }
  async get(id: string) { return this.docs.get(id) ?? null; }
  async recordOpen() { return false; }
}

function prefsStore(maps: Record<string, Record<string, unknown> | null>): EmailPreferencesStore & { reads: string[] } {
  const reads: string[] = [];
  return { reads, getEmailMap: async (uid) => { reads.push(uid); return maps[uid] ?? null; }, disable: async () => true };
}

const enabled = (overrides: Partial<CompanyEmailSettings> = {}): CompanyEmailSettings => ({ enabled: true, dailyCap: 2000, timeZone: "America/New_York", ...overrides });

// ---------------------------------------------------------------------------------------------------------------------
// Registry and templates
// ---------------------------------------------------------------------------------------------------------------------

describe("opt-in email registry", () => {
  test("both templates map to their own email-only, default-off categories", () => {
    assert.equal(TEMPLATE_CATEGORY.weekly_theme, "weekly_themes");
    assert.equal(TEMPLATE_CATEGORY.admin_digest, "admin_digest");
    assert.equal(NOTIFICATION_KINDS[templateKind("weekly_theme")!].category, "weekly_themes");
    assert.equal(NOTIFICATION_KINDS[templateKind("admin_digest")!].category, "admin_digest");
    for (const category of ["weekly_themes", "admin_digest"] as const) {
      assert.equal(channelOffers("email", category), true);
      assert.equal(channelOffers("push", category), false);
    }
  });
});

describe("opt-in email templates", () => {
  const cases = [...PREVIEW_CASES, ...PREVIEW_CASES_ES].filter((c) => OPTIN.includes(c.template));

  test("render in en and es with the shared header, body card, footer, one button and a plain-text part", () => {
    assert.equal(cases.length, 10);
    for (const c of cases) {
      const out = renderEmail(c.template, c.variables as never, c.ctx);
      assert.ok(out.html.includes('src="https://letsdip.work/img/email/header.png"') && out.html.includes('src="https://letsdip.work/img/email/footer.png"'), c.name);
      assert.ok(out.html.includes('class="container bg-card border"'), c.name);
      assert.equal((out.html.match(/class="btn-a"/g) ?? []).length, 1, `${c.name}: one primary button`);
      assert.ok(out.html.includes(SAMPLE_CTX.unsubscribeURL) && out.text.includes(SAMPLE_CTX.unsubscribeURL), c.name);
      assert.ok(out.text.includes("support@letsdip.work") && !/<[a-z]/i.test(out.text), c.name);
      assert.ok(out.subject.length <= 78 && out.preheader.length <= 110, `${c.name}: ${out.subject} / ${out.preheader}`);
      assert.ok(out.html.includes(`lang="${c.ctx.locale ?? "en"}"`), c.name);
      for (const s of [out.subject, out.html, out.text]) assert.ok(!s.includes("—"), c.name);
    }
  });

  test("weekly theme: art tile on the theme accent, title, description, dates and points; the button opens DIP", () => {
    const c = PREVIEW_CASES.find((x) => x.name === "weekly_theme")!;
    const out = renderEmail("weekly_theme", c.variables as never, c.ctx);
    assert.equal(out.subject, "This week's theme: Outdoors Week");
    assert.ok(out.html.includes('src="https://letsdip.work/img/email/ideas/outdoors.png"') && out.html.includes('bgcolor="#6BE5D0"'));
    assert.ok(out.text.includes("OUTDOORS WEEK") && out.text.includes("Mon, Nov 23 to Sun, Nov 29") && out.text.includes("Worth 50 points"));
    assert.ok(out.text.includes("Open DIP: https://letsdip.work/"));
    assert.ok(out.text.includes("You are getting this because weekly theme emails are on."));
    const plain = renderEmail("weekly_theme", PREVIEW_CASES.find((x) => x.name === "weekly_theme_plain")!.variables as never, SAMPLE_CTX);
    assert.ok(!plain.html.includes("/img/email/ideas/") && !plain.text.includes("points"));
    const es = renderEmail("weekly_theme", c.variables as never, { ...c.ctx, locale: "es" });
    assert.equal(es.subject, "Tema de la semana: Outdoors Week");
    assert.ok(es.text.includes("Vale 50 puntos") && es.text.includes("lun, 23 nov a dom, 29 nov"));
  });

  test("admin digest: names (at most 10, then a count), import counts, roster button and a portal settings link", () => {
    const out = renderEmail("admin_digest", PREVIEW_CASES.find((x) => x.name === "admin_digest")!.variables as never, SAMPLE_CTX);
    assert.equal(out.subject, "DIP roster update for Thursday, November 19");
    assert.equal(out.preheader, "14 people joined and 1 import finished on Thursday, November 19.");
    assert.ok(out.text.includes("Joined (14)") && out.text.includes("- Ava Johnson") && out.text.includes("- and 4 more people"));
    assert.ok(out.text.includes("- 2:42 PM EST: 42 invited, 3 updated, 1 could not be added"), "each import is labeled with its time in the company zone");
    assert.ok(out.text.includes("Open the roster: https://letsdip.work/admin/roster/"));
    assert.ok(out.text.includes("Manage in the admin portal: https://letsdip.work/admin/account/") && !out.text.includes("Profile > Notifications"));
    assert.ok(!out.text.replace("support@letsdip.work", "").includes("@"), "no addresses beyond the support contact");
    const es = renderEmail("admin_digest", PREVIEW_CASES.find((x) => x.name === "admin_digest_imports")!.variables as never, { ...SAMPLE_CTX, locale: "es" });
    assert.ok(es.subject.startsWith("Novedades de la lista de personal de DIP: jueves, 19 de noviembre"));
    assert.ok(es.text.includes("y 2 importaciones más"));
  });

  test("validation is a strict allow-list", () => {
    const theme = PREVIEW_CASES.find((x) => x.name === "weekly_theme")!.variables as TemplateVariables["weekly_theme"];
    assert.ok(validateVariables("weekly_theme", theme));
    assert.equal(validateVariables("weekly_theme", { ...theme, email: "a@b.co" }), null);
    assert.equal(validateVariables("weekly_theme", { ...theme, themeKey: "cooking" }), null);
    assert.equal(validateVariables("weekly_theme", { ...theme, themeDescription: "x".repeat(401) }), null);
    assert.equal(validateVariables("weekly_theme", { ...theme, endDate: theme.startDate }), null);
    assert.equal(validateVariables("weekly_theme", { ...theme, pointsReward: 1001 }), null);
    const digest = PREVIEW_CASES.find((x) => x.name === "admin_digest")!.variables as TemplateVariables["admin_digest"];
    assert.ok(validateVariables("admin_digest", digest));
    assert.equal(validateVariables("admin_digest", { ...digest, joined: { count: 11, names: Array.from({ length: 11 }, (_, i) => `P${i}`) } }), null);
    assert.equal(validateVariables("admin_digest", { ...digest, joined: { count: 0, names: ["x"] } }), null);
    assert.equal(validateVariables("admin_digest", { dayKey: "2026-11-19", joined: { count: 0, names: [] }, imports: [], importCount: 0 }), null, "nothing to report");
    assert.equal(validateVariables("admin_digest", { ...digest, imports: [{ invited: 1, updated: 0, failed: 0, finishedAt: "2026-11-19T19:42:00Z", fileName: "people.csv" }] }), null);
    assert.equal(validateVariables("admin_digest", { ...digest, imports: [{ invited: 1, updated: 0, failed: 0 }] }), null);
    assert.equal(validateVariables("admin_digest", { ...digest, dayKey: "Nov 19" }), null);
    assert.equal(validateVariables("admin_digest", { ...digest, email: "a@b.co" }), null);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Weekly theme announcement job
// ---------------------------------------------------------------------------------------------------------------------

const THEME: WeeklyTheme = {
  companyId: "alpha", challengeId: "chal1", title: "Outdoors Week", startDate: new Date("2026-11-23T05:00:00Z"), endDate: new Date("2026-11-30T05:00:00Z"),
  description: "Get outside with coworkers.", coverImageURL: "catalog://theme/outdoors", pointsReward: 50,
};

function themeWorld(input: { themes?: WeeklyTheme[]; members?: Record<string, string[]>; maps?: Record<string, Record<string, unknown> | null>; companies?: Record<string, CompanyEmailSettings | null>; enabled?: boolean } = {}) {
  const outbox = new FakeOutbox();
  const preferences = prefsStore(input.maps ?? {});
  const pagerCalls: string[] = [];
  const members = input.members ?? { alpha: ["a1", "a2", "a3"] };
  const deps: WeeklyThemeEmailDeps = {
    themes: { startedBetween: async () => input.themes ?? [THEME] },
    members: { page: async (companyId) => { pagerCalls.push(companyId); return { uids: members[companyId] ?? [], last: null }; } },
    companies: { get: async (companyId) => (input.companies ? input.companies[companyId] ?? null : enabled()) },
    preferences,
    enqueue: { outbox, clock: { now: () => NOW }, validate: validateVariables },
    config: { enabled: input.enabled ?? true },
    now: () => NOW,
  };
  return { deps, outbox, preferences, pagerCalls };
}

describe("weekly theme announcement job", () => {
  test("default off: members without a stored choice, with an empty map or with the switch off get nothing", async () => {
    const w = themeWorld({ maps: { a1: null, a2: { invites: true, challenges: true }, a3: { weekly_themes: false } } });
    const stats = await runWeeklyThemeEmails(w.deps);
    assert.equal(w.outbox.docs.size, 0);
    assert.equal(stats.notOptedIn, 3);
    assert.equal(stats.enqueued, 0);
  });

  test("an opted-in member gets one email per theme with a deterministic id; a second run sends nothing new", async () => {
    const w = themeWorld({ maps: { a2: { weekly_themes: true } } });
    const first = await runWeeklyThemeEmails(w.deps);
    assert.equal(first.enqueued, 1);
    const id = outboxId("weekly_themes", "chal1", "a2", "announce");
    const doc = w.outbox.docs.get(id)!;
    assert.equal(doc.uid, "a2");
    assert.equal(doc.companyId, "alpha");
    assert.equal(doc.template, "weekly_theme");
    assert.equal(doc.notAfter?.toISOString(), THEME.endDate.toISOString());
    const second = await runWeeklyThemeEmails(w.deps);
    assert.equal(second.enqueued, 0);
    assert.equal(second.duplicates, 1);
    assert.equal(w.outbox.docs.size, 1);
  });

  test("tenant isolation: each theme pages only its own company, and a company with email off is skipped", async () => {
    const beta: WeeklyTheme = { ...THEME, companyId: "beta", challengeId: "chal2" };
    const w = themeWorld({
      themes: [THEME, beta], members: { alpha: ["a1"], beta: ["b1"] }, maps: { a1: { weekly_themes: true }, b1: { weekly_themes: true } },
      companies: { alpha: enabled(), beta: null },
    });
    const stats = await runWeeklyThemeEmails(w.deps);
    assert.deepEqual(w.pagerCalls, ["alpha"]);
    assert.equal(stats.companiesOff, 1);
    assert.deepEqual([...w.outbox.docs.values()].map((d) => [d.uid, d.companyId]), [["a1", "alpha"]]);
    assert.ok(!w.preferences.reads.includes("b1"), "no preference read for a company with email off");
  });

  test("EMAIL_ENABLED off, or a theme that started more than 24 hours ago, sends nothing", async () => {
    const off = themeWorld({ maps: { a1: { weekly_themes: true } }, enabled: false });
    assert.equal((await runWeeklyThemeEmails(off.deps)).themes, 0);
    const old = themeWorld({ themes: [{ ...THEME, startDate: new Date(NOW.getTime() - 25 * 3_600_000) }], maps: { a1: { weekly_themes: true } } });
    await runWeeklyThemeEmails(old.deps);
    assert.equal(off.outbox.docs.size + old.outbox.docs.size, 0);
  });

  test("variables come from the theme: catalog art key, shortened description, points; unknown art renders without a tile", () => {
    const v = weeklyThemeVariables({ ...THEME, description: `${"word ".repeat(120)}end` });
    assert.equal(v.themeKey, "outdoors");
    assert.ok(v.themeDescription!.length <= 400 && v.themeDescription!.endsWith("..."));
    assert.ok(validateVariables("weekly_theme", v));
    const unknown = weeklyThemeVariables({ ...THEME, coverImageURL: "https://example.com/x.png", pointsReward: 0, description: "" });
    assert.equal("themeKey" in unknown || "pointsReward" in unknown || "themeDescription" in unknown, false);
    assert.ok(validateVariables("weekly_theme", unknown));
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Admin roster digest job
// ---------------------------------------------------------------------------------------------------------------------

const join = (name: string, at = "2026-11-19T15:00:00Z"): RosterJoin => ({ displayName: name, claimedAt: new Date(at) });
const finished = (invited: number, at: string, updated = 0, failed = 0): FinishedImport => ({ invited, updated, failed, finishedAt: new Date(at) });

function digestWorld(input: { admins?: string[]; maps?: Record<string, Record<string, unknown> | null>; joins?: RosterJoin[]; imports?: FinishedImport[]; settings?: CompanyEmailSettings | null; enabled?: boolean } = {}) {
  const outbox = new FakeOutbox();
  const preferences = prefsStore(input.maps ?? {});
  const reads: Array<{ kind: string; companyId: string; from: Date; to: Date }> = [];
  const source: DigestSource = {
    listEmailCompanies: async () => ["alpha"],
    listAdmins: async () => input.admins ?? ["ad1", "ad2", "ad3"],
    joinsBetween: async (companyId, from, to) => { reads.push({ kind: "joins", companyId, from, to }); return input.joins ?? [join("Priya Patel")]; },
    importsFinishedBetween: async (companyId, from, to) => { reads.push({ kind: "imports", companyId, from, to }); return input.imports ?? []; },
  };
  const deps: AdminDigestDeps = {
    source, preferences, companies: { get: async () => (input.settings === undefined ? enabled() : input.settings) },
    enqueue: { outbox, clock: { now: () => NOW }, validate: validateVariables },
    config: { enabled: input.enabled ?? true, defaultTimeZone: "America/New_York" },
  };
  return { deps, outbox, reads, preferences };
}

// 2026-11-20 08:30 in New York (EST, UTC-5).
const DIGEST_NOW = new Date("2026-11-20T13:30:00Z");

describe("admin roster digest job", () => {
  test("window: the previous local day, only from DIGEST_HOUR for a few hours, in the company zone (DST and half-hour zones)", () => {
    assert.equal(DIGEST_HOUR, 8);
    assert.equal(digestWindow(new Date("2026-11-20T12:59:00Z"), "America/New_York"), null, "07:59 local");
    assert.equal(digestWindow(new Date("2026-11-20T17:00:00Z"), "America/New_York"), null, "12:00 local");
    const w = digestWindow(DIGEST_NOW, "America/New_York")!;
    assert.deepEqual([w.dayKey, w.from.toISOString(), w.to.toISOString()], ["2026-11-19", "2026-11-19T05:00:00.000Z", "2026-11-20T05:00:00.000Z"]);
    // November 1, 2026 is the 25-hour day when New York leaves daylight time.
    const dst = digestWindow(new Date("2026-11-02T13:00:00Z"), "America/New_York")!;
    assert.deepEqual([dst.dayKey, dst.from.toISOString(), dst.to.toISOString()], ["2026-11-01", "2026-11-01T04:00:00.000Z", "2026-11-02T05:00:00.000Z"]);
    assert.equal(zonedMidnight(2026, 11, 20, "Asia/Kolkata").toISOString(), "2026-11-19T18:30:00.000Z");
  });

  test("default off: admins without a stored choice get nothing and the roster is not read", async () => {
    const w = digestWorld({ maps: { ad1: null, ad2: { admin_suggestions: true }, ad3: { admin_digest: false } } });
    const summary = await runAdminDigests(w.deps, DIGEST_NOW);
    assert.equal(w.outbox.docs.size, 0);
    assert.equal(summary.skipped, 1);
    assert.equal(w.reads.length, 0);
  });

  test("opted-in admins get one email per company day; a later run the same morning sends nothing new", async () => {
    const w = digestWorld({ maps: { ad1: { admin_digest: true }, ad3: { admin_digest: true } } });
    const first = await runAdminDigests(w.deps, DIGEST_NOW);
    assert.equal(first.enqueued, 2);
    assert.ok(w.outbox.docs.has(outboxId("admin_digest", "alpha-2026-11-19", "ad1", "2026-11-19")));
    assert.ok(w.reads.every((r) => r.companyId === "alpha" && r.from.toISOString() === "2026-11-19T05:00:00.000Z"));
    const later = await runAdminDigests(w.deps, new Date(DIGEST_NOW.getTime() + 3_600_000));
    assert.equal(later.enqueued, 0);
    assert.equal(later.duplicates, 2);
    assert.equal(w.outbox.docs.size, 2);
  });

  test("nothing to report means no email; email off for the deployment or the company means nothing at all", async () => {
    const quiet = digestWorld({ maps: { ad1: { admin_digest: true } }, joins: [], imports: [] });
    assert.equal((await runAdminDigests(quiet.deps, DIGEST_NOW)).skipped, 1);
    const companyOff = digestWorld({ maps: { ad1: { admin_digest: true } }, settings: { enabled: false, dailyCap: 1, timeZone: null } });
    const deploymentOff = digestWorld({ maps: { ad1: { admin_digest: true } }, enabled: false });
    await runAdminDigests(companyOff.deps, DIGEST_NOW);
    await runAdminDigests(deploymentOff.deps, DIGEST_NOW);
    assert.equal(quiet.outbox.docs.size + companyOff.outbox.docs.size + deploymentOff.outbox.docs.size, 0);
  });

  test("caps: at most 10 names and 5 imports (newest first); counts keep the totals", () => {
    const joins = Array.from({ length: 23 }, (_, i) => join(i === 3 ? "   " : `Person ${i}`));
    const imports = Array.from({ length: 7 }, (_, i) => finished(i + 1, `2026-11-19T1${i}:00:00Z`));
    const v = digestVariables("2026-11-19", joins, imports)!;
    assert.equal(v.joined.count, 23);
    assert.equal(v.joined.names.length, 10);
    assert.ok(!v.joined.names.includes(""), "blank names are dropped, still counted");
    assert.deepEqual(v.imports.map((i) => i.invited), [7, 6, 5, 4, 3]);
    assert.equal(v.importCount, 7);
    assert.ok(validateVariables("admin_digest", v));
    assert.equal(digestVariables("2026-11-19", [], []), null);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Send-time gates and unsubscribe
// ---------------------------------------------------------------------------------------------------------------------

function sender(recipient: Recipient | null, map: Record<string, unknown> | null, cap: "ok" | "member_cap" = "ok") {
  const outbox = new FakeOutbox();
  const sent: OutgoingEmail[] = [];
  const deps: SendDeps = {
    outbox, recipients: { get: async () => recipient, uidsByEmail: async () => [] },
    companies: { get: async () => enabled() },
    suppressions: { isSuppressed: async () => false, suppress: async () => undefined },
    caps: { consume: async () => cap }, preferences: { getEmailMap: async () => map, disable: async () => true },
    provider: { name: "fake", send: async (m) => { sent.push(m); return { kind: "sent", providerMessageId: "p1" }; } },
    renderer: { render: (t, v, ctx) => renderEmail(t, v, ctx), validate: validateVariables, attachment: () => null },
    clock: { now: () => NOW },
    config: { enabled: true, unsubscribeKey: KEY, defaultTimeZone: "UTC", publicOrigin: "https://letsdip.work", openTracking: false },
    log: () => undefined,
  };
  return { deps, outbox, sent };
}

const THEME_VARS = weeklyThemeVariables(THEME);
const DIGEST_VARS = digestVariables("2026-11-19", [join("Priya Patel")], [])!;
const member = (overrides: Partial<Recipient> = {}): Recipient => ({ uid: "u1", companyId: "alpha", email: "sam@acme.com", displayName: "Sam Lee", status: "active", role: "member", locale: null, ...overrides });

async function queue(outbox: FakeOutbox, template: "weekly_theme" | "admin_digest", companyId = "alpha") {
  const id = template === "weekly_theme" ? outboxId("weekly_themes", "chal1", "u1", "announce") : outboxId("admin_digest", "alpha-2026-11-19", "u1", "2026-11-19");
  await outbox.create({ id, uid: "u1", companyId, template, variables: template === "weekly_theme" ? THEME_VARS : DIGEST_VARS, notAfter: null } as NewOutboxEntry, NOW);
  return id;
}

describe("send-time gates of the opt-in emails", () => {
  test("weekly theme sends to an opted-in member in their language, with a weekly_themes unsubscribe link, once", async () => {
    const w = sender(member({ locale: "es" }), { weekly_themes: true });
    const id = await queue(w.outbox, "weekly_theme");
    assert.equal((await sendOutboxEmail(w.deps, id)).status, "sent");
    assert.equal((await sendOutboxEmail(w.deps, id)).reason, "not_queued", "redelivery sends once");
    assert.equal(w.sent.length, 1);
    assert.equal(w.sent[0]!.subject, "Tema de la semana: Outdoors Week");
    const token = w.sent[0]!.headers["List-Unsubscribe"]!.slice(1, -1).split("/u/")[1]!;
    const claims = verifyUnsubscribeToken(KEY, token, Math.floor(NOW.getTime() / 1000));
    assert.ok(claims.ok && claims.claims.category === "weekly_themes");
  });

  test("the category is re-checked at send time: no stored choice or switched off since queuing skips the email", async () => {
    for (const map of [null, {}, { weekly_themes: false }]) {
      const w = sender(member(), map);
      const id = await queue(w.outbox, "weekly_theme");
      assert.deepEqual(await sendOutboxEmail(w.deps, id), { status: "skipped", reason: "preference_off" });
      assert.equal(w.sent.length, 0);
    }
  });

  test("tenant isolation and caps: another company's member, a deactivated member or a full daily cap get nothing", async () => {
    const other = sender(member({ companyId: "beta" }), { weekly_themes: true });
    assert.equal((await sendOutboxEmail(other.deps, await queue(other.outbox, "weekly_theme"))).reason, "tenant_mismatch");
    const inactive = sender(member({ status: "deactivated" }), { weekly_themes: true });
    assert.equal((await sendOutboxEmail(inactive.deps, await queue(inactive.outbox, "weekly_theme"))).reason, "inactive_member");
    const capped = sender(member(), { weekly_themes: true }, "member_cap");
    assert.equal((await sendOutboxEmail(capped.deps, await queue(capped.outbox, "weekly_theme"))).reason, "member_cap");
    assert.equal(other.sent.length + inactive.sent.length + capped.sent.length, 0);
  });

  test("admin digest: only to a current admin with the switch on", async () => {
    const admin = sender(member({ role: "admin" }), { admin_digest: true });
    assert.equal((await sendOutboxEmail(admin.deps, await queue(admin.outbox, "admin_digest"))).status, "sent");
    assert.ok(admin.sent[0]!.text.includes("Priya Patel"));
    const demoted = sender(member({ role: "organizer" }), { admin_digest: true });
    assert.equal((await sendOutboxEmail(demoted.deps, await queue(demoted.outbox, "admin_digest"))).reason, "not_admin");
    const off = sender(member({ role: "admin" }), null);
    assert.equal((await sendOutboxEmail(off.deps, await queue(off.outbox, "admin_digest"))).reason, "preference_off");
  });

  test("one-click unsubscribe from a weekly theme or digest email turns off only that category", async () => {
    for (const category of ["weekly_themes", "admin_digest"] as const) {
      const calls: string[][] = [];
      const token = signUnsubscribeToken(KEY, "u1", category, Math.floor(NOW.getTime() / 1000));
      const res = await handleUnsubscribe(
        { preferences: { getEmailMap: async () => null, disable: async (_uid, categories) => { calls.push([...categories]); return true; } }, clock: { now: () => NOW }, key: KEY, publicOrigin: "https://letsdip.work" },
        { method: "POST", path: `/u/${token}`, body: "List-Unsubscribe=One-Click", contentType: "application/x-www-form-urlencoded" },
      );
      assert.equal(res.status, 200);
      assert.deepEqual(calls, [[category]]);
    }
  });
});
