import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";
import { AdminError } from "../../functions/src/modules/admin/domain/errors";
import { FirestoreAdminStore } from "../../functions/src/modules/admin/infrastructure/firestoreAdminStore";
import type { Caller } from "../../functions/src/modules/admin/application/ports";
import { getEventIdeaContext } from "../../functions/src/modules/ai/application/context";
import { generateEventDrafts } from "../../functions/src/modules/ai/application/generate";
import type { AiDeps, AiSettings } from "../../functions/src/modules/ai/application/ports";
import { monthKey, dayKey } from "../../functions/src/modules/ai/domain/paths";
import { ScriptedLlm, type ScriptStep } from "../../functions/src/modules/ai/infrastructure/fakeLlm";
import {
  DEFAULT_TAGS, FirestoreInterestSource, FirestoreTagCatalog, FirestoreThemeSource,
} from "../../functions/src/modules/ai/infrastructure/firestoreSources";
import { SETTINGS, drafts, request, uuid } from "../unit/helpers/aiFakes";

// Emulator-backed test of the AI event-draft usage accounting against the real Firestore adapter: concurrent reservations
// serialize on the month document, idempotent replay, Timestamp round trips and the Firestore-backed interest, tag and
// theme sources. The LLM is always scripted; nothing here can reach a real provider.
//
// Run: npm run test:ai:integration

const PROJECT = "demo-dip";
const HOST = process.env.FIRESTORE_EMULATOR_HOST;
if (!["127.0.0.1:8080", "127.0.0.1:18080"].includes(HOST ?? "")) throw new Error("Expected a local test emulator.");
if ((process.env.GCLOUD_PROJECT ?? PROJECT) !== PROJECT) throw new Error(`Refusing to run outside project ${PROJECT}.`);
process.env.GCLOUD_PROJECT = PROJECT;

const functionsRequire = createRequire(require.resolve("../../functions/package.json"));
const { initializeApp, deleteApp, getApps } = functionsRequire("firebase-admin/app") as typeof import("firebase-admin/app");
const { getFirestore, Timestamp } = functionsRequire("firebase-admin/firestore") as typeof import("firebase-admin/firestore");

let app: ReturnType<typeof initializeApp>;
let db: ReturnType<typeof getFirestore>;

const asUser = (uid: string): Caller => ({ uid, emailVerified: true, signInProvider: "google.com" });
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const slowDrafts = (ms = 200): ScriptStep => async () => { await sleep(ms); return drafts(3); };
const ADMINS = Array.from({ length: 8 }, (_, i) => `ai-admin${i + 1}`);

async function reason(promise: Promise<unknown>): Promise<string> {
  try { await promise; } catch (error) { return error instanceof AdminError ? error.reason : `UNEXPECTED ${String(error)}`; }
  return "OK";
}

function makeDeps(steps: ScriptStep[], settings: Partial<AiSettings> = {}): AiDeps & { llm: ScriptedLlm } {
  const llm = new ScriptedLlm(steps);
  return {
    store: new FirestoreAdminStore(db), llm, interests: new FirestoreInterestSource(db), catalog: new FirestoreTagCatalog(db),
    themes: new FirestoreThemeSource(db), settings: { ...SETTINGS, ...settings }, now: () => new Date(),
  };
}

const profile = (companyId: string, role: string, name: string) => ({
  companyId, role, displayName: name, email: `${name.toLowerCase().replace(/\s+/g, ".")}@${companyId}.test`, photoURL: "", avatarId: "a1", department: "Eng",
  jobTitle: "", city: "", interestTagIds: [], travelRadiusMiles: 20, availability: [], friendIds: [], favoritePhotoIds: [], pointsBalance: 0, createdAt: Timestamp.now(),
});

before(() => {
  app = getApps()[0] ?? initializeApp({ projectId: PROJECT });
  db = getFirestore(app);
});
after(async () => { await deleteApp(app); });

beforeEach(async () => {
  const response = await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  assert.ok(response.ok, `emulator reset failed: ${response.status}`);
  await db.doc("companies/alpha").set({ name: "Alpha", emailDomain: "alpha.test" });
  await db.doc("companies/alpha/aiSettings/current").set({ enabled: true });
  for (const uid of ADMINS) await db.doc(`users/${uid}`).set(profile("alpha", "admin", uid));
});

