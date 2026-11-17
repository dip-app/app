import { strict as assert } from "node:assert";
import { test } from "node:test";
import { reconcileAllCompanies, reconcileCompanyTagStats } from "../../functions/src/modules/tags/application/reconcileTagStats";
import type { StatDoc, TagCatalog, TagReconcileStore } from "../../functions/src/modules/tags/application/ports";
import { planReconcile } from "../../functions/src/modules/tags/domain/reconcile";

const NOW = 1_000_000_000;
const OLD = NOW - 3_600_000;
const plan = (over: Partial<Parameters<typeof planReconcile>[0]>) =>
  planReconcile({ catalogTagIds: ["a", "b"], existing: [], computed: new Map(), nowMs: NOW, force: false, ...over });

test("planner: equal counts produce nothing", () => {
  const result = plan({ existing: [{ tagId: "a", memberCount: 3, updatedAtMs: OLD }], computed: new Map([["a", 3]]) });
  assert.deepEqual(result, { corrections: [], deletions: [], unchanged: 2, skippedRecent: [], deletionsRefused: false });
});

test("planner: drift up and down, negative existing count", () => {
  const result = plan({
    catalogTagIds: ["a", "b", "c"],
    existing: [{ tagId: "a", memberCount: 1, updatedAtMs: OLD }, { tagId: "b", memberCount: 9, updatedAtMs: OLD }, { tagId: "c", memberCount: -2, updatedAtMs: null }],
    computed: new Map([["a", 4], ["b", 2], ["c", 0]]),
  });
  assert.deepEqual(result.corrections, [{ tagId: "a", from: 1, to: 4 }, { tagId: "b", from: 9, to: 2 }, { tagId: "c", from: -2, to: 0 }]);
});

test("planner: missing doc with 0 creates nothing; with >0 is a create", () => {
  const result = plan({ computed: new Map([["b", 2]]) });
  assert.deepEqual(result.corrections, [{ tagId: "b", from: null, to: 2 }]);
  assert.equal(result.unchanged, 1);
});

test("planner: orphans are deleted regardless of recency", () => {
  const result = plan({ existing: [
    { tagId: "a", memberCount: 1, updatedAtMs: OLD }, { tagId: "b", memberCount: 1, updatedAtMs: OLD }, { tagId: "gone", memberCount: 5, updatedAtMs: NOW - 1000 },
  ], computed: new Map([["a", 1], ["b", 1]]) });
  assert.deepEqual(result.deletions, ["gone"]);
});

test("planner: an empty catalog never plans deletions, even with force and allowMassDelete", () => {
  const existing = [{ tagId: "a", memberCount: 1, updatedAtMs: OLD }, { tagId: "b", memberCount: 1, updatedAtMs: OLD }];
  for (const extra of [{}, { force: true }, { force: true, allowMassDelete: true }]) {
    const result = plan({ catalogTagIds: [], existing, ...extra });
    assert.deepEqual(result.deletions, []);
    assert.equal(result.deletionsRefused, true);
  }
});

test("planner: deleting more than half of the stat docs is refused unless allowMassDelete (force alone does not allow it)", () => {
  const existing = [
    { tagId: "a", memberCount: 1, updatedAtMs: OLD }, { tagId: "x", memberCount: 1, updatedAtMs: OLD }, { tagId: "y", memberCount: 1, updatedAtMs: OLD },
  ];
  const input = { catalogTagIds: ["a"], existing, computed: new Map([["a", 1]]) };
  assert.deepEqual(plan(input).deletions, []);
  assert.equal(plan(input).deletionsRefused, true);
  assert.equal(plan({ ...input, force: true }).deletionsRefused, true);
  assert.deepEqual(plan({ ...input, allowMassDelete: true }).deletions, ["x", "y"]);
  // Exactly half is allowed.
  assert.deepEqual(plan({ ...input, existing: existing.slice(0, 2) }).deletions, ["x"]);
});

