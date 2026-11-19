import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { resolveMembership } from "../../functions/src/modules/accounts/application/resolveMembership";
import type { MembershipStore, MembershipTransaction } from "../../functions/src/modules/accounts/application/ports";
import type { NewMemberProfile, RosterClaim } from "../../functions/src/modules/accounts/domain/membership";
import { backfillRoster } from "../../functions/src/modules/admin/application/backfillRoster";
import { applyEmployeeImport, getEmployeeImport, importEmployees } from "../../functions/src/modules/admin/application/importEmployees";
import { updateMember } from "../../functions/src/modules/admin/application/members";
import { upsertRosterEntry } from "../../functions/src/modules/admin/application/roster";
import { emailHash, REMOVED_STORED_FIELDS } from "../../functions/src/modules/admin/domain/employee";
import { MAX_COMPANY_TEAMS, MAX_NEW_TEAMS_PER_IMPORT, teamIdFor, teamKey, TeamResolver } from "../../functions/src/modules/admin/domain/teamNames";
import { caller, makeDeps, NOW, rid, seedCompany, type FakeAdminStore } from "./helpers/adminFakes";

// Team creation by import and Add person, and roster data minimization (docs/design/roster-data-minimization.md).
const base = { contractVersion: 1, companyId: "alpha" };
const admin = caller("admin1");
type Doc = Record<string, unknown>;
const audits = (store: FakeAdminStore, company = "alpha") => store.children(`companies/${company}/auditLog`).map(c => c.data);
const teamsOf = (store: FakeAdminStore, company = "alpha") => store.children(`companies/${company}/teams`);

function setup() {
  const ctx = makeDeps();
  seedCompany(ctx.store);
  ctx.store.seed("companies/alpha/teams/t-platform", { companyId: "alpha", name: "Platform", archived: false, revision: 1 });
  ctx.store.seed("companies/alpha/teams/t-ing", { companyId: "alpha", name: "Ingeniería", archived: false, revision: 1 });
  ctx.store.seed("companies/alpha/teams/t-old", { companyId: "alpha", name: "Legacy", archived: true, revision: 1 });
  return ctx;
}

async function importAndApply(store: FakeAdminStore, deps: ReturnType<typeof makeDeps>["deps"], rows: unknown[], who = admin) {
  const plan = await importEmployees(deps, who, { ...base, requestId: rid(), rows });
  let applied = await applyEmployeeImport(deps, who, { ...base, jobId: plan.jobId, planHash: plan.planHash });
  while (!applied.done) applied = await applyEmployeeImport(deps, who, { ...base, jobId: plan.jobId, planHash: plan.planHash });
  void store;
  return { plan, applied };
}

/**
 * Guard: fails the test when any write sets a removed field on a users/{uid} profile or a roster entry. Seeding is
 * allowed (legacy data); the check runs only on writes made after `arm()`.
 */
function guardRemovedFields(store: FakeAdminStore) {
  const original = store.seed.bind(store);
  const violations: string[] = [];
  let armed = false;
  store.seed = (path: string, data: Doc) => {
    if (armed && (/^users\/[^/]+$/.test(path) || /^companies\/[^/]+\/roster\/[^/]+$/.test(path))) {
      const before = store.get(path) ?? {};
      for (const field of REMOVED_STORED_FIELDS) {
        if (field in data && JSON.stringify(before[field]) !== JSON.stringify(data[field])) violations.push(`${path}.${field}`);
      }
    }
    original(path, data);
  };
  return { arm: () => { armed = true; }, violations };
}

