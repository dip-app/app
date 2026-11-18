import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { AdminError } from "../../functions/src/modules/admin/domain/errors";
import type { DecisionPort, DecisionRequest } from "../../functions/src/modules/ai/application/ports";
import { LlmUnavailableError } from "../../functions/src/modules/ai/application/ports";
import type { EmailPreferencesStore, NewOutboxEntry, OutboxStore } from "../../functions/src/modules/email/application/ports";
import { validateVariables } from "../../functions/src/modules/email/domain/templates/render";
import { firestoreBudget } from "../../functions/src/modules/suggestions/application/budget";
import { getOrBuildDigest } from "../../functions/src/modules/suggestions/application/buildDigest";
import { manageSuggestionsEmail, nextSendAt, type ManageDeps } from "../../functions/src/modules/suggestions/application/manage";
import {
  DEFAULT_SCHEDULE, suggestionPaths, type BuildDeps, type CompanyContext, type DigestClaim, type StoredDigest, type SuggestionsConfig,
  type SuggestionsStore,
} from "../../functions/src/modules/suggestions/application/ports";
import { resolveSuggestedIdea, type ResolveDeps } from "../../functions/src/modules/suggestions/application/resolveIdea";
import { digestVariables } from "../../functions/src/modules/suggestions/application/variables";
import { aboutFourWeeksBack, previousSixWeeks, shiftWeekKey } from "../../functions/src/modules/suggestions/application/weekKeys";
import { runWeeklySuggestions, type WeeklyJobDeps } from "../../functions/src/modules/suggestions/application/weeklyJob";
import { IDEA_CATALOG, ideaById } from "../../functions/src/modules/suggestions/domain/catalog";
import { signSuggestionToken, verifySuggestionToken } from "../../functions/src/modules/suggestions/domain/deepLink";
import type { PastEvent, UpcomingEvent, WeeklyThemeInfo } from "../../functions/src/modules/suggestions/domain/signals";
import { FakeAdminStore, NOW, caller, seedCompany } from "./helpers/adminFakes";
import { JEV_USAGE, MemoryCatalog, MemoryInterests, SETTINGS, USAGE, decision } from "./helpers/aiFakes";

const KEY = "k".repeat(40);
const ORIGIN = "https://letsdip.work";
/** Monday 2030-01-07 09:00 in Los Angeles (UTC-8). */
const MON_9_LA = new Date("2030-01-07T17:00:00Z");
const MONTH = "companies/alpha/aiUsage/203001";

// ---------------------------------------------------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------------------------------------------------

interface DigestRow { status: "building" | "ready"; leaseUntil: Date | null; digest: StoredDigest | null }

/** In-memory SuggestionsStore. Company flags, admins and members come from the shared FakeAdminStore documents. */
class FakeSuggestions implements SuggestionsStore {
  past = new Map<string, PastEvent[]>();
  upcoming = new Map<string, UpcomingEvent[]>();
  themes = new Map<string, WeeklyThemeInfo[]>();
  digests = new Map<string, DigestRow>();
  claimed = 0;
  finished = 0;
  constructor(private readonly admin: FakeAdminStore) {}

  private key = (c: string, w: string) => `${c}/${w}`;
  async listEmailCompanies(limit: number) {
    return this.admin.children("emailSettings").filter(c => c.data.enabled === true).map(c => c.id).slice(0, limit);
  }
  async companyContext(companyId: string): Promise<CompanyContext> {
    const email = this.admin.get(`emailSettings/${companyId}`);
    const schedule = this.admin.get(suggestionPaths.schedule(companyId));
    return {
      emailEnabled: email?.enabled === true,
      timeZone: typeof email?.timeZone === "string" ? email.timeZone : null,
      aiSettings: this.admin.get(`companies/${companyId}/aiSettings/current`) ?? null,
      schedule: schedule ? { weekday: schedule.weekday as number, hour: schedule.hour as number } : null,
    };
  }
  private users(companyId: string) {
    return [...this.admin.docs].filter(([p, e]) => p.startsWith("users/") && e.data.companyId === companyId && e.data.status !== "deactivated")
      .map(([p, e]) => ({ uid: p.slice(6), data: e.data }));
  }
  async listAdmins(companyId: string) { return this.users(companyId).filter(u => u.data.role === "admin").map(u => ({ uid: u.uid })); }
  async memberCount(companyId: string) { return this.users(companyId).length; }
  async pastEvents(companyId: string) { return this.past.get(companyId) ?? []; }
  async upcomingEvents(companyId: string) { return this.upcoming.get(companyId) ?? []; }
  async weeklyThemes(companyId: string) { return this.themes.get(companyId) ?? []; }
  async recentIdeaIds(companyId: string, weekKey: string) {
    return [...new Set(previousSixWeeks(weekKey).flatMap(w => this.digests.get(this.key(companyId, w))?.digest?.ideas.map(i => i.ideaId) ?? []))];
  }
  async tagCountsAboutFourWeeksAgo(companyId: string, weekKey: string) {
    for (const w of aboutFourWeeksBack(weekKey)) {
      const d = this.digests.get(this.key(companyId, w))?.digest;
      if (d && Object.keys(d.tagCounts).length > 0) return d.tagCounts;
    }
    return null;
  }
  async getDigest(companyId: string, weekKey: string) { return this.digests.get(this.key(companyId, weekKey))?.digest ?? null; }
  async claimDigest(companyId: string, weekKey: string, now: Date, leaseMs: number): Promise<DigestClaim> {
    const row = this.digests.get(this.key(companyId, weekKey));
    if (row?.status === "ready" && row.digest) return { kind: "ready", digest: row.digest };
    if (row?.status === "building" && row.leaseUntil && row.leaseUntil.getTime() > now.getTime()) return { kind: "busy" };
    this.digests.set(this.key(companyId, weekKey), { status: "building", leaseUntil: new Date(now.getTime() + leaseMs), digest: null });
    this.claimed += 1;
    return { kind: "claimed" };
  }
  async finishDigest(companyId: string, weekKey: string, digest: StoredDigest) {
    this.digests.set(this.key(companyId, weekKey), { status: "ready", leaseUntil: null, digest });
    this.finished += 1;
  }
}