test("planner: a negative computed count is clamped to zero", () => {
  const result = plan({ existing: [{ tagId: "a", memberCount: 4, updatedAtMs: OLD }], computed: new Map([["a", -2]]) });
  assert.deepEqual(result.corrections, [{ tagId: "a", from: 4, to: 0 }]);
});

test("planner: recent docs are skipped unless forced", () => {
  const input = { existing: [{ tagId: "a", memberCount: 1, updatedAtMs: NOW - 60_000 }], computed: new Map([["a", 4]]) };
  const skipped = plan(input);
  assert.deepEqual(skipped.skippedRecent, ["a"]);
  assert.deepEqual(skipped.corrections, []);
  assert.deepEqual(plan({ ...input, force: true }).corrections, [{ tagId: "a", from: 1, to: 4 }]);
  assert.deepEqual(plan({ ...input, recentWindowMs: 30_000 }).corrections, [{ tagId: "a", from: 1, to: 4 }]);
});

class FakeStore implements TagReconcileStore {
  writes: string[] = [];
  concurrent = new Set<string>();
  constructor(private docs: StatDoc[], private counts: Record<string, number>, private companies: string[] = ["c1"]) {}
  async listCompanyIds(after: string | null, limit: number) { return this.companies.filter((id) => after === null || id > after).slice(0, limit); }
  async countMembersWithTag(_c: string, tagId: string) { return this.counts[tagId] ?? 0; }
  async listStatDocs() { return this.docs; }
  async writeCorrection(c: string, tagId: string, to: number, version: unknown | null) {
    if (this.concurrent.has(tagId)) return "concurrent" as const;
    this.writes.push(`set ${c}/${tagId}=${to} v=${String(version)}`);
    return "written" as const;
  }
  async deleteOrphan(c: string, tagId: string, version: unknown) {
    if (this.concurrent.has(tagId)) return "concurrent" as const;
    this.writes.push(`del ${c}/${tagId} v=${String(version)}`);
    return "deleted" as const;
  }
}
const catalog: TagCatalog = { tagIds: async () => new Set(["a", "b", "c"]), tags: async () => [] };
const docs: StatDoc[] = [
  { tagId: "a", memberCount: 1, updatedAtMs: OLD, version: "va" },
  { tagId: "b", memberCount: 2, updatedAtMs: OLD, version: "vb" },
  { tagId: "zombie", memberCount: 7, updatedAtMs: OLD, version: "vz" },
];

test("application: report counts, guarded writes carry the read version", async () => {
  const store = new FakeStore(docs, { a: 4, b: 2, c: 3 });
  const report = await reconcileCompanyTagStats({ catalog, store }, "c1", { now: () => NOW });
  assert.deepEqual({ ...report, corrections: undefined }, {
    companyId: "c1", dryRun: false, checked: 3, corrected: 2, deleted: 1, unchanged: 1, skippedRecent: 0, skippedConcurrent: 0, drift: 3 + 3,
    corrections: undefined, deletions: ["zombie"], skippedRecentTags: [],
  });
  assert.deepEqual(store.writes, ["set c1/a=4 v=va", "set c1/c=3 v=null", "del c1/zombie v=vz"]);
});

test("application: dry run writes nothing but reports the plan", async () => {
  const store = new FakeStore(docs, { a: 4, c: 3 });
  const report = await reconcileCompanyTagStats({ catalog, store }, "c1", { now: () => NOW, dryRun: true });
  assert.deepEqual(store.writes, []);
  assert.equal(report.corrected, 3);
  assert.equal(report.deleted, 1);
});

test("application: precondition failures are skippedConcurrent and not counted as corrected", async () => {
  const store = new FakeStore(docs, { a: 4, c: 3 });
  store.concurrent = new Set(["a", "zombie"]);
  const report = await reconcileCompanyTagStats({ catalog, store }, "c1", { now: () => NOW });
  assert.equal(report.skippedConcurrent, 2);
  assert.equal(report.corrected, 2);
  assert.equal(report.deleted, 0);
  assert.equal(report.drift, 2 + 3);
});

