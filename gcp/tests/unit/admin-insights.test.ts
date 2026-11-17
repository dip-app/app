import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, mock, test } from "node:test";
import { getCompanyInsights } from "../../functions/src/modules/admin/application/insights";
import type { Filter, QuerySource } from "../../functions/src/modules/admin/application/ports";
import { AdminError, errorDiagnostics } from "../../functions/src/modules/admin/domain/errors";
import { handleAdminCommand } from "../../functions/src/modules/admin/transport/adminCallables";
import {
  CACHE_TTL_MS, attendanceRate, cacheAge, cacheUsable, dayBuckets, distinctStrings, monthBounds,
} from "../../functions/src/modules/admin/domain/insights";
import { NOW, caller, makeDeps, seedCompany, type FakeAdminStore } from "./helpers/adminFakes";

// firebase-functions is a dependency of the functions workspace only; resolve the same instance the module under test uses.
const { logger } = createRequire(`${__dirname}/../../functions/package.json`)("firebase-functions/v2") as typeof import("firebase-functions/v2");

const base = { contractVersion: 1, companyId: "alpha" };
const day = (offset: number, hour = 9) => new Date(Date.UTC(2030, 0, 2 + offset, hour));

async function fails(promise: Promise<unknown>, code: string, reason: string) {
  await assert.rejects(promise, (e: unknown) => { assert.ok(e instanceof AdminError, String(e)); assert.equal(e.code, code); assert.equal(e.reason, reason); return true; });
}

function seedActivity(store: FakeAdminStore) {
  seedCompany(store);
  store.seed("companies/alpha/roster/r1", { companyId: "alpha", email: "x@alpha.test", status: "invited" });
  store.seed("companies/alpha/roster/r2", { companyId: "alpha", email: "y@alpha.test", status: "claimed" });
  // RSVPs: two today, one yesterday, one 40 days ago (outside the window); another company's must never count.
  store.seed("companies/alpha/events/live/rsvps/m1", { companyId: "alpha", userId: "m1", status: "going", checkedIn: true, createdAt: day(0, 8) });
  store.seed("companies/alpha/events/live/rsvps/m2", { companyId: "alpha", userId: "m2", status: "going", checkedIn: false, createdAt: day(0, 9) });
  store.seed("companies/alpha/events/soon/rsvps/m1", { companyId: "alpha", userId: "m1", status: "going", checkedIn: false, createdAt: day(-1) });
  store.seed("companies/alpha/events/soon/rsvps/m3", { companyId: "alpha", userId: "m3", status: "going", checkedIn: false, createdAt: day(-40) });
  store.seed("companies/beta/events/bevent/rsvps/bea", { companyId: "beta", userId: "bea", status: "going", checkedIn: false, createdAt: day(0) });
  store.seed("companies/alpha/events/live/photos/m1_0", { companyId: "alpha", createdAt: day(-1) });
  store.seed("companies/alpha/events/live/photos/m1_0/comments/c1", { companyId: "alpha", createdAt: day(-2) });
  store.seed("companies/alpha/events/live/photos/m1_0/comments/c2", { companyId: "alpha", createdAt: day(-60) });
  store.seed("companies/beta/events/bevent/photos/bea_0", { companyId: "beta", createdAt: day(0) });
  // A completed event with 4 going and 3 checked in.
  store.seed("companies/alpha/events/done", { companyId: "alpha", title: "Trivia", status: "completed", capacity: 10, attendeeCount: 4, startTime: day(-5), endTime: day(-5, 11) });
  for (const [i, checkedIn] of [true, true, true, false].entries()) {
    store.seed(`companies/alpha/events/done/rsvps/u${i}`, { companyId: "alpha", userId: `u${i}`, status: "going", checkedIn, createdAt: day(-40) });
  }
  store.seed("companies/alpha/events/live", { ...store.get("companies/alpha/events/live")!, attendeeCount: 2 });
  // Points: +50 and +20 in the window, a negative entry and an old one do not count as issued.
  store.seed("companies/alpha/pointTransactions/a", { companyId: "alpha", userId: "m1", amount: 50, createdAt: day(-3) });
  store.seed("companies/alpha/pointTransactions/b", { companyId: "alpha", userId: "m1", amount: 20, createdAt: day(-1) });
  store.seed("companies/alpha/pointTransactions/c", { companyId: "alpha", userId: "m1", amount: -10, createdAt: day(-1) });
  store.seed("companies/alpha/pointTransactions/d", { companyId: "alpha", userId: "m1", amount: 99, createdAt: day(-45) });
  // Weekly theme running now with two submissions waiting.
  store.seed("companies/alpha/challenges/week1", { companyId: "alpha", title: "Walk week", type: "weekly", startDate: day(-3), endDate: day(4), participantCount: 6, completedCount: 2 });
  store.seed("companies/alpha/challenges/week0", { companyId: "alpha", title: "Last week", type: "weekly", startDate: day(-10), endDate: day(-4), participantCount: 3, completedCount: 3 });
  store.seed("companies/alpha/challenges/week1/submissions/week1_m1", { companyId: "alpha", status: "submitted" });
  store.seed("companies/alpha/challenges/week1/submissions/week1_m2", { companyId: "alpha", status: "submitted" });
  store.seed("companies/alpha/challenges/week1/submissions/week1_m3", { companyId: "alpha", status: "approved" });
  store.seed("companies/alpha/challenges/week0/submissions/week0_m1", { companyId: "alpha", status: "submitted" });
}

