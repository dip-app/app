import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import type { CompanyEmailSettings, NewOutboxEntry, OutboxStore } from "../../functions/src/modules/email/application/ports";
import { runWeeklyThemeEmails } from "../../functions/src/modules/email/application/weeklyThemeEmails";
import { categoryOf, outboxId, type OutboxDocument } from "../../functions/src/modules/email/domain/outbox";
import { validateVariables } from "../../functions/src/modules/email/domain/templates/render";
import { runWeeklyThemePushes } from "../../functions/src/modules/notifications/application/newTriggers";
import type { NotificationRequest } from "../../functions/src/modules/notifications/application/router";
import type { WeeklyTheme } from "../../functions/src/modules/notifications/application/routerPorts";
import { isCompanyAudienceMember } from "../../functions/src/modules/notifications/domain/audience";
import { FirestoreThemes } from "../../functions/src/modules/notifications/infrastructure/firestoreThemes";

// Weekly theme audience (push and email): every active member of the company whatever the role. Both jobs share the
// `FirestoreThemes` member pager, so these tests run the real adapter on a minimal in-memory `users` query.

const NOW = new Date("2026-11-23T14:00:00Z"); // Monday 09:00 America/New_York

type User = { companyId: string; role?: unknown; status?: unknown };

/** Just enough of the Admin SDK for `users.where(companyId).orderBy(id).select(...).limit(n).startAfter(uid).get()`. */
function fakeDb(users: Record<string, User>): Firestore {
  const query = (companyId: string, limit: number, after: string | null) => ({
    orderBy: () => query(companyId, limit, after),
    select: () => query(companyId, limit, after),
    limit: (n: number) => query(companyId, n, after),
    startAfter: (uid: string) => query(companyId, limit, uid),
    get: async () => {
      const ids = Object.keys(users).filter((id) => users[id]!.companyId === companyId).sort().filter((id) => after === null || id > after).slice(0, limit);
      const docs = ids.map((id) => ({ id, get: (field: string) => (users[id] as Record<string, unknown>)[field] }));
      return { docs, size: docs.length };
    },
  });
  return {
    collection: (name: string) => {
      assert.equal(name, "users");
      return { where: (field: string, op: string, value: string) => { assert.equal(field, "companyId"); assert.equal(op, "=="); return query(value, 1000, null); } };
    },
  } as unknown as Firestore;
}

const USERS: Record<string, User> = {
  a_member: { companyId: "alpha", role: "member", status: "active" },
  a_organizer: { companyId: "alpha", role: "organizer", status: "active" },
  a_admin: { companyId: "alpha", role: "admin", status: "active" },
  a_legacy: { companyId: "alpha", role: "member" }, // no status: an older document, active
  a_invited: { companyId: "alpha", role: "member", status: "invited" },
  a_deactivated: { companyId: "alpha", role: "organizer", status: "deactivated" },
  a_unknown_role: { companyId: "alpha", role: "owner", status: "active" },
  b_member: { companyId: "beta", role: "member", status: "active" },
};
const ALPHA_AUDIENCE = ["a_admin", "a_legacy", "a_member", "a_organizer"];

const THEME: WeeklyTheme = { companyId: "alpha", challengeId: "chal1", title: "Outdoors Week", startDate: new Date("2026-11-23T05:00:00Z"), endDate: new Date("2026-11-30T05:00:00Z") };

class FakeOutbox implements OutboxStore {
  docs = new Map<string, OutboxDocument>();
  async create(entry: NewOutboxEntry, now: Date) {
    if (this.docs.has(entry.id)) return false;
    this.docs.set(entry.id, {
      id: entry.id, uid: entry.uid, companyId: entry.companyId, category: categoryOf(entry.template), template: entry.template,
      variables: entry.variables, status: "queued", attempts: 0, notAfter: entry.notAfter, createdAt: now, expireAt: now, leaseUntil: null,
    });
    return true;
  }
  async claim() { return { kind: "missing" as const }; }
  async finish() { /* not used */ }
  async get(id: string) { return this.docs.get(id) ?? null; }
  async recordOpen() { return false; }
}