const monthPath = () => `companies/alpha/aiUsage/${monthKey(new Date())}`;
const dayPath = (uid: string) => `companies/alpha/aiUsageDaily/${dayKey(new Date())}_${uid}`;

describe("reservations against the real Firestore adapter", () => {
  test("monthly limit 3, 8 parallel admins: exactly 3 succeed, the rest AI_MONTHLY_LIMIT, counters exact", async () => {
    const deps = makeDeps(Array.from({ length: 8 }, () => slowDrafts()), { monthlyGenerationLimit: 3 });
    const outcomes = await Promise.all(ADMINS.map((uid, i) => reason(generateEventDrafts(deps, asUser(uid), request(100 + i)))));
    assert.equal(outcomes.filter(o => o === "OK").length, 3, outcomes.join(","));
    assert.deepEqual([...new Set(outcomes.filter(o => o !== "OK"))], ["AI_MONTHLY_LIMIT"]);
    assert.equal(deps.llm.calls.length, 3, "the provider is only called for reserved requests");
    const month = (await db.doc(monthPath()).get()).data()!;
    assert.equal(month.generations, 3);
    assert.deepEqual(month.pending, {});
    assert.ok(month.spentMicros > 0);
    const used = await Promise.all(ADMINS.map(async uid => (await db.doc(dayPath(uid)).get()).data()?.generations ?? 0));
    assert.equal(used.reduce((a: number, b: number) => a + b, 0), 3);
    const audit = await db.collection("companies/alpha/auditLog").get();
    assert.equal(audit.size, 3, "denied attempts write no audit entry");
    const requests = await db.collection("companies/alpha/aiRequests").get();
    assert.equal(requests.size, 3);
    assert.ok(requests.docs.every(d => d.get("status") === "done"));
  });

  test("the budget serializes as well: a budget for two worst cases admits two parallel calls", async () => {
    const { worstCaseMicros } = await import("../../functions/src/modules/ai/domain/pricing");
    const deps = makeDeps(Array.from({ length: 5 }, () => slowDrafts(2500)), { monthlyBudgetMicros: worstCaseMicros(SETTINGS) * 2, monthlyGenerationLimit: 50 });
    const outcomes = await Promise.all(ADMINS.slice(0, 5).map((uid, i) => reason(generateEventDrafts(deps, asUser(uid), request(200 + i)))));
    assert.equal(outcomes.filter(o => o === "OK").length, 2, outcomes.join(","));
    assert.deepEqual([...new Set(outcomes.filter(o => o !== "OK"))], ["AI_BUDGET_EXHAUSTED"]);
    assert.deepEqual((await db.doc(monthPath()).get()).data()!.pending, {});
  });

  test("the same requestId fired twice in parallel: one runs, the other is refused or replays; one generation counted", async () => {
    const deps = makeDeps([slowDrafts(300), slowDrafts(300)]);
    const [a, b] = await Promise.allSettled([
      generateEventDrafts(deps, asUser(ADMINS[0]!), request(300)),
      generateEventDrafts(deps, asUser(ADMINS[0]!), request(300)),
    ]);
    const ok = [a, b].filter(x => x.status === "fulfilled");
    const refused = [a, b].flatMap(x => (x.status === "rejected" ? [x.reason] : []));
    assert.equal(ok.length + refused.length, 2);
    assert.ok(ok.length >= 1, "one call succeeds");
    for (const error of refused) { assert.ok(error instanceof AdminError); assert.equal(error.reason, "REQUEST_IN_PROGRESS"); }
    if (ok.length === 2) assert.ok(ok.some(x => x.status === "fulfilled" && x.value.replay), "a second success must be a replay");
    assert.equal(deps.llm.calls.length, 1, "exactly one provider call");
    const month = (await db.doc(monthPath()).get()).data()!;
    assert.equal(month.generations, 1);
    assert.deepEqual(month.pending, {});
    assert.equal((await db.doc(dayPath(ADMINS[0]!)).get()).data()!.generations, 1);
  });

  test("a live reservation is a Timestamp in Firestore and the stored replay survives a fresh store instance", async () => {
    let midFlight: Record<string, any> | undefined;
    const peek: ScriptStep = async () => { midFlight = (await db.doc(monthPath()).get()).data(); return drafts(3); };
    const first = makeDeps([peek]);
    const before = Date.now();
    const done = await generateEventDrafts(first, asUser(ADMINS[0]!), request(400));
    const key = `${ADMINS[0]}_${uuid(400)}`;
    const reservation = midFlight?.pending?.[key];
    assert.ok(reservation, "reservation present while the model runs");
    assert.ok(reservation.expiresAt instanceof Timestamp);
    assert.ok(reservation.expiresAt.toMillis() > before + 60_000, "expires in the future");
    assert.equal(reservation.uid, ADMINS[0]);

    const fresh = makeDeps([]);
    const replay = await generateEventDrafts(fresh, asUser(ADMINS[0]!), request(400));
    assert.equal(replay.replay, true);
    assert.deepEqual(replay.drafts, done.drafts);
    assert.equal(fresh.llm.calls.length, 0);
    assert.equal((await db.doc(monthPath()).get()).data()!.generations, 1);
  });

  test("an expired reservation stored as a Timestamp is ignored and a live one is honored", async () => {
    await db.doc(monthPath()).set({
      generations: 0, spentMicros: 0,
      pending: { stale_x: { uid: "ai-admin2", micros: 1, expiresAt: Timestamp.fromMillis(Date.now() - 1000) } },
    });
    const deps = makeDeps([drafts(3)], { monthlyGenerationLimit: 1 });
    assert.equal(await reason(generateEventDrafts(deps, asUser(ADMINS[0]!), request(500))), "OK");

    await db.doc(monthPath()).update({ generations: 0, pending: { live_x: { uid: "ai-admin2", micros: 1, expiresAt: Timestamp.fromMillis(Date.now() + 60_000) } } });
    const blocked = makeDeps([drafts(3)], { monthlyGenerationLimit: 1 });
    assert.equal(await reason(generateEventDrafts(blocked, asUser(ADMINS[1]!), request(501))), "AI_MONTHLY_LIMIT");
    assert.equal(blocked.llm.calls.length, 0);
  });

  test("auth denial writes nothing", async () => {
    await db.doc("users/ai-member").set(profile("alpha", "member", "Plain Member"));
    await db.doc("companies/beta").set({ name: "Beta", emailDomain: "beta.test" });
    await db.doc("users/ai-beta-admin").set(profile("beta", "admin", "Beta Admin"));
    const deps = makeDeps([drafts(3)]);
    assert.equal(await reason(generateEventDrafts(deps, asUser("ai-member"), request(600))), "INSUFFICIENT_ROLE");
    assert.equal(await reason(generateEventDrafts(deps, asUser("ai-beta-admin"), request(601))), "COMPANY_MISMATCH");
    assert.equal(deps.llm.calls.length, 0);
    for (const c of ["aiUsage", "aiUsageDaily", "aiRequests", "auditLog"]) assert.equal((await db.collection(`companies/alpha/${c}`).get()).size, 0, c);
  });

  test("context against the real store reports remaining quota", async () => {
    const deps = makeDeps([drafts(3)], { monthlyGenerationLimit: 4 });
    await generateEventDrafts(deps, asUser(ADMINS[0]!), request(700));
    const context = await getEventIdeaContext(deps, asUser(ADMINS[0]!), { contractVersion: 1, companyId: "alpha" });
    assert.equal(context.enabled, true);
    assert.equal(context.usage.monthlyGenerationsUsed, 1);
    assert.equal(context.usage.generationsRemaining, 2);
    assert.equal(context.interestDataAvailable, false);
  });
});