describe("getCompanyInsightsV1", () => {
  test("admins get every section with exact counts; tenants never mix", async () => {
    const { deps, store } = makeDeps();
    seedActivity(store);
    const r = await getCompanyInsights(deps, caller("admin1"), base);
    assert.deepEqual(r.members, { total: 7, active: 6, deactivated: 1, invited: 1, activeLast30Days: 2, activeCapped: false });
    assert.equal(r.events.completed, 1);
    assert.equal(r.events.cancelled, 1);
    assert.equal(r.events.upcoming, 1, "only 'soon' is scheduled and starts after now");
    assert.equal(r.participation.rsvpsLast30Days, 3);
    assert.deepEqual(r.participation.topEvents.map(e => e.title), ["Trivia", "Boat Ride"]);
    assert.equal(r.participation.attendanceRate, 0.75);
    assert.equal(r.participation.attendanceSample, 1);
    assert.deepEqual(r.content, { photosLast30Days: 1, commentsLast30Days: 1 });
    assert.equal(r.points?.issuedLast30Days, 70);
    assert.equal(r.points?.topMembers[0]?.displayName, "Mia Member");
    assert.equal(r.challenges.pendingReviews, 3);
    assert.equal(r.challenges.current?.challengeId, "week1");
    assert.equal(r.challenges.current?.pendingReviews, 2);
    assert.equal(r.activity.length, 30);
    assert.deepEqual(r.activity[29], { date: "2030-01-02", rsvps: 2, photos: 0 });
    assert.deepEqual(r.activity[28], { date: "2030-01-01", rsvps: 1, photos: 1 });
  });

  test("organizers get the same numbers without points or balances", async () => {
    const { deps, store } = makeDeps();
    seedActivity(store);
    const r = await getCompanyInsights(deps, caller("org1"), base);
    assert.equal("points" in r, false);
    assert.equal(r.members.total, 7);
    assert.equal(JSON.stringify(r).includes("Mia Member"), false);
  });

  test("an organizer reading right after an admin gets the cached summary with points removed", async () => {
    const { deps, store } = makeDeps();
    seedActivity(store);
    await getCompanyInsights(deps, caller("admin1"), base);
    assert.ok(store.get("companies/alpha/insights/summary"));
    const r = await getCompanyInsights(deps, caller("org1"), base);
    assert.equal("points" in r, false);
  });

  test("authentication, role, deactivation, tenant and strict input are enforced before any read", async () => {
    const { deps, store } = makeDeps();
    seedActivity(store);
    await fails(getCompanyInsights(deps, null, base), "unauthenticated", "UNAUTHENTICATED");
    await fails(getCompanyInsights(deps, caller("admin1", { emailVerified: false }), base), "permission-denied", "EMAIL_NOT_VERIFIED");
    await fails(getCompanyInsights(deps, caller("m1"), base), "permission-denied", "INSUFFICIENT_ROLE");
    await fails(getCompanyInsights(deps, caller("nobody"), base), "permission-denied", "MEMBERSHIP_CONFLICT");
    await fails(getCompanyInsights(deps, caller("deact"), base), "permission-denied", "ACCOUNT_DEACTIVATED");
    await fails(getCompanyInsights(deps, caller("bo"), base), "permission-denied", "COMPANY_MISMATCH");
    await fails(getCompanyInsights(deps, caller("admin1"), { ...base, extra: 1 }), "invalid-argument", "VALIDATION_FAILED");
    await fails(getCompanyInsights(deps, caller("admin1"), { ...base, contractVersion: 2 }), "invalid-argument", "VALIDATION_FAILED");
    assert.equal(store.get("companies/alpha/insights/summary"), undefined, "denied calls write nothing");
  });

  test("the cache serves for 10 minutes, refresh needs a minute of age, and a stale cache recomputes", async () => {
    const { deps, store } = makeDeps();
    seedActivity(store);
    const first = await getCompanyInsights(deps, caller("admin1"), base);
    store.seed("companies/alpha/roster/r3", { companyId: "alpha", email: "z@alpha.test", status: "invited" });
    assert.equal((await getCompanyInsights(deps, caller("admin1"), base)).members.invited, first.members.invited, "cached");
    assert.equal((await getCompanyInsights(deps, caller("admin1"), { ...base, refresh: true })).members.invited, first.members.invited, "refresh too soon");
    store.seed("companies/alpha/insights/summary", { ...store.get("companies/alpha/insights/summary")!, generatedAt: new Date(NOW.getTime() - 2 * 60_000) });
    assert.equal((await getCompanyInsights(deps, caller("admin1"), { ...base, refresh: true })).members.invited, 2, "refresh after a minute");
    store.seed("companies/alpha/roster/r4", { companyId: "alpha", email: "w@alpha.test", status: "invited" });
    store.seed("companies/alpha/insights/summary", { ...store.get("companies/alpha/insights/summary")!, generatedAt: new Date(NOW.getTime() - CACHE_TTL_MS - 1) });
    assert.equal((await getCompanyInsights(deps, caller("admin1"), base)).members.invited, 3, "expired");
  });

  test("an empty company returns zeros, a null rate and no current theme", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    store.seed("users/solo", { companyId: "gamma", role: "admin", displayName: "Solo", email: "s@gamma.test", pointsBalance: 0 });
    store.seed("companies/gamma", { name: "Gamma", emailDomain: "gamma.test" });
    const r = await getCompanyInsights(deps, caller("solo"), { ...base, companyId: "gamma" });
    assert.deepEqual([r.members.total, r.events.upcoming, r.participation.rsvpsLast30Days, r.participation.attendanceRate], [1, 0, 0, null]);
    assert.equal(r.challenges.current, undefined);
    assert.equal(r.activity.every(d => d.rsvps === 0 && d.photos === 0), true);
  });
});