test("reconcileAllCompanies: pages through companies and isolates failures", async () => {
  const ids = Array.from({ length: 150 }, (_, i) => `c${String(i).padStart(3, "0")}`);
  const store = new FakeStore([], {}, ids);
  const failing: TagReconcileStore = Object.assign(Object.create(store), {
    listStatDocs: async () => { throw new Error("boom"); },
  }) as TagReconcileStore;
  const all = await reconcileAllCompanies({ catalog, store });
  assert.equal(all.reports.length, 150);
  const explicit = await reconcileAllCompanies({ catalog, store }, { companyIds: ["x", "y"] });
  assert.deepEqual(explicit.reports.map((r) => r.companyId), ["x", "y"]);
  const failures: string[] = [];
  const bad = await reconcileAllCompanies({ catalog, store: failing }, { companyIds: ["x"], onFailure: (id) => failures.push(id) });
  assert.deepEqual(bad.failedCompanies, ["x"]);
  assert.deepEqual(failures, ["x"]);
});

test("application: an empty catalog aborts the company with a warning and touches nothing, even with force", async () => {
  const store = new FakeStore(docs, { a: 4 });
  const warnings: string[] = [];
  const empty: TagCatalog = { tagIds: async () => new Set(), tags: async () => [] };
  const report = await reconcileCompanyTagStats({ catalog: empty, store }, "c1", { now: () => NOW, force: true, allowMassDelete: true, onWarn: (event) => warnings.push(event) });
  assert.equal(report.aborted, "empty_catalog");
  assert.equal(report.deleted, 0);
  assert.deepEqual(store.writes, []);
  assert.equal(warnings.length, 1);
});

test("application: deleting more than half of the stat docs is refused with a warning unless allowMassDelete", async () => {
  const many: StatDoc[] = [
    { tagId: "a", memberCount: 1, updatedAtMs: OLD, version: "va" },
    { tagId: "z1", memberCount: 1, updatedAtMs: OLD, version: "v1" },
    { tagId: "z2", memberCount: 1, updatedAtMs: OLD, version: "v2" },
  ];
  const warnings: string[] = [];
  const store = new FakeStore(many, { a: 1 });
  const report = await reconcileCompanyTagStats({ catalog, store }, "c1", { now: () => NOW, force: true, onWarn: (event) => warnings.push(event) });
  assert.equal(report.deletionsRefused, true);
  assert.equal(report.deleted, 0);
  assert.deepEqual(store.writes, []);
  assert.equal(warnings.length, 1);
  const allowed = new FakeStore(many, { a: 1 });
  const done = await reconcileCompanyTagStats({ catalog, store: allowed }, "c1", { now: () => NOW, allowMassDelete: true });
  assert.equal(done.deleted, 2);
});

test("application: a negative count from the store is clamped to zero in the written correction", async () => {
  const store = new FakeStore([{ tagId: "a", memberCount: 4, updatedAtMs: OLD, version: "va" }], { a: -3 });
  const report = await reconcileCompanyTagStats({ catalog: { tagIds: async () => new Set(["a"]), tags: async () => [] }, store }, "c1", { now: () => NOW });
  assert.deepEqual(store.writes, ["set c1/a=0 v=va"]);
  assert.equal(report.drift, 4);
});

test("reconcileAllCompanies: one failing company does not stop the others, under bounded concurrency", async () => {
  const ids = ["c1", "c2", "c3", "c4", "c5", "c6"];
  const base = new FakeStore([], {}, ids);
  let inFlight = 0;
  let peak = 0;
  const flaky: TagReconcileStore = Object.assign(Object.create(base), {
    listStatDocs: async (companyId: string) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      if (companyId === "c3") throw new Error("boom");
      return [];
    },
  }) as TagReconcileStore;
  const failures: string[] = [];
  const result = await reconcileAllCompanies({ catalog, store: flaky }, { onFailure: (id) => failures.push(id), concurrency: 2 });
  assert.deepEqual(result.failedCompanies, ["c3"]);
  assert.deepEqual(result.reports.map((r) => r.companyId), ["c1", "c2", "c4", "c5", "c6"]);
  assert.ok(peak <= 2 && peak >= 1);
});