describe("team names", () => {
  test("normalization trims, collapses whitespace and ignores case and accents; ids are deterministic", () => {
    assert.equal(teamKey("  Ingeniería   de  Datos "), "ingenieria de datos");
    assert.equal(teamIdFor("Platform"), teamIdFor(" PLATFORM "));
    assert.equal(teamIdFor("Méntors"), teamIdFor("mentors"));
    assert.notEqual(teamIdFor("Platform"), teamIdFor("Platforms"));
    assert.match(teamIdFor("Platform"), /^team_[0-9a-f]{32}$/);
  });

  test("the resolver plans each new name once and applies the per-import and company caps", () => {
    const resolver = new TeamResolver([{ id: "a", name: "Alpha", archived: false }], { perImport: 2, company: 4 });
    assert.deepEqual(resolver.resolve("alpha"), { kind: "existing", id: "a" });
    assert.equal(resolver.resolve("New One")!.kind, "new");
    assert.equal(resolver.resolve("new  one")!.kind, "new");
    assert.equal(resolver.resolve("Two")!.kind, "new");
    assert.deepEqual(resolver.resolve("Three"), { kind: "skipped", name: "Three", reason: "TEAM_IMPORT_LIMIT" });
    assert.deepEqual(resolver.newTeams().map(t => t.name), ["New One", "Two"]);
    const full = new TeamResolver([{ id: "a", name: "A", archived: false }, { id: "b", name: "B", archived: false }], { perImport: 50, company: 3 });
    assert.equal(full.resolve("C")!.kind, "new");
    assert.deepEqual(full.resolve("D"), { kind: "skipped", name: "D", reason: "TEAM_COMPANY_LIMIT" });
    assert.equal(full.resolve("   "), null);
    assert.equal(full.resolve("x".repeat(81))!.kind, "skipped");
  });
});