// A Firestore missing-index failure as the Node SDK raises it (gRPC code 9).
const INDEX_LINK = "https://console.firebase.google.com/v1/r/project/demo/firestore/indexes?create_composite=Abc123_-";
const missingIndex = () => Object.assign(new Error(`9 FAILED_PRECONDITION: The query requires an index. You can create it here: ${INDEX_LINK}`), { code: 9 });

describe("getCompanyInsightsV1 best-effort sections", () => {
  test("a failing query marks only its sections unavailable, logs the Firestore error and is not cached", async () => {
    const { deps, store } = makeDeps();
    seedActivity(store);
    const aggregate = store.aggregate.bind(store);
    store.aggregate = async (source, where, sumField) => {
      if ("group" in source && source.group === "photos") throw missingIndex();
      return aggregate(source, where, sumField);
    };
    const error = mock.method(logger, "error", () => undefined);
    try {
      const r = await getCompanyInsights(deps, caller("admin1"), base);
      assert.deepEqual(r.unavailable, ["content", "activity"]);
      assert.deepEqual(r.content, { photosLast30Days: 0, commentsLast30Days: 0 });
      assert.equal(r.activity.length, 30, "the placeholder keeps the contract shape");
      assert.equal(r.members.total, 7, "unaffected sections keep their numbers");
      assert.equal(r.participation.rsvpsLast30Days, 3);
      assert.equal(r.points?.issuedLast30Days, 70);
      assert.equal(store.get("companies/alpha/insights/summary"), undefined, "a partial summary is never cached");
      const logged = error.mock.calls.map(c => c.arguments[1] as Record<string, unknown>);
      assert.deepEqual(logged.map(l => l.section).sort(), ["activity", "content"]);
      assert.equal(logged[0]!.code, 9);
      assert.equal(logged[0]!.indexUrl, INDEX_LINK);
      assert.match(String(logged[0]!.message), /FAILED_PRECONDITION/);
      assert.equal(JSON.stringify(logged).includes("Mia"), false, "no member data in logs");
    } finally { error.mock.restore(); }
  });

  test("a failing RSVP sample takes down members and nothing else; organizers never see the points flag", async () => {
    const { deps, store } = makeDeps();
    seedActivity(store);
    const queryDocs = store.queryDocs.bind(store);
    store.queryDocs = async (source, query) => {
      if (("group" in source && source.group === "rsvps") || ("collection" in source && source.collection === "users")) throw missingIndex();
      return queryDocs(source, query);
    };
    const error = mock.method(logger, "error", () => undefined);
    try {
      const admin = await getCompanyInsights(deps, caller("admin1"), base);
      assert.deepEqual(admin.unavailable, ["members", "points"]);
      assert.equal(admin.events.completed, 1);
      const organizer = await getCompanyInsights(deps, caller("org1"), base);
      assert.deepEqual(organizer.unavailable, ["members"]);
      assert.equal("points" in organizer, false);
    } finally { error.mock.restore(); }
  });

  test("a complete summary carries no unavailable flag", async () => {
    const { deps, store } = makeDeps();
    seedActivity(store);
    assert.equal("unavailable" in (await getCompanyInsights(deps, caller("admin1"), base)), false);
  });

  test("handleAdminCommand logs the code, bounded message and index link of an unexpected failure, never the payload", async () => {
    const { deps } = makeDeps();
    const error = mock.method(logger, "error", () => undefined);
    try {
      const auth = { uid: "admin1", token: {} } as never;
      await assert.rejects(handleAdminCommand("probeV1", async () => { throw missingIndex(); }, deps, { auth, data: { secret: "payload-value" } }),
        (e: any) => e.code === "internal" && !String(e.message).includes("FAILED_PRECONDITION"));
      const [message, fields] = error.mock.calls[0]!.arguments as [string, Record<string, unknown>];
      assert.equal(message, "probeV1 failed");
      assert.deepEqual({ ...fields, message: undefined }, { uid: "admin1", reason: "UNEXPECTED", error: "Error", code: 9, message: undefined, indexUrl: INDEX_LINK });
      assert.equal(JSON.stringify(fields).includes("payload-value"), false);
      assert.deepEqual(errorDiagnostics("boom"), { error: "string", code: null, message: "" });
      assert.equal(errorDiagnostics(new Error("x".repeat(2000))).message.length, 500);
    } finally { error.mock.restore(); }
  });
});