class FakeOutbox {
  entries = new Map<string, NewOutboxEntry>();
  async create(entry: NewOutboxEntry) {
    if (this.entries.has(entry.id)) return false;
    this.entries.set(entry.id, entry);
    return true;
  }
}

type Port = DecisionPort & { calls: DecisionRequest[] };

function port(kind: "jev" | "openai" | "fail"): Port {
  const calls: DecisionRequest[] = [];
  return {
    calls,
    async decide(request) {
      calls.push(request);
      if (kind === "fail") throw new LlmUnavailableError(503);
      if (kind === "jev") return decision(request, {}, JEV_USAGE);
      return { ...decision(request, {}, USAGE), model: "gpt-6-luna", provider: "openai" };
    },
  };
}

interface Options { jev?: Port | null; openai?: Port | null; config?: Partial<SuggestionsConfig>; aiEnabled?: boolean }

function world(options: Options = {}) {
  const admin = new FakeAdminStore();
  seedCompany(admin);
  admin.seed("users/deadadmin", { companyId: "alpha", role: "admin", displayName: "Dead Admin", email: "dead@alpha.test", status: "deactivated" });
  for (const c of ["alpha", "beta"]) {
    // Enough members that the group size prefilter keeps candidates.
    for (let i = 1; i <= 10; i++) admin.seed(`users/${c}-member${i}`, { companyId: c, role: "member", displayName: `Member ${i}`, email: `m${i}@${c}.test` });
    admin.seed(`emailSettings/${c}`, { enabled: true, timeZone: "America/Los_Angeles" });
    admin.seed(`companies/${c}/aiSettings/current`, { enabled: options.aiEnabled ?? true });
  }
  const store = new FakeSuggestions(admin);
  const outbox = new FakeOutbox();
  const prefs = new Map<string, Record<string, unknown> | null>([
    ["admin1", { admin_suggestions: true }], ["bo", { admin_suggestions: true }], ["deadadmin", { admin_suggestions: true }], ["org1", { admin_suggestions: true }],
  ]);
  const preferences: EmailPreferencesStore = { getEmailMap: async uid => prefs.get(uid) ?? null, disable: async () => true };
  const writer = {
    async setCategory(uid: string, channel: string, category: string, enabled: boolean) {
      assert.equal(channel, "email");
      prefs.set(uid, { ...(prefs.get(uid) ?? {}), [category]: enabled });
    },
  };
  const jev = options.jev === undefined ? port("jev") : options.jev;
  const openai = options.openai === undefined ? port("openai") : options.openai;
  const logs: Array<{ event: string; fields: Record<string, unknown> }> = [];
  const log = (event: string, fields: Record<string, unknown>) => { logs.push({ event, fields }); };
  const w = {
    now: NOW, admin, store, outbox, prefs, jev, openai, logs,
    config: { emailEnabled: true, defaultTimeZone: "America/New_York", signingKey: KEY, origin: ORIGIN, ...options.config } as SuggestionsConfig,
    build: null as unknown as BuildDeps, jobDeps: null as unknown as WeeklyJobDeps, manageDeps: null as unknown as ManageDeps, resolveDeps: null as unknown as ResolveDeps,
  };
  w.build = {
    store, interests: new MemoryInterests(null), catalog: new MemoryCatalog(), engines: { jev, openai },
    models: { jev: "jev-latest", openai: "gpt-6-luna" }, budget: firestoreBudget(admin, SETTINGS), log,
  };
  const enqueue = { outbox: outbox as unknown as OutboxStore, clock: { now: () => w.now }, validate: validateVariables };
  w.jobDeps = { build: w.build, enqueue, preferences, settings: SETTINGS, config: w.config, log };
  w.manageDeps = { admin, build: w.build, enqueue, preferences, writer, settings: SETTINGS, config: w.config, log, now: () => w.now };
  w.resolveDeps = { admin, store, signingKey: KEY, now: () => w.now };
  return w;
}

type World = ReturnType<typeof world>;

const alphaEvent = (title: string): PastEvent => ({
  title, tagIds: ["tag-outdoors"], start: new Date("2030-01-03T10:00:00Z"), end: new Date("2030-01-03T12:00:00Z"), capacity: 30,
  attendeeCount: 24, status: "completed", isOutdoor: true, costCents: 0,
});

async function fails(promise: Promise<unknown>, code: string, reason: string) {
  await assert.rejects(promise, (e: unknown) => {
    assert.ok(e instanceof AdminError, String(e));
    assert.equal(e.reason, reason);
    assert.equal(e.code, code);
    return true;
  });
}

const outboxIds = (w: World) => [...w.outbox.entries.keys()];
const month = (w: World, company = "alpha") => w.admin.get(`companies/${company}/aiUsage/203001`);

// ---------------------------------------------------------------------------------------------------------------------
// Week keys
// ---------------------------------------------------------------------------------------------------------------------