describe("import creates unknown teams", () => {
  test("an unknown team is created once for the whole file; case and accents match existing teams", async () => {
    const { deps, store } = setup();
    const rows = [
      { email: "a1@alpha.test", displayName: "A One", teamIds: ["PLATFORM", "Mentors"] },
      { email: "a2@alpha.test", displayName: "A Two", teamIds: ["  mentors ", "ingenieria"] },
      { email: "a3@alpha.test", displayName: "A Three", teamIds: ["Méntors", "Legacy"] },
      { email: "mia@alpha.test", teamIds: ["Mentors"] },
    ];
    const plan = await importEmployees(deps, admin, { ...base, requestId: rid(), rows });
    assert.deepEqual(plan.newTeams, [{ id: teamIdFor("Mentors"), name: "Mentors" }]);
    assert.deepEqual(plan.skippedTeams, [{ name: "Legacy", reason: "TEAM_ARCHIVED" }]);
    assert.deepEqual(plan.totals, { total: 4, create: 3, update: 1, unchanged: 0, invalid: 0 }, "no row is invalid because of a team");
    assert.equal(plan.rows[2]!.notices![0]!.code, "TEAM_ARCHIVED");
    assert.equal(plan.rows[0]!.changes.find(c => c.field === "teamIds")!.after, "Platform, Mentors", "the preview shows team names, not ids");
    assert.equal(teamsOf(store).length, 3, "planning writes no team");

    const applied = await applyEmployeeImport(deps, admin, { ...base, jobId: plan.jobId, planHash: plan.planHash });
    assert.equal(applied.progress.failed, 0);
    assert.equal(applied.progress.teamsCreated, 1);
    assert.equal(teamsOf(store).length, 4);
    const mentors = store.get(`companies/alpha/teams/${teamIdFor("Mentors")}`)!;
    assert.deepEqual([mentors.companyId, mentors.name, mentors.archived, mentors.revision], ["alpha", "Mentors", false, 1]);
    assert.deepEqual(store.get(`companies/alpha/roster/${emailHash("a1@alpha.test")}`)!.teamIds, ["t-platform", teamIdFor("Mentors")]);
    assert.deepEqual(store.get(`companies/alpha/roster/${emailHash("a2@alpha.test")}`)!.teamIds, [teamIdFor("Mentors"), "t-ing"]);
    assert.deepEqual(store.get(`companies/alpha/roster/${emailHash("a3@alpha.test")}`)!.teamIds, [teamIdFor("Mentors")]);
    assert.deepEqual(store.get("users/m1")!.teamIds, [teamIdFor("Mentors")]);
    assert.equal(store.get("companies/alpha/teams/t-old")!.archived, true, "an archived team is never revived");
    assert.equal(audits(store).filter(a => a.summaryKey === "team.create").length, 1);
    const done = audits(store).find(a => a.summaryKey === "import.apply")!;
    assert.ok((done.changes as Array<{ field: string }>).some(c => c.field === "teamsCreated"));
    const job = await getEmployeeImport(deps, admin, { ...base, jobId: plan.jobId });
    assert.deepEqual(job.job.newTeams, [{ id: teamIdFor("Mentors"), name: "Mentors" }]);
    assert.equal(job.job.progress.teamsCreated, 1);
  });

  test("re-importing the same file creates nothing and finds every row unchanged", async () => {
    const { deps, store } = setup();
    const rows = [{ email: "a1@alpha.test", displayName: "A One", teamIds: ["Mentors", "Guild"] }];
    await importAndApply(store, deps, rows);
    const teams = teamsOf(store).length;
    const again = await importEmployees(deps, admin, { ...base, requestId: rid(), rows: [{ email: "a1@alpha.test", displayName: "A One", teamIds: ["mentors", "GUILD"] }] });
    assert.equal(again.newTeams, undefined);
    assert.equal(again.totals.unchanged, 1);
    const applied = await applyEmployeeImport(deps, admin, { ...base, jobId: again.jobId, planHash: again.planHash });
    assert.equal(applied.progress.teamsCreated, undefined);
    assert.equal(teamsOf(store).length, teams);
  });

  test("two imports planned before either applies converge on one team", async () => {
    const { deps, store } = setup();
    const first = await importEmployees(deps, admin, { ...base, requestId: rid(), rows: [{ email: "b1@alpha.test", displayName: "B One", teamIds: ["Mentors"] }] });
    const second = await importEmployees(deps, caller("admin2"), { ...base, requestId: rid(), rows: [{ email: "b2@alpha.test", displayName: "B Two", teamIds: ["mentors"] }] });
    assert.deepEqual(first.newTeams!.map(t => t.id), second.newTeams!.map(t => t.id));
    const results = await Promise.all([
      applyEmployeeImport(deps, admin, { ...base, jobId: first.jobId, planHash: first.planHash }),
      applyEmployeeImport(deps, caller("admin2"), { ...base, jobId: second.jobId, planHash: second.planHash }),
    ]);
    assert.equal(results.reduce((n, r) => n + r.progress.failed, 0), 0);
    assert.equal(results.reduce((n, r) => n + (r.progress.teamsCreated ?? 0), 0), 1);
    assert.equal(teamsOf(store).filter(t => t.data.name === "Mentors").length, 1);
    assert.deepEqual(store.get(`companies/alpha/roster/${emailHash("b2@alpha.test")}`)!.teamIds, [teamIdFor("Mentors")]);
    assert.equal(audits(store).filter(a => a.summaryKey === "team.create").length, 1);
  });

  test("past the per-import cap the extra teams are skipped and listed, and the rows still import", async () => {
    const { deps, store } = setup();
    const rows = Array.from({ length: MAX_NEW_TEAMS_PER_IMPORT + 5 }, (_, i) => ({ email: `c${i}@alpha.test`, displayName: `C ${i}`, teamIds: [`Team ${i}`, "Platform"] }));
    rows.push({ email: "long@alpha.test", displayName: "Long", teamIds: ["x".repeat(81)] });
    const plan = await importEmployees(deps, admin, { ...base, requestId: rid(), rows });
    assert.equal(plan.newTeams!.length, MAX_NEW_TEAMS_PER_IMPORT);
    assert.deepEqual(plan.skippedTeams!.map(s => s.reason), [...Array(5).fill("TEAM_IMPORT_LIMIT"), "TEAM_NAME_TOO_LONG"]);
    assert.equal(plan.totals.invalid, 0);
    const { applied } = await importAndApply(store, deps, rows);
    assert.equal(applied.progress.created, rows.length);
    assert.equal(teamsOf(store).length, 3 + MAX_NEW_TEAMS_PER_IMPORT);
    assert.deepEqual(store.get(`companies/alpha/roster/${emailHash(`c${MAX_NEW_TEAMS_PER_IMPORT + 1}@alpha.test`)}`)!.teamIds, ["t-platform"]);
  });

  test("the company team limit is checked when planning and again when applying", async () => {
    const { deps, store } = setup();
    for (let i = 0; i < MAX_COMPANY_TEAMS - 4; i++) store.seed(`companies/alpha/teams/s${i}`, { companyId: "alpha", name: `Seeded ${i}`, archived: false, revision: 1 });
    // 499 teams: room for one more at planning time.
    const plan = await importEmployees(deps, admin, { ...base, requestId: rid(), rows: [
      { email: "d1@alpha.test", displayName: "D One", teamIds: ["Fresh A"] },
      { email: "d2@alpha.test", displayName: "D Two", teamIds: ["Fresh B"] },
    ] });
    assert.deepEqual(plan.newTeams!.map(t => t.name), ["Fresh A"]);
    assert.deepEqual(plan.skippedTeams, [{ name: "Fresh B", reason: "TEAM_COMPANY_LIMIT" }]);
    // Another admin fills the last slot before this import applies: the row still imports, without the team.
    store.seed("companies/alpha/teams/late", { companyId: "alpha", name: "Late", archived: false, revision: 1 });
    const applied = await applyEmployeeImport(deps, admin, { ...base, jobId: plan.jobId, planHash: plan.planHash });
    assert.equal(applied.progress.failed, 0);
    assert.equal(applied.progress.created, 2);
    assert.equal(store.get(`companies/alpha/teams/${teamIdFor("Fresh A")}`), undefined);
    assert.deepEqual(store.get(`companies/alpha/roster/${emailHash("d1@alpha.test")}`)!.teamIds, []);
  });

  test("teams are tenant scoped: another company's team with the same name and id is never read or touched", async () => {
    const { deps, store } = setup();
    store.seed(`companies/beta/teams/${teamIdFor("Mentors")}`, { companyId: "beta", name: "Mentors", archived: true, revision: 7 });
    await importAndApply(store, deps, [{ email: "e1@alpha.test", displayName: "E One", teamIds: ["Mentors"] }]);
    assert.equal(store.get(`companies/alpha/teams/${teamIdFor("Mentors")}`)!.companyId, "alpha");
    assert.deepEqual(store.get(`companies/beta/teams/${teamIdFor("Mentors")}`), { companyId: "beta", name: "Mentors", archived: true, revision: 7 });
    assert.equal(audits(store, "beta").length, 0);
    // A caller from beta cannot plan into alpha.
    await assert.rejects(importEmployees(deps, caller("bo"), { ...base, requestId: rid(), rows: [{ email: "x@alpha.test", teamIds: ["Spy"] }] }));
    assert.equal(store.get(`companies/alpha/teams/${teamIdFor("Spy")}`), undefined);
  });

  test("a team renamed after an import is reused, not duplicated, when the old name is imported again", async () => {
    const { deps, store } = setup();
    await importAndApply(store, deps, [{ email: "f1@alpha.test", displayName: "F One", teamIds: ["Guild"] }]);
    store.seed(`companies/alpha/teams/${teamIdFor("Guild")}`, { ...store.get(`companies/alpha/teams/${teamIdFor("Guild")}`)!, name: "Guild of Makers" });
    const plan = await importEmployees(deps, admin, { ...base, requestId: rid(), rows: [{ email: "f2@alpha.test", displayName: "F Two", teamIds: ["guild"] }] });
    assert.equal(plan.newTeams, undefined);
    await applyEmployeeImport(deps, admin, { ...base, jobId: plan.jobId, planHash: plan.planHash });
    assert.equal(store.get(`companies/alpha/teams/${teamIdFor("Guild")}`)!.name, "Guild of Makers", "never overwritten");
  });

  test("a member who joins later gets the created team ids from the roster claim", async () => {
    const { deps, store } = setup();
    await importAndApply(store, deps, [{ email: "pat@alpha.test", displayName: "Pat Lee", role: "organizer", teamIds: ["Mentors", "Platform"] }]);
    const doc = store.get(`companies/alpha/roster/${emailHash("pat@alpha.test")}`)!;
    // The same projection firestoreMembershipStore.getRosterEntry reads.
    const claim: RosterClaim = {
      entryId: emailHash("pat@alpha.test"), email: String(doc.email), status: String(doc.status), displayName: String(doc.displayName), role: String(doc.role),
      teamIds: doc.teamIds as string[], workLocation: String(doc.workLocation), department: String(doc.department), jobTitle: String(doc.jobTitle),
    };
    const created: NewMemberProfile[] = [];
    const membership: MembershipStore = {
      runTransaction: async <T>(work: (tx: MembershipTransaction) => Promise<T>) => work({
        companyIdForDomain: async () => "alpha", getMembership: async () => null, getRosterEntry: async () => claim,
        recordRosterJoin: () => undefined, createMember: (_uid, profile) => { created.push(profile); }, updateDisplayName: () => undefined,
      }),
    };
    await resolveMembership(membership, { uid: "pat", email: "pat@alpha.test", emailVerified: true, signInProvider: "google.com", name: "Pat Lee" }, { contractVersion: 1 });
    assert.deepEqual(created[0]!.teamIds, [teamIdFor("Mentors"), "t-platform"]);
    assert.ok(store.get(`companies/alpha/teams/${teamIdFor("Mentors")}`), "the team the member is assigned to exists");
  });
});