// ----- Index coverage: every query the Overview runs must be served by an index Firestore has without asking.
// Simplified planner rules: equality-only queries merge single-field indexes; one field on a collection uses its
// automatic single-field index; anything else needs a composite with the equality fields first, then the
// inequality fields (lexicographic, ascending) or the orderBy field in its direction.
type Shape = { collectionGroup: string; scope: "COLLECTION" | "COLLECTION_GROUP"; equality: string[]; tail: [string, "ASCENDING" | "DESCENDING"][] };
interface IndexDef { collectionGroup: string; queryScope: string; fields: { fieldPath: string; order?: string }[] }

function shapeOf(source: QuerySource, where: ReadonlyArray<Filter>, orderBy?: string, descending?: boolean): Shape {
  const scope = "group" in source ? "COLLECTION_GROUP" : "COLLECTION";
  const collectionGroup = "group" in source ? source.group : source.collection.split("/").pop()!;
  const equality = [...new Set(where.filter(f => f[1] === "==").map(f => f[0]))];
  const ranges = [...new Set(where.filter(f => f[1] !== "==").map(f => f[0]))].sort();
  const dir = descending ? "DESCENDING" as const : "ASCENDING" as const;
  const tail: Shape["tail"] = orderBy && ranges.includes(orderBy)
    ? [[orderBy, dir], ...ranges.filter(r => r !== orderBy).map(r => [r, "ASCENDING"] as [string, "ASCENDING"])]
    : [...ranges.map(r => [r, "ASCENDING"] as [string, "ASCENDING"]), ...(orderBy ? [[orderBy, dir] as [string, typeof dir]] : [])];
  return { collectionGroup, scope, equality, tail };
}