describe("company audience rule", () => {
  test("member, organizer and admin are in; invited, deactivated and unknown roles are out; a missing status is active", () => {
    for (const role of ["member", "organizer", "admin"]) {
      assert.ok(isCompanyAudienceMember({ role, status: "active" }), role);
      assert.ok(isCompanyAudienceMember({ role }), `${role} without status`);
      assert.ok(!isCompanyAudienceMember({ role, status: "invited" }), `${role} invited`);
      assert.ok(!isCompanyAudienceMember({ role, status: "deactivated" }), `${role} deactivated`);
    }
    assert.ok(!isCompanyAudienceMember({ role: "owner", status: "active" }));
    assert.ok(!isCompanyAudienceMember({ role: undefined }));
    assert.ok(!isCompanyAudienceMember({ role: "member", status: "unknown" }));
  });

  test("the pager returns that company's active members of every role, paged with a stable cursor", async () => {
    const themes = new FirestoreThemes(fakeDb(USERS));
    assert.deepEqual((await themes.page("alpha", null, 100)).uids, ALPHA_AUDIENCE);
    assert.deepEqual((await themes.page("beta", null, 100)).uids, ["b_member"]);
    // A full page (filtered or not) returns a cursor; the next page continues after it.
    const first = await themes.page("alpha", null, 3);
    assert.deepEqual(first, { uids: ["a_admin"], last: "a_invited" });
    const second = await themes.page("alpha", first.last, 3);
    assert.deepEqual(second, { uids: ["a_legacy", "a_member", "a_organizer"], last: "a_organizer" });
    assert.deepEqual(await themes.page("alpha", second.last, 3), { uids: [], last: null });
  });
});

describe("weekly theme push audience", () => {
  test("organizers get the push with members and admins; invited, deactivated and other companies do not; a rerun is the same request id", async () => {
    const pager = new FirestoreThemes(fakeDb(USERS));
    const delivered: NotificationRequest[] = [];
    const run = () => runWeeklyThemePushes({ themes: { startedBetween: async () => [THEME] }, members: pager, now: () => NOW, deliver: async (r) => { delivered.push(r); } });
    assert.deepEqual(await run(), { themes: 1, delivered: 1, failed: 0 });
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0]!.companyId, "alpha");
    assert.deepEqual(delivered[0]!.recipients.map((r) => r.uid), ALPHA_AUDIENCE);
    // Idempotency lives in the router receipt keyed by this id: a second run asks for the same id.
    await run();
    assert.deepEqual(delivered.map((r) => r.id), ["weekly_theme_alpha_chal1", "weekly_theme_alpha_chal1"]);
  });
});

describe("weekly theme email audience", () => {
  const world = (maps: Record<string, Record<string, unknown> | null>) => {
    const outbox = new FakeOutbox();
    const reads: string[] = [];
    const settings: CompanyEmailSettings = { enabled: true, dailyCap: 2000, timeZone: "America/New_York" };
    const deps = {
      themes: { startedBetween: async () => [THEME, { ...THEME, companyId: "beta", challengeId: "chal2" }] },
      members: new FirestoreThemes(fakeDb(USERS)),
      companies: { get: async () => settings },
      preferences: { getEmailMap: async (uid: string) => { reads.push(uid); return maps[uid] ?? null; }, disable: async () => true },
      enqueue: { outbox, clock: { now: () => NOW }, validate: validateVariables },
      config: { enabled: true },
      now: () => NOW,
    };
    return { deps, outbox, reads };
  };

  test("every opted-in role gets it once; default off; invited and deactivated users are never read; companies stay apart", async () => {
    const everyoneOn = Object.fromEntries(Object.keys(USERS).map((uid) => [uid, { weekly_themes: true }]));
    const w = world({ ...everyoneOn, a_legacy: null, a_member: { weekly_themes: false } });
    const first = await runWeeklyThemeEmails(w.deps);
    assert.deepEqual(new Set(w.reads), new Set([...ALPHA_AUDIENCE, "b_member"]), "only the audience is read");
    const sent = [...w.outbox.docs.values()].map((d) => `${d.companyId}/${d.uid}`).sort();
    assert.deepEqual(sent, ["alpha/a_admin", "alpha/a_organizer", "beta/b_member"]);
    assert.equal(first.enqueued, 3);
    assert.equal(first.notOptedIn, 2, "no stored choice and switched off");
    assert.ok(w.outbox.docs.has(outboxId("weekly_themes", "chal1", "a_organizer", "announce")));
    const second = await runWeeklyThemeEmails(w.deps);
    assert.equal(second.enqueued, 0);
    assert.equal(second.duplicates, 3);
    assert.equal(w.outbox.docs.size, 3);
  });
});