describe("removed roster fields (managerEmail, startDate)", () => {
  test("a legacy file with the removed columns imports without errors, notes them and never stores them", async () => {
    const { deps, store } = setup();
    const guard = guardRemovedFields(store);
    guard.arm();
    const rows = [
      { email: "g1@alpha.test", displayName: "G One", managerEmail: "boss@alpha.test", startDate: "2026-01-12" },
      { email: "g2@alpha.test", displayName: "G Two", managerEmail: "not an email", startDate: "12/01/2026" },
      { email: "mia@alpha.test", managerEmail: "boss@alpha.test", jobTitle: "Lead" },
    ];
    const { plan, applied } = await importAndApply(store, deps, rows);
    assert.equal(plan.totals.invalid, 0);
    assert.deepEqual(plan.rows[1]!.notices!.map(n => `${n.field}:${n.code}`), ["managerEmail:FIELD_IGNORED", "startDate:FIELD_IGNORED"]);
    assert.ok(plan.rows.every(r => r.changes.every(c => !REMOVED_STORED_FIELDS.includes(c.field))));
    assert.equal(applied.progress.failed, 0);
    for (const email of ["g1@alpha.test", "g2@alpha.test"]) {
      const entry = store.get(`companies/alpha/roster/${emailHash(email)}`)!;
      for (const field of REMOVED_STORED_FIELDS) assert.equal(entry[field], undefined);
    }
    assert.deepEqual(guard.violations, []);
  });

  test("old portal payloads with the removed fields are still accepted by updateMemberV1 and upsertRosterEntryV1, and ignored", async () => {
    const { deps, store } = setup();
    const guard = guardRemovedFields(store);
    guard.arm();
    const updated = await updateMember(deps, admin, { ...base, requestId: rid(), userId: "m1", jobTitle: "Lead", managerEmail: "boss@alpha.test", startDate: "2026-01-12" });
    assert.deepEqual(updated.changedFields, ["jobTitle"]);
    const noop = await updateMember(deps, admin, { ...base, requestId: rid(), userId: "m1", managerEmail: "boss@alpha.test", startDate: "" });
    assert.deepEqual(noop.changedFields, []);
    await upsertRosterEntry(deps, admin, { ...base, requestId: rid(), entry: { email: "h1@alpha.test", displayName: "H One", managerEmail: "boss@alpha.test", startDate: "2026-01-12" } });
    for (const field of REMOVED_STORED_FIELDS) {
      assert.equal(store.get("users/m1")![field], undefined);
      assert.equal(store.get(`companies/alpha/roster/${emailHash("h1@alpha.test")}`)![field], undefined);
    }
    assert.deepEqual(guard.violations, []);
  });

  test("guard: no command writes a removed field, even over legacy documents that still hold one", async () => {
    const { deps, store } = setup();
    store.seed("users/m2", { ...store.get("users/m2")!, managerEmail: "old@alpha.test", startDate: "2020-01-01" });
    store.seed(`companies/alpha/roster/${emailHash("legacy@alpha.test")}`, {
      companyId: "alpha", email: "legacy@alpha.test", displayName: "", role: "member", teamIds: [], workLocation: "", department: "", jobTitle: "",
      managerEmail: "old@alpha.test", startDate: "2020-01-01", status: "invited", revision: 1,
    });
    const guard = guardRemovedFields(store);
    guard.arm();
    await importAndApply(store, deps, [
      { email: "max@alpha.test", jobTitle: "Lead", teamIds: ["Mentors"], managerEmail: "new@alpha.test" },
      { email: "legacy@alpha.test", jobTitle: "Lead", startDate: "2030-01-01" },
    ]);
    await updateMember(deps, admin, { ...base, requestId: rid(), userId: "m2", department: "Ops", managerEmail: "x@alpha.test" });
    const backfill = await backfillRoster(store, "alpha", NOW);
    assert.ok(backfill.created > 0);
    assert.deepEqual(guard.violations, []);
    const backfilled = store.get(`companies/alpha/roster/${emailHash("max@alpha.test")}`);
    if (backfilled) for (const field of REMOVED_STORED_FIELDS) assert.equal(backfilled[field], undefined);
    // The guard itself catches such a write.
    store.seed("users/m3", { ...store.get("users/m3")!, startDate: "2030-01-01" });
    assert.deepEqual(guard.violations, ["users/m3.startDate"]);
  });
});