describe("Firestore sources", () => {
  test("tagStats -> countsFor; empty -> null; invalid counts are skipped; other companies are not read", async () => {
    const source = new FirestoreInterestSource(db);
    assert.equal(await source.countsFor("alpha"), null);
    await db.doc("companies/alpha/tagStats/tag-games").set({ memberCount: 25 });
    await db.doc("companies/alpha/tagStats/tag-music").set({ memberCount: 4 });
    await db.doc("companies/alpha/tagStats/tag-bad").set({ memberCount: "many" });
    await db.doc("companies/alpha/tagStats/tag-neg").set({ memberCount: -1 });
    await db.doc("companies/beta/tagStats/tag-chill").set({ memberCount: 99 });
    const stats = (await source.countsFor("alpha"))!.sort((x, y) => (x.tagId < y.tagId ? -1 : 1));
    assert.deepEqual(stats, [{ tagId: "tag-games", memberCount: 25 }, { tagId: "tag-music", memberCount: 4 }]);
    assert.deepEqual(await source.countsFor("beta"), [{ tagId: "tag-chill", memberCount: 99 }]);
  });

  test("tag catalog: sortOrder then id, names trimmed, DEFAULT_TAGS fallback, cached", async () => {
    assert.deepEqual(await new FirestoreTagCatalog(db).list(), DEFAULT_TAGS);
    await db.doc("tags/b").set({ name: " Beta ", sortOrder: 1 });
    await db.doc("tags/a").set({ name: "Alpha", sortOrder: 1 });
    await db.doc("tags/z").set({ name: "Zed", sortOrder: 0 });
    await db.doc("tags/n").set({ name: "", sortOrder: 5 });
    await db.doc("tags/u").set({ name: "Unsorted" });
    let clock = 1_000;
    const catalog = new FirestoreTagCatalog(db, () => clock);
    assert.deepEqual(await catalog.list(), [
      { id: "z", name: "Zed" }, { id: "a", name: "Alpha" }, { id: "b", name: "Beta" }, { id: "n", name: "n" }, { id: "u", name: "Unsorted" },
    ]);
    await db.doc("tags/y").set({ name: "Late", sortOrder: -1 });
    clock += 60_000;
    assert.equal((await catalog.list()).length, 5, "cached within the TTL");
    clock += 11 * 60_000;
    assert.equal((await catalog.list())[0]!.id, "y", "refreshed after the TTL");
  });

  test("weekly theme: the one running now; ignores future, ended, non-weekly and other companies", async () => {
    const now = new Date();
    const hours = (h: number) => Timestamp.fromMillis(now.getTime() + h * 3_600_000);
    const challenge = (extra: Record<string, unknown>) => ({ companyId: "alpha", type: "weekly", title: "Walk week", tagIds: ["tag-outdoors"], startDate: hours(-24), endDate: hours(24), ...extra });
    await db.doc("companies/alpha/challenges/ended").set(challenge({ title: "Old", endDate: hours(-1) }));
    await db.doc("companies/alpha/challenges/future").set(challenge({ title: "Next", startDate: hours(1), endDate: hours(100) }));
    await db.doc("companies/alpha/challenges/monthly").set(challenge({ title: "Monthly", type: "monthly" }));
    await db.doc("companies/beta/challenges/other").set(challenge({ title: "Beta theme", companyId: "beta" }));
    const themes = new FirestoreThemeSource(db);
    assert.equal(await themes.current("alpha", now), null);
    await db.doc("companies/alpha/challenges/now").set(challenge({ title: "  Cook-off week  ", tagIds: ["tag-cooking", 7, "tag-food"] }));
    assert.deepEqual(await themes.current("alpha", now), { title: "Cook-off week", tagIds: ["tag-cooking", "tag-food"] });
    assert.equal(await themes.current("alpha", new Date(now.getTime() + 200 * 3_600_000)), null, "past the end of the running theme");
  });

  test("all three sources feed the context call end to end", async () => {
    await db.doc("companies/alpha/tagStats/tag-games").set({ memberCount: 12 });
    await db.doc("companies/alpha/tagStats/tag-music").set({ memberCount: 2 });
    const now = new Date();
    await db.doc("companies/alpha/challenges/w").set({
      companyId: "alpha", type: "weekly", title: "Game week", tagIds: ["tag-games", "tag-bogus"],
      startDate: Timestamp.fromMillis(now.getTime() - 3_600_000), endDate: Timestamp.fromMillis(now.getTime() + 3_600_000),
    });
    const context = await getEventIdeaContext(makeDeps([]), asUser(ADMINS[0]!), { contractVersion: 1, companyId: "alpha" });
    assert.equal(context.interestDataAvailable, true);
    assert.deepEqual(context.topInterests, [{ tagId: "tag-games", bucket: "10-19" }]);
    assert.ok(context.thinInterestTagIds.includes("tag-music"));
    assert.deepEqual(context.currentTheme, { title: "Game week", tagIds: ["tag-games"] });
  });
});