function covered(shape: Shape, indexes: IndexDef[]): boolean {
  if (shape.tail.length === 0 && (shape.scope === "COLLECTION" || shape.equality.length === 0)) return true;
  if (shape.scope === "COLLECTION" && shape.equality.length + shape.tail.length <= 1) return true;
  return indexes.some(index => {
    if (index.collectionGroup !== shape.collectionGroup || index.queryScope !== shape.scope) return false;
    const fields = index.fields.filter(f => f.fieldPath !== "__name__");
    if (fields.length !== shape.equality.length + shape.tail.length) return false;
    const prefix = fields.slice(0, shape.equality.length);
    if (!prefix.every(f => shape.equality.includes(f.fieldPath) && f.order === "ASCENDING")) return false;
    return fields.slice(shape.equality.length).every((f, i) => f.fieldPath === shape.tail[i]![0] && f.order === shape.tail[i]![1]);
  });
}

describe("insights index coverage", () => {
  test("every Overview query shape is covered by gcp/firestore.indexes.json", async () => {
    const indexes = (JSON.parse(readFileSync(join(__dirname, "../../firestore.indexes.json"), "utf8")) as { indexes: IndexDef[] }).indexes;
    const { deps, store } = makeDeps();
    seedActivity(store);
    const shapes: Shape[] = [];
    const aggregate = store.aggregate.bind(store), queryDocs = store.queryDocs.bind(store);
    store.aggregate = async (source, where, sumField) => { shapes.push(shapeOf(source, where)); return aggregate(source, where, sumField); };
    store.queryDocs = async (source, query) => { shapes.push(shapeOf(source, query.where, query.orderBy, query.descending)); return queryDocs(source, query); };
    await getCompanyInsights(deps, caller("admin1"), base);
    assert.ok(shapes.length > 60);
    const missing = shapes.filter(s => !covered(s, indexes)).map(s => JSON.stringify(s));
    assert.deepEqual([...new Set(missing)], []);
    // The checker itself: the two shapes that failed in production are rejected without their descending indexes.
    const withoutDesc = indexes.filter(i => !i.fields.some(f => f.order === "DESCENDING" && (f.fieldPath === "createdAt" || f.fieldPath === "startTime")));
    assert.equal(covered(shapeOf({ group: "rsvps" }, [["companyId", "==", "a"], ["createdAt", ">=", 0]], "createdAt", true), withoutDesc), false);
    assert.equal(covered(shapeOf({ collection: "companies/a/events" }, [["status", "==", "completed"]], "startTime", true), withoutDesc), false);
  });
});

describe("insights domain helpers", () => {
  test("day buckets are 30 UTC days ending today; month bounds roll the year", () => {
    const days = dayBuckets(NOW);
    assert.equal(days.length, 30);
    assert.equal(days[29]!.date, "2030-01-02");
    assert.equal(days[0]!.date, "2029-12-04");
    assert.equal(days[29]!.to.toISOString(), "2030-01-03T00:00:00.000Z");
    assert.deepEqual(monthBounds(new Date("2029-12-31T23:00:00Z")).to.toISOString(), "2030-01-01T00:00:00.000Z");
  });

  test("attendance rate caps at going, ignores empty samples and rounds", () => {
    assert.equal(attendanceRate([]), null);
    assert.equal(attendanceRate([{ going: 0, checkedIn: 0 }]), null);
    assert.equal(attendanceRate([{ going: 3, checkedIn: 9 }]), 1);
    assert.equal(attendanceRate([{ going: 3, checkedIn: 1 }, { going: 3, checkedIn: 2 }]), 0.5);
    assert.equal(attendanceRate([{ going: 3, checkedIn: 1 }]), 0.333);
  });

  test("distinct ids skip blanks; the cache rules reject future and malformed stamps", () => {
    assert.equal(distinctStrings(["a", "a", "", 3, undefined, "b"]), 2);
    assert.equal(cacheAge("yesterday", NOW), null);
    assert.equal(cacheAge(new Date(NOW.getTime() + 1000), NOW), null);
    assert.equal(cacheUsable(null, false), false);
    assert.equal(cacheUsable(30_000, true), true);
    assert.equal(cacheUsable(90_000, true), false);
    assert.equal(cacheUsable(CACHE_TTL_MS, false), false);
  });
});