describe("week keys", () => {
  test("shiftWeekKey crosses year boundaries", () => {
    assert.equal(shiftWeekKey("2026-W02", 3), "2025-W51");
    assert.equal(shiftWeekKey("2026-W48", 4), "2026-W44");
    assert.equal(shiftWeekKey("2026-W48", -1), "2026-W49");
    assert.deepEqual(previousSixWeeks("2030-W02"), ["2030-W01", "2029-W52", "2029-W51", "2029-W50", "2029-W49", "2029-W48"]);
    assert.deepEqual(aboutFourWeeksBack("2030-W10"), ["2030-W06", "2030-W07", "2030-W05"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Weekly job
// ---------------------------------------------------------------------------------------------------------------------

describe("weekly job: schedule and time zones", () => {
  test("due Monday 09:00 in Los Angeles, not at 08:00, catches up at 15:00", async () => {
    const early = world();
    const notYet = await runWeeklySuggestions(early.jobDeps, new Date("2030-01-07T16:00:00Z"));
    assert.equal(notYet.due, 0);
    assert.equal(early.outbox.entries.size, 0);
    assert.equal(early.store.claimed, 0);

    const onTime = world();
    const summary = await runWeeklySuggestions(onTime.jobDeps, MON_9_LA);
    assert.equal(summary.companies, 2);
    assert.equal(summary.due, 2);
    assert.equal(summary.enqueued, 2);

    const late = world();
    assert.equal((await runWeeklySuggestions(late.jobDeps, new Date("2030-01-07T23:00:00Z"))).enqueued, 2);
    const nextDay = world();
    assert.equal((await runWeeklySuggestions(nextDay.jobDeps, new Date("2030-01-08T17:00:00Z"))).due, 0);
  });

  test("Pacific/Auckland day boundary: Monday morning there is still Sunday in UTC", async () => {
    const w = world();
    w.admin.seed("emailSettings/alpha", { enabled: true, timeZone: "Pacific/Auckland" });
    w.admin.seed("emailSettings/beta", { enabled: false });
    // Sunday 2030-01-06 20:00Z is Monday 09:00 NZDT.
    assert.equal((await runWeeklySuggestions(w.jobDeps, new Date("2030-01-06T20:00:00Z"))).enqueued, 1);
    const tuesday = world();
    tuesday.admin.seed("emailSettings/alpha", { enabled: true, timeZone: "Pacific/Auckland" });
    // 2030-01-07 17:00Z is Tuesday 06:00 in Auckland, and Sunday 23:00 there is not yet due either.
    assert.equal((await runWeeklySuggestions(tuesday.jobDeps, MON_9_LA)).due, 1); // only beta (Los Angeles)
    const sunday = world();
    sunday.admin.seed("emailSettings/alpha", { enabled: true, timeZone: "Pacific/Auckland" });
    sunday.admin.seed("emailSettings/beta", { enabled: false });
    assert.equal((await runWeeklySuggestions(sunday.jobDeps, new Date("2030-01-06T10:00:00Z"))).due, 0);
  });

  test("invalid company zone falls back to the default; custom schedule is honored", async () => {
    const w = world({ config: { defaultTimeZone: "UTC" } });
    w.admin.seed("emailSettings/alpha", { enabled: true, timeZone: "Not/AZone" });
    w.admin.seed("emailSettings/beta", { enabled: false });
    // Monday 09:00 UTC.
    assert.equal((await runWeeklySuggestions(w.jobDeps, new Date("2030-01-07T09:00:00Z"))).enqueued, 1);
    const custom = world();
    custom.admin.seed("emailSettings/beta", { enabled: false });
    custom.admin.seed(suggestionPaths.schedule("alpha"), { weekday: 3, hour: 14 });
    assert.equal((await runWeeklySuggestions(custom.jobDeps, new Date("2030-01-07T17:00:00Z"))).due, 0);
    assert.equal((await runWeeklySuggestions(custom.jobDeps, new Date("2030-01-09T22:00:00Z"))).due, 1); // Wednesday 14:00 LA
  });
});

describe("weekly job: gates", () => {
  test("EMAIL_ENABLED off does nothing", async () => {
    const w = world({ config: { emailEnabled: false } });
    const summary = await runWeeklySuggestions(w.jobDeps, MON_9_LA);
    assert.deepEqual(summary, { companies: 0, due: 0, digests: 0, enqueued: 0, duplicates: 0, skipped: 0, failed: 0 });
    assert.equal(w.store.claimed, 0);
  });

  test("a short signing key logs config_incomplete and does nothing", async () => {
    const w = world({ config: { signingKey: "short" } });
    assert.equal((await runWeeklySuggestions(w.jobDeps, MON_9_LA)).companies, 0);
    assert.ok(w.logs.some(l => l.event === "suggestions.config_incomplete"));
  });

  test("company email off: not listed, no digest, no engine call", async () => {
    const w = world();
    w.admin.seed("emailSettings/alpha", { enabled: false, timeZone: "America/Los_Angeles" });
    w.admin.seed("emailSettings/beta", { enabled: false, timeZone: "America/Los_Angeles" });
    const summary = await runWeeklySuggestions(w.jobDeps, MON_9_LA);
    assert.equal(summary.companies, 0);
    assert.equal(w.jev!.calls.length + w.openai!.calls.length, 0);
    assert.equal(w.outbox.entries.size, 0);
  });

  test("AI off: due but nothing is built, ranked or enqueued", async () => {
    const w = world({ aiEnabled: false });
    const summary = await runWeeklySuggestions(w.jobDeps, MON_9_LA);
    assert.equal(summary.due, 2);
    assert.equal(summary.skipped, 2);
    assert.equal(summary.enqueued, 0);
    assert.equal(w.store.claimed, 0);
    assert.equal(w.jev!.calls.length, 0);
    assert.equal(w.outbox.entries.size, 0);
  });

  test("nobody opted in: no digest is built", async () => {
    const w = world();
    w.prefs.clear();
    const summary = await runWeeklySuggestions(w.jobDeps, MON_9_LA);
    assert.equal(summary.skipped, 2);
    assert.equal(w.store.claimed, 0);
    assert.equal(w.jev!.calls.length, 0);
  });

  test("only opted-in active admins get an email (not members, organizers or deactivated admins)", async () => {
    const w = world();
    w.prefs.set("admin2", { admin_suggestions: false });
    await runWeeklySuggestions(w.jobDeps, MON_9_LA);
    const recipients = [...w.outbox.entries.values()].map(e => `${e.companyId}:${e.uid}`).sort();
    assert.deepEqual(recipients, ["alpha:admin1", "beta:bo"]);
    for (const e of w.outbox.entries.values()) {
      assert.equal(e.template, "admin_suggestions");
      assert.equal(e.notAfter!.getTime(), MON_9_LA.getTime() + 2 * 86_400_000);
    }
    w.prefs.set("admin2", { admin_suggestions: true });
    w.now = MON_9_LA;
    const again = await runWeeklySuggestions(w.jobDeps, MON_9_LA);
    assert.equal(again.enqueued, 1); // admin2 only; the others are duplicates
    assert.equal(again.duplicates, 2);
  });
});

describe("weekly job: idempotency and concurrency", () => {
  test("two runs in the same week enqueue once per admin and build the digest once", async () => {
    const w = world();
    w.admin.seed("emailSettings/beta", { enabled: false });
    const first = await runWeeklySuggestions(w.jobDeps, MON_9_LA);
    const calls = w.jev!.calls.length;
    assert.ok(calls > 0);
    const second = await runWeeklySuggestions(w.jobDeps, new Date(MON_9_LA.getTime() + 3_600_000));
    assert.equal(first.enqueued, 1);
    assert.equal(second.enqueued, 0);
    assert.equal(second.duplicates, 1);
    assert.equal(w.store.claimed, 1);
    assert.equal(w.store.finished, 1);
    assert.equal(w.jev!.calls.length, calls);
    assert.equal(w.outbox.entries.size, 1);
    assert.match(outboxIds(w)[0]!, /^admin_suggestions_alpha-2030-W02_admin1_2030-W02$/);
  });

  test("concurrent runs: one builds, the other sees the live lease and skips; an expired lease is reclaimed", async () => {
    const w = world();
    w.admin.seed("emailSettings/beta", { enabled: false });
    const [a, b] = await Promise.all([runWeeklySuggestions(w.jobDeps, MON_9_LA), runWeeklySuggestions(w.jobDeps, MON_9_LA)]);
    assert.equal(a.enqueued + b.enqueued, 1);
    assert.equal(w.store.claimed, 1);

    const crashed = world();
    crashed.admin.seed("emailSettings/beta", { enabled: false });
    await crashed.store.claimDigest("alpha", "2030-W02", MON_9_LA, 5 * 60_000); // a crashed run holds the lease
    const busy = await runWeeklySuggestions(crashed.jobDeps, new Date(MON_9_LA.getTime() + 60_000));
    assert.equal(busy.skipped, 1);
    assert.equal(crashed.outbox.entries.size, 0);
    const reclaimed = await runWeeklySuggestions(crashed.jobDeps, new Date(MON_9_LA.getTime() + 6 * 60_000));
    assert.equal(reclaimed.enqueued, 1);
    assert.equal(crashed.store.claimed, 2);
  });

  test("one company failing does not stop the others", async () => {
    const w = world();
    const original = w.store.pastEvents.bind(w.store);
    w.store.pastEvents = async (companyId: string, now: Date) => {
      if (companyId === "alpha") throw new Error("boom");
      return original(companyId, now);
    };
    const summary = await runWeeklySuggestions(w.jobDeps, MON_9_LA);
    assert.equal(summary.failed, 1);
    assert.equal(summary.enqueued, 1);
    assert.deepEqual([...w.outbox.entries.values()].map(e => e.companyId), ["beta"]);
  });
});

describe("tenant isolation", () => {
  test("company A data never reaches company B's digest, engine state or email", async () => {
    const w = world();
    w.store.past.set("alpha", [alphaEvent("AlphaOnlyHike"), alphaEvent("AlphaOnlyHike two"), alphaEvent("AlphaOnlyHike three")]);
    const alpha = await getOrBuildDigest(w.build, "alpha", MON_9_LA, { timeZone: "America/Los_Angeles" });
    const beta = await getOrBuildDigest(w.build, "beta", MON_9_LA, { timeZone: "America/Los_Angeles" });
    assert.ok(alpha && beta);
    const alphaStates = w.jev!.calls.slice(0, w.jev!.calls.length).map(c => c.state);
    assert.ok(alphaStates.some(s => s.includes("AlphaOnlyHike")), "alpha's own titles are part of its state");
    assert.ok(!JSON.stringify(beta).includes("AlphaOnlyHike"));
    const betaStateCount = w.jev!.calls.filter(c => !c.state.includes("AlphaOnlyHike")).length;
    assert.ok(betaStateCount > 0, "beta was ranked from its own (empty) state");
    assert.equal(beta.dataLevel, "none");
    assert.notEqual(alpha.dataLevel, "none");
  });

  test("tokens are bound to their company in the generated variables", async () => {
    const w = world();
    await runWeeklySuggestions(w.jobDeps, MON_9_LA);
    for (const entry of w.outbox.entries.values()) {
      const vars = entry.variables as { ideas: Array<{ linkURL: string }> };
      for (const idea of vars.ideas) {
        const verified = verifySuggestionToken(KEY, new URL(idea.linkURL).searchParams.get("t"), Math.floor(MON_9_LA.getTime() / 1000));
        assert.ok(verified.ok && verified.companyId === entry.companyId);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Engines and budget
// ---------------------------------------------------------------------------------------------------------------------

describe("engines and budget", () => {
  const zone = { timeZone: "America/Los_Angeles" };

  test("Jev answers are used, the engine is recorded, spend is settled and not a generation", async () => {
    const w = world();
    const digest = await getOrBuildDigest(w.build, "alpha", MON_9_LA, zone);
    assert.equal(digest!.engine, "jev");
    assert.equal(w.openai!.calls.length, 0);
    const calls = w.jev!.calls.length;
    assert.ok(calls > 0);
    for (const c of w.jev!.calls) assert.equal(c.step, "draftCheck");
    const m = month(w)!;
    assert.equal(m.spentMicros, 34 * calls);
    assert.equal(m.inputTokens, JEV_USAGE.inputTokens * calls);
    assert.equal(m.generations, 0);
    assert.deepEqual(m.pending, {});
    assert.equal((m.days as Record<string, { spentMicros: number }>)["07"]!.spentMicros, 34 * calls);
    assert.ok(digest!.ideas.length >= 3);
  });

  test("Jev throws -> OpenAI; both throw -> heuristic", async () => {
    const a = world({ jev: port("fail") });
    const viaOpenai = await getOrBuildDigest(a.build, "alpha", MON_9_LA, zone);
    assert.equal(viaOpenai!.engine, "openai");
    assert.ok(month(a)!.spentMicros as number > 0);
    assert.deepEqual(month(a)!.pending, {});

    const b = world({ jev: port("fail"), openai: port("fail") });
    const heuristic = await getOrBuildDigest(b.build, "alpha", MON_9_LA, zone);
    assert.equal(heuristic!.engine, "heuristic");
    assert.ok(heuristic!.ideas.length >= 3);
    assert.deepEqual(month(b)!.pending, {});
    assert.equal(month(b)!.spentMicros, 0);
  });

  test("no engines configured -> heuristic without touching the budget", async () => {
    const w = world({ jev: null, openai: null });
    assert.equal((await getOrBuildDigest(w.build, "alpha", MON_9_LA, zone))!.engine, "heuristic");
    assert.equal(month(w), undefined);
  });

  test("budget refused -> heuristic, nothing called and nothing spent", async () => {
    const w = world();
    w.admin.seed("companies/alpha/aiSettings/current", { enabled: true, monthlyBudgetCents: 0 });
    const digest = await getOrBuildDigest(w.build, "alpha", MON_9_LA, zone);
    assert.equal(digest!.engine, "heuristic");
    assert.equal(w.jev!.calls.length + w.openai!.calls.length, 0);
    assert.equal(month(w), undefined);
  });

  test("daily budget too small for Jev's worst case but not for none: other pending reservations count", async () => {
    const w = world();
    // Another run holds nearly the whole daily budget in a live reservation.
    w.admin.seed(MONTH, { generations: 0, spentMicros: 0, inputTokens: 0, outputTokens: 0, days: {}, pending: {
      other: { uid: "u", micros: SETTINGS.dailyBudgetMicros, expiresAt: new Date(MON_9_LA.getTime() + 60_000) },
    } });
    assert.equal((await getOrBuildDigest(w.build, "alpha", MON_9_LA, zone))!.engine, "heuristic");
    assert.equal(w.jev!.calls.length, 0);
  });

  test("budget reserve/settle: pending key suggest_{weekKey} with uid system, removed on settle", async () => {
    const w = world();
    const budget = firestoreBudget(w.admin, SETTINGS);
    assert.equal(await budget.reserve("alpha", "suggest_2030-W02", 1000, MON_9_LA), true);
    const pending = month(w)!.pending as Record<string, { uid: string; micros: number }>;
    assert.equal(pending["suggest_2030-W02"]!.uid, "system");
    assert.equal(pending["suggest_2030-W02"]!.micros, 1000);
    await budget.settle("alpha", "suggest_2030-W02", 40, 800, 0, MON_9_LA);
    assert.deepEqual(month(w)!.pending, {});
    assert.equal(month(w)!.spentMicros, 40);
    assert.equal(month(w)!.generations, 0);
    // AI disabled for the company: refused, nothing written for beta.
    w.admin.seed("companies/beta/aiSettings/current", { enabled: false });
    assert.equal(await budget.reserve("beta", "suggest_2030-W02", 1, MON_9_LA), false);
    assert.equal(month(w, "beta"), undefined);
  });

  test("a failing engine mid-way still settles the spend of completed calls", async () => {
    let n = 0;
    const flaky: Port = {
      calls: [],
      async decide(request) {
        flaky.calls.push(request);
        n += 1;
        if (n === 2) throw new LlmUnavailableError(500);
        return decision(request, {}, JEV_USAGE);
      },
    };
    const w = world({ jev: flaky, openai: null });
    const digest = await getOrBuildDigest(w.build, "alpha", MON_9_LA, zone);
    if (flaky.calls.length >= 2) {
      assert.equal(digest!.engine, "heuristic");
      assert.equal(month(w)!.spentMicros, 34);
    } else {
      assert.equal(digest!.engine, "jev"); // a single chunk never reached the failing call
    }
    assert.deepEqual(month(w)!.pending, {});
  });

  test("logs carry ids, engine and counts but never titles", async () => {
    const w = world();
    w.store.past.set("alpha", [alphaEvent("AlphaOnlyHike")]);
    await getOrBuildDigest(w.build, "alpha", MON_9_LA, zone);
    const text = JSON.stringify(w.logs);
    assert.ok(text.includes("suggestions.digest_ready"));
    assert.ok(!text.includes("AlphaOnlyHike"));
    for (const idea of IDEA_CATALOG) assert.ok(!text.includes(idea.title), idea.title);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------------------------------------------------

describe("digestVariables", () => {
  test("pass validateVariables, links verify, unknown ids are dropped", async () => {
    const w = world();
    const digest = (await getOrBuildDigest(w.build, "alpha", MON_9_LA, { timeZone: "America/Los_Angeles" }))!;
    const withUnknown: StoredDigest = { ...digest, ideas: [{ ...digest.ideas[0]!, ideaId: "no-such-idea" }, ...digest.ideas] };
    const vars = digestVariables(withUnknown, { companyId: "alpha", signingKey: KEY, origin: ORIGIN, nowSeconds: Math.floor(MON_9_LA.getTime() / 1000) });
    assert.equal(vars.ideas.length, digest.ideas.length);
    assert.ok(validateVariables("admin_suggestions", vars) !== null);
    for (const idea of vars.ideas) {
      assert.ok(idea.linkURL.startsWith(`${ORIGIN}/admin/ideas/suggested/?t=`));
      const verified = verifySuggestionToken(KEY, new URL(idea.linkURL).searchParams.get("t"), Math.floor(MON_9_LA.getTime() / 1000));
      assert.ok(verified.ok);
      assert.deepEqual([verified.ok && verified.companyId, verified.ok && verified.weekKey, verified.ok && verified.ideaId], ["alpha", digest.weekKey, idea.ideaId]);
      assert.equal(idea.title, ideaById(idea.ideaId)!.title);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// manageSuggestionsEmailV1
// ---------------------------------------------------------------------------------------------------------------------

const req = (action: string, extra: Record<string, unknown> = {}) => ({ contractVersion: 1, companyId: "alpha", action, ...extra });

describe("manageSuggestionsEmail", () => {
  test("authorization: unauthenticated, non-admin roles and other tenants are denied", async () => {
    const w = world();
    await fails(manageSuggestionsEmail(w.manageDeps, null, req("status")), "unauthenticated", "UNAUTHENTICATED");
    await fails(manageSuggestionsEmail(w.manageDeps, caller("m1"), req("status")), "permission-denied", "INSUFFICIENT_ROLE");
    await fails(manageSuggestionsEmail(w.manageDeps, caller("org1"), req("preview")), "permission-denied", "INSUFFICIENT_ROLE");
    await fails(manageSuggestionsEmail(w.manageDeps, caller("bo"), req("status")), "permission-denied", "COMPANY_MISMATCH");
    await fails(manageSuggestionsEmail(w.manageDeps, caller("bo"), req("setSchedule", { schedule: { weekday: 2, hour: 8 } })), "permission-denied", "COMPANY_MISMATCH");
    await fails(manageSuggestionsEmail(w.manageDeps, caller("deadadmin"), req("status")), "permission-denied", "ACCOUNT_DEACTIVATED");
    assert.equal(w.store.claimed, 0);
    assert.equal(w.admin.get(suggestionPaths.schedule("alpha")), undefined);
  });

  test("strict request validation", async () => {
    const w = world();
    const admin = caller("admin1");
    await assert.rejects(manageSuggestionsEmail(w.manageDeps, admin, { ...req("status"), extra: 1 }), (e: unknown) => e instanceof AdminError && e.reason === "VALIDATION_FAILED");
    await assert.rejects(manageSuggestionsEmail(w.manageDeps, admin, req("explode")), (e: unknown) => e instanceof AdminError && e.reason === "VALIDATION_FAILED");
    await assert.rejects(manageSuggestionsEmail(w.manageDeps, admin, { ...req("status"), companyId: "../x" }), (e: unknown) => e instanceof AdminError && e.reason === "VALIDATION_FAILED");
    await assert.rejects(manageSuggestionsEmail(w.manageDeps, admin, req("setSchedule")), (e: unknown) => e instanceof AdminError && e.fields.includes("schedule"));
    await assert.rejects(manageSuggestionsEmail(w.manageDeps, admin, req("status", { schedule: { weekday: 1, hour: 9 } })), (e: unknown) => e instanceof AdminError && e.fields.includes("schedule"));
    for (const schedule of [{ weekday: 0, hour: 9 }, { weekday: 8, hour: 9 }, { weekday: 1, hour: 24 }, { weekday: 1, hour: -1 }, { weekday: 1.5, hour: 9 }, { weekday: 1 }]) {
      await assert.rejects(manageSuggestionsEmail(w.manageDeps, admin, req("setSchedule", { schedule })), (e: unknown) => e instanceof AdminError && e.reason === "VALIDATION_FAILED", JSON.stringify(schedule));
    }
    assert.equal(w.admin.get(suggestionPaths.schedule("alpha")), undefined);
  });

  test("status shape and nextSendAt", async () => {
    const w = world();
    const status = await manageSuggestionsEmail(w.manageDeps, caller("admin1"), req("status"));
    assert.deepEqual(status, {
      contractVersion: 1, subscribed: true, emailEnabled: true, aiEnabled: true, schedule: DEFAULT_SCHEDULE, timeZone: "America/Los_Angeles",
      nextSendAt: "2030-01-07T17:00:00.000Z",
    });
    const other = await manageSuggestionsEmail(w.manageDeps, caller("admin2"), req("status"));
    assert.equal(other.subscribed, false);
    w.admin.seed("companies/alpha/aiSettings/current", { enabled: false });
    const off = await manageSuggestionsEmail(w.manageDeps, caller("admin1"), req("status"));
    assert.deepEqual([off.aiEnabled, off.nextSendAt], [false, null]);
    w.admin.seed("companies/alpha/aiSettings/current", { enabled: true });
    w.manageDeps.config = { ...w.config, emailEnabled: false };
    const noEmail = await manageSuggestionsEmail(w.manageDeps, caller("admin1"), req("status"));
    assert.deepEqual([noEmail.emailEnabled, noEmail.nextSendAt], [false, null]);
  });

  test("nextSendAt handles zones, the current hour and week wrap", () => {
    assert.equal(nextSendAt(new Date("2030-01-07T17:00:00Z"), { weekday: 1, hour: 9 }, "America/Los_Angeles"), "2030-01-14T17:00:00.000Z");
    assert.equal(nextSendAt(new Date("2030-01-07T16:59:00Z"), { weekday: 1, hour: 9 }, "America/Los_Angeles"), "2030-01-07T17:00:00.000Z");
    assert.equal(nextSendAt(new Date("2030-01-02T12:00:00Z"), { weekday: 1, hour: 9 }, "Pacific/Auckland"), "2030-01-06T20:00:00.000Z");
  });

  test("subscribe / unsubscribe write the caller's own email preference", async () => {
    const w = world();
    const on = await manageSuggestionsEmail(w.manageDeps, caller("admin2"), req("subscribe"));
    assert.equal(on.subscribed, true);
    assert.deepEqual(w.prefs.get("admin2"), { admin_suggestions: true });
    const off = await manageSuggestionsEmail(w.manageDeps, caller("admin2"), req("unsubscribe"));
    assert.equal(off.subscribed, false);
    assert.deepEqual(w.prefs.get("admin2"), { admin_suggestions: false });
  });

  test("setSchedule writes the schedule doc and an audit entry, then reports the new next send", async () => {
    const w = world();
    const result = await manageSuggestionsEmail(w.manageDeps, caller("admin1"), req("setSchedule", { schedule: { weekday: 3, hour: 14 } }));
    assert.deepEqual(result.schedule, { weekday: 3, hour: 14 });
    assert.equal(result.nextSendAt, "2030-01-02T22:00:00.000Z");
    const doc = w.admin.get(suggestionPaths.schedule("alpha"))!;
    assert.deepEqual([doc.weekday, doc.hour, doc.updatedBy], [3, 14, "admin1"]);
    const audits = w.admin.children("companies/alpha/auditLog");
    assert.equal(audits.length, 1);
    assert.equal(audits[0]!.data.action, "suggestions.setSchedule");
    // A second change updates the same document.
    await manageSuggestionsEmail(w.manageDeps, caller("admin2"), req("setSchedule", { schedule: { weekday: 5, hour: 8 } }));
    assert.deepEqual(w.admin.get(suggestionPaths.schedule("alpha"))!.weekday, 5);
    assert.equal(w.admin.get(suggestionPaths.schedule("beta")), undefined);
  });

  test("preview is a dry run: renders, enqueues nothing, requires AI", async () => {
    const w = world();
    const result = await manageSuggestionsEmail(w.manageDeps, caller("admin1"), req("preview"));
    const preview = result.preview!;
    assert.ok(preview.subject.length > 0 && preview.html.includes("<html") && preview.text.length > 0);
    assert.equal(preview.engine, "jev");
    assert.ok(preview.ideaCount >= 3);
    assert.ok(preview.html.includes(`${ORIGIN}/admin/ideas/suggested/?t=`));
    assert.ok(preview.html.includes(`${ORIGIN}/admin/suggestions/`));
    assert.equal(w.outbox.entries.size, 0);
    // A second preview reuses the week's digest.
    const calls = w.jev!.calls.length;
    await manageSuggestionsEmail(w.manageDeps, caller("admin1"), req("preview"));
    assert.equal(w.jev!.calls.length, calls);
    assert.equal(w.store.claimed, 1);

    const off = world({ aiEnabled: false });
    await fails(manageSuggestionsEmail(off.manageDeps, caller("admin1"), req("preview")), "failed-precondition", "AI_DISABLED");
    const noKey = world({ config: { signingKey: "" } });
    await fails(manageSuggestionsEmail(noKey.manageDeps, caller("admin1"), req("preview")), "failed-precondition", "AI_UNAVAILABLE");
  });

  test("a queued test email is audited once per hour; refused and duplicate tests write nothing", async () => {
    const w = world();
    await manageSuggestionsEmail(w.manageDeps, caller("admin2"), req("sendTest"));
    assert.equal(w.admin.children("companies/alpha/auditLog").length, 0, "not subscribed: nothing queued, nothing recorded");
    await fails(manageSuggestionsEmail(w.manageDeps, caller("bo"), req("sendTest")), "permission-denied", "COMPANY_MISMATCH");
    await fails(manageSuggestionsEmail(w.manageDeps, caller("m1"), req("sendTest")), "permission-denied", "INSUFFICIENT_ROLE");
    assert.equal(w.admin.children("companies/alpha/auditLog").length + w.admin.children("companies/beta/auditLog").length, 0);
    await manageSuggestionsEmail(w.manageDeps, caller("admin1"), req("sendTest"));
    await manageSuggestionsEmail(w.manageDeps, caller("admin1"), req("sendTest"));
    const audits = w.admin.children("companies/alpha/auditLog");
    assert.equal(audits.length, 1);
    assert.equal(audits[0]!.data.action, "suggestions.sendTest");
    assert.equal(audits[0]!.data.actorId, "admin1");
    assert.equal(audits[0]!.data.companyId, "alpha");
    assert.ok(!JSON.stringify(audits[0]!.data).includes("@"), "no address in the entry");
    w.now = new Date(NOW.getTime() + 3_600_000);
    await manageSuggestionsEmail(w.manageDeps, caller("admin1"), req("sendTest"));
    assert.equal(w.admin.children("companies/alpha/auditLog").length, 2);
  });

  test("sendTest reasons and the one-per-hour limit", async () => {
    const disabled = world({ config: { emailEnabled: false } });
    assert.deepEqual(pick(await manageSuggestionsEmail(disabled.manageDeps, caller("admin1"), req("sendTest"))), [false, "EMAIL_DISABLED"]);

    const company = world();
    company.admin.seed("emailSettings/alpha", { enabled: false });
    assert.deepEqual(pick(await manageSuggestionsEmail(company.manageDeps, caller("admin1"), req("sendTest"))), [false, "COMPANY_EMAIL_DISABLED"]);

    const w = world();
    assert.deepEqual(pick(await manageSuggestionsEmail(w.manageDeps, caller("admin2"), req("sendTest"))), [false, "NOT_SUBSCRIBED"]);
    assert.equal(w.store.claimed, 0);

    const first = await manageSuggestionsEmail(w.manageDeps, caller("admin1"), req("sendTest"));
    assert.deepEqual(pick(first), [true, undefined]);
    assert.equal(w.outbox.entries.size, 1);
    const entry = [...w.outbox.entries.values()][0]!;
    assert.deepEqual([entry.uid, entry.companyId, entry.template], ["admin1", "alpha", "admin_suggestions"]);
    assert.match(entry.id, /^admin_suggestions_alpha-2030-W01-test_admin1_test-2030010212$/);

    const second = await manageSuggestionsEmail(w.manageDeps, caller("admin1"), req("sendTest"));
    assert.deepEqual(pick(second), [false, "TEST_LIMIT"]);
    assert.equal(w.outbox.entries.size, 1);

    w.now = new Date(NOW.getTime() + 3_600_000);
    assert.deepEqual(pick(await manageSuggestionsEmail(w.manageDeps, caller("admin1"), req("sendTest"))), [true, undefined]);
    assert.equal(w.outbox.entries.size, 2);

    const ai = world({ aiEnabled: false });
    await fails(manageSuggestionsEmail(ai.manageDeps, caller("admin1"), req("sendTest")), "failed-precondition", "AI_DISABLED");
  });
});

function pick(r: { testQueued?: boolean; testReason?: string }) { return [r.testQueued, r.testReason]; }

// ---------------------------------------------------------------------------------------------------------------------
// resolveSuggestedIdeaV1
// ---------------------------------------------------------------------------------------------------------------------

describe("resolveSuggestedIdea", () => {
  const nowSeconds = Math.floor(NOW.getTime() / 1000);
  const idea = IDEA_CATALOG[0]!;
  const token = (claims: { companyId?: string; ideaId?: string; weekKey?: string } = {}, at = nowSeconds) =>
    signSuggestionToken(KEY, { companyId: "alpha", weekKey: "2030-W01", ideaId: idea.id, ...claims }, at);
  const call = (w: World, who: string, t: string, companyId = "alpha") =>
    resolveSuggestedIdea(w.resolveDeps, caller(who), { contractVersion: 1, companyId, token: t });

  test("valid link returns a draft within the GeneratedEventDraft limits", async () => {
    const w = world();
    const result = await call(w, "admin1", token());
    assert.equal(result.contractVersion, 1);
    assert.equal(result.ideaId, idea.id);
    const d = result.draft;
    assert.ok(d.title.length >= 1 && d.title.length <= 120);
    assert.ok(d.description.length >= 1 && d.description.length <= 2000);
    assert.ok(d.tagIds.length >= 1 && d.tagIds.length <= 5);
    assert.match(d.coverImageURL, /^catalog:\/\/default\/[a-z]+$/);
    assert.ok(d.durationMinutes >= 15 && d.durationMinutes <= 720);
    assert.ok(d.capacity >= 1 && d.capacity <= 10000);
    assert.ok(d.rationale.length >= 1 && d.rationale.length <= 160);
    assert.ok(d.costCents >= 0 && d.costCents <= 100000 && d.costNote.length <= 200 && d.venueSearchHint.length <= 120);
  });

  test("uses the first reason of that week's digest and the member count when the digest exists", async () => {
    const w = world();
    const digest = (await getOrBuildDigest(w.build, "alpha", MON_9_LA, { timeZone: "America/Los_Angeles" }))!;
    const ranked = digest.ideas.find(i => i.reasons.length > 0);
    assert.ok(ranked, "at least one ranked idea has a reason");
    const result = await call(w, "admin1", token({ ideaId: ranked.ideaId, weekKey: digest.weekKey }));
    assert.equal(result.draft.rationale.startsWith(ranked.reasons[0]!.slice(0, 40)), true);
    assert.ok(result.draft.capacity <= (digest.memberCount ?? 10000));
  });

  test("tampered, malformed and expired tokens are rejected", async () => {
    const w = world();
    const good = token();
    const flipped = `${good.slice(0, -2)}${good.endsWith("AA") ? "BB" : "AA"}`;
    for (const bad of [flipped, "garbage", `x${good}`, ""]) {
      await assert.rejects(call(w, "admin1", bad), (e: unknown) => e instanceof AdminError && e.code === "invalid-argument" && e.reason === "VALIDATION_FAILED" && e.fields.includes("token"), bad);
    }
    const mac = good.split(".")[1]!;
    const forged = Buffer.from(JSON.stringify({ v: 1, c: "beta", w: "2030-W01", i: idea.id, e: nowSeconds + 1000 })).toString("base64url");
    await assert.rejects(call(w, "admin1", `${forged}.${mac}`), (e: unknown) => e instanceof AdminError && e.reason === "VALIDATION_FAILED");
    await fails(call(w, "admin1", token({}, nowSeconds - 31 * 86_400)), "failed-precondition", "VALIDATION_FAILED");
    await assert.rejects(call(w, "admin1", token({}, nowSeconds - 31 * 86_400)), (e: unknown) => e instanceof AdminError && /expired/i.test(e.message));
  });

  test("unknown idea id is an invalid token", async () => {
    const w = world();
    await assert.rejects(call(w, "admin1", token({ ideaId: "no-such-idea" })), (e: unknown) => e instanceof AdminError && e.reason === "VALIDATION_FAILED" && e.fields.includes("token"));
  });

  test("tenant isolation and roles: a token of A used by an admin of B, or by a non-admin, is denied", async () => {
    const w = world();
    await fails(call(w, "bo", token()), "permission-denied", "COMPANY_MISMATCH");
    await fails(call(w, "bo", token(), "beta"), "permission-denied", "COMPANY_MISMATCH");
    await fails(call(w, "bo", token({ companyId: "beta" })), "permission-denied", "COMPANY_MISMATCH");
    await fails(call(w, "org1", token()), "permission-denied", "INSUFFICIENT_ROLE");
    await fails(call(w, "m1", token()), "permission-denied", "INSUFFICIENT_ROLE");
    await fails(resolveSuggestedIdea(w.resolveDeps, null, { contractVersion: 1, companyId: "alpha", token: token() }), "unauthenticated", "UNAUTHENTICATED");
    await fails(resolveSuggestedIdea({ ...w.resolveDeps, signingKey: "" }, caller("admin1"), { contractVersion: 1, companyId: "alpha", token: token() }), "failed-precondition", "AI_UNAVAILABLE");
  });
});
