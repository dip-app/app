import { strict as assert } from "node:assert";
import { test } from "node:test";
import { applyUserInterestWrite } from "../../functions/src/modules/tags/application/applyUserWrite";
import { getInterestSummary } from "../../functions/src/modules/tags/application/interestSummary";
import type { TagCatalog, TagStatsStore } from "../../functions/src/modules/tags/application/ports";
import {
  countingMembership, interestFieldsChanged, receiptIdFor, summarizeInterests, tagCountDeltas, type TagDeltas,
} from "../../functions/src/modules/tags/domain/tagCounts";

const catalog = new Set(["cook", "run", "chess"]);
const user = (companyId: string | undefined, interestTagIds: unknown, extra: Record<string, unknown> = {}) => ({ companyId, interestTagIds, ...extra });
const plain = (deltas: TagDeltas) => Object.fromEntries([...deltas].map(([c, tags]) => [c, Object.fromEntries(tags)]));

test("countingMembership: missing, no company, deactivated; missing status counts; dedupe and catalog filter", () => {
  assert.equal(countingMembership(undefined, catalog), null);
  assert.equal(countingMembership("x", catalog), null);
  assert.equal(countingMembership(user("", ["cook"]), catalog), null);
  assert.equal(countingMembership(user(undefined, ["cook"]), catalog), null);
  assert.equal(countingMembership(user("a", ["cook"], { status: "deactivated" }), catalog), null);
  assert.deepEqual(countingMembership(user("a", ["cook"]), catalog), { companyId: "a", tagIds: new Set(["cook"]) });
  assert.deepEqual(countingMembership(user("a", ["cook", "cook", "nope", 5, null, "run"], { status: "active" }), catalog)?.tagIds, new Set(["cook", "run"]));
  assert.deepEqual(countingMembership(user("a", "cook"), catalog)?.tagIds, new Set());
});

test("tagCountDeltas: add, remove, replace, duplicates, unknown and non-string entries", () => {
  assert.deepEqual(plain(tagCountDeltas(user("a", []), user("a", ["cook"]), catalog)), { a: { cook: 1 } });
  assert.deepEqual(plain(tagCountDeltas(user("a", ["cook"]), user("a", []), catalog)), { a: { cook: -1 } });
  assert.deepEqual(plain(tagCountDeltas(user("a", ["cook"]), user("a", ["run"]), catalog)), { a: { cook: -1, run: 1 } });
  assert.deepEqual(plain(tagCountDeltas(user("a", ["cook"]), user("a", ["cook", "cook", "run", "run"]), catalog)), { a: { run: 1 } });
  assert.deepEqual(plain(tagCountDeltas(user("a", []), user("a", ["ghost", 7, null, {}]), catalog)), {});
  assert.deepEqual(plain(tagCountDeltas(user("a", ["cook"]), user("a", ["cook"]), catalog)), {});
});

test("tagCountDeltas: deactivation, reactivation, missing status, create, delete, company change", () => {
  const active = user("a", ["cook", "run"]);
  const off = user("a", ["cook", "run"], { status: "deactivated" });
  assert.deepEqual(plain(tagCountDeltas(active, off, catalog)), { a: { cook: -1, run: -1 } });
  assert.deepEqual(plain(tagCountDeltas(off, active, catalog)), { a: { cook: 1, run: 1 } });
  assert.deepEqual(plain(tagCountDeltas(user("a", ["cook"], { status: "active" }), user("a", ["cook"]), catalog)), {});
  assert.deepEqual(plain(tagCountDeltas(undefined, active, catalog)), { a: { cook: 1, run: 1 } });
  assert.deepEqual(plain(tagCountDeltas(active, undefined, catalog)), { a: { cook: -1, run: -1 } });
  assert.deepEqual(plain(tagCountDeltas(user("a", ["cook"]), user("b", ["cook", "chess"]), catalog)), { a: { cook: -1 }, b: { cook: 1, chess: 1 } });
});

test("interestFieldsChanged", () => {
  assert.equal(interestFieldsChanged(undefined, user("a", [])), true);
  assert.equal(interestFieldsChanged(user("a", []), undefined), true);
  assert.equal(interestFieldsChanged(undefined, undefined), false);
  assert.equal(interestFieldsChanged(user("a", ["x", "y"], { displayName: "A" }), user("a", ["y", "x", "x"], { displayName: "B" })), false);
  assert.equal(interestFieldsChanged(user("a", ["x"]), user("b", ["x"])), true);
  assert.equal(interestFieldsChanged(user("a", ["x"]), user("a", ["x"], { status: "deactivated" })), true);
  assert.equal(interestFieldsChanged(user("a", ["x"]), user("a", ["x", "y"])), true);
  assert.equal(interestFieldsChanged(user("a", ["x"]), user("a", ["y"])), true);
});

test("receiptIdFor keeps safe ids and hashes the rest", () => {
  assert.equal(receiptIdFor("abc-123_DEF"), "abc-123_DEF");
  assert.match(receiptIdFor("a/b"), /^[0-9a-f]{64}$/);
  assert.match(receiptIdFor("x".repeat(201)), /^[0-9a-f]{64}$/);
  assert.match(receiptIdFor(""), /^[0-9a-f]{64}$/);
  assert.equal(receiptIdFor("a/b"), receiptIdFor("a/b"));
});

class FakeCatalog implements TagCatalog {
  tagReads = 0;
  constructor(readonly list = [{ id: "cook", name: "Cooking" }, { id: "run", name: "Running" }, { id: "chess", name: "Chess" }]) {}
  async tagIds() { this.tagReads++; return new Set(this.list.map((tag) => tag.id)); }
  async tags() { this.tagReads++; return this.list; }
}

class FakeStore implements TagStatsStore {
  counts = new Map<string, number>();
  receipts = new Set<string>();
  applyCalls = 0;
  readPaths: string[] = [];
  async applyDeltas(receiptId: string, receiptCompanyId: string, deltas: TagDeltas) {
    this.applyCalls++;
    const key = `${receiptCompanyId}/${receiptId}`;
    if (this.receipts.has(key)) return "duplicate" as const;
    this.receipts.add(key);
    for (const [company, tags] of deltas) for (const [tag, delta] of tags) this.counts.set(`${company}/${tag}`, (this.counts.get(`${company}/${tag}`) ?? 0) + delta);
    return "applied" as const;
  }
  async listStats(companyId: string) {
    this.readPaths.push(`companies/${companyId}/tagStats`);
    return [...this.counts].filter(([key]) => key.startsWith(`${companyId}/`)).map(([key, memberCount]) => ({ tagId: key.slice(companyId.length + 1), memberCount }));
  }
}

test("application: ordinary profile edit is skipped without a catalog read or write", async () => {
  const deps = { catalog: new FakeCatalog(), store: new FakeStore() };
  const out = await applyUserInterestWrite(deps, { eventId: "e1", before: user("a", ["cook"], { displayName: "A" }), after: user("a", ["cook"], { displayName: "B" }) });
  assert.deepEqual(out, { result: "skipped", companies: 0, tags: 0 });
  assert.equal(deps.catalog.tagReads, 0);
  assert.equal(deps.store.applyCalls, 0);
});

test("application: unknown-only change is unchanged and writes nothing", async () => {
  const deps = { catalog: new FakeCatalog(), store: new FakeStore() };
  const out = await applyUserInterestWrite(deps, { eventId: "e1", before: user("a", []), after: user("a", ["ghost"]) });
  assert.equal(out.result, "unchanged");
  assert.equal(deps.store.applyCalls, 0);
});

test("application: applies once, a replayed event id is a duplicate and counts do not move", async () => {
  const deps = { catalog: new FakeCatalog(), store: new FakeStore() };
  const input = { eventId: "evt/1", before: user("a", ["cook"]), after: user("a", ["run", "chess"]) };
  assert.deepEqual(await applyUserInterestWrite(deps, input), { result: "applied", companies: 1, tags: 3 });
  const snapshot = new Map(deps.store.counts);
  assert.equal((await applyUserInterestWrite(deps, input)).result, "duplicate");
  assert.deepEqual(deps.store.counts, snapshot);
  assert.equal(deps.store.counts.get("a/cook"), -1);
  assert.equal(deps.store.counts.get("a/run"), 1);
});

test("application: delete uses the before company for the receipt; company change touches two companies", async () => {
  const deps = { catalog: new FakeCatalog(), store: new FakeStore() };
  await applyUserInterestWrite(deps, { eventId: "d1", before: user("a", ["cook"]), after: undefined });
  assert.ok(deps.store.receipts.has("a/d1"));
  const out = await applyUserInterestWrite(deps, { eventId: "c1", before: user("a", ["cook"]), after: user("b", ["cook"]) });
  assert.deepEqual(out, { result: "applied", companies: 2, tags: 2 });
  assert.ok(deps.store.receipts.has("b/c1"));
});

const stat = (tagId: string, memberCount: number) => ({ tagId, memberCount });
const names = (...ids: string[]) => ids.map((id) => ({ id, name: id.toUpperCase() }));

test("summarizeInterests: suppression at 4 vs 5, zero and missing tags", () => {
  const summary = summarizeInterests([stat("a", 5), stat("b", 4), stat("c", 0)], names("a", "b", "c", "d"));
  assert.deepEqual(summary.top, [{ tagId: "a", name: "A", memberCount: 5, suppressed: false }]);
  assert.deepEqual(summary.thin.map((e) => [e.tagId, e.memberCount, e.suppressed]), [["b", null, true], ["c", null, true], ["d", null, true]]);
  assert.equal(summary.tagsWithStats, 3);
});

test("summarizeInterests: negative clamp, ordering, ties, limit, thin excludes top, non-catalog ignored", () => {
  const stats = [stat("a", 9), stat("b", 9), stat("c", 7), stat("d", 6), stat("e", 5), stat("f", 5), stat("g", -3), stat("ghost", 99)];
  const catalogList = names("a", "b", "c", "d", "e", "f", "g");
  const summary = summarizeInterests(stats, catalogList, { limit: 3 });
  assert.deepEqual(summary.top.map((e) => [e.tagId, e.memberCount]), [["a", 9], ["b", 9], ["c", 7]]);
  assert.deepEqual(summary.thin.map((e) => [e.tagId, e.memberCount]), [["g", null], ["e", 5], ["f", 5]]);
  assert.ok(!summary.top.some((e) => e.tagId === "ghost"));
  const all = summarizeInterests(stats, catalogList, { limit: 10 });
  assert.equal(all.thin.filter((e) => all.top.some((t) => t.tagId === e.tagId)).length, 0);
});

test("summarizeInterests: suppressed entries are ordered by name only", () => {
  const summary = summarizeInterests([stat("z", 1), stat("m", 3), stat("a", 2)], [{ id: "z", name: "Alpha" }, { id: "m", name: "Beta" }, { id: "a", name: "Gamma" }]);
  assert.deepEqual(summary.thin.map((e) => e.name), ["Alpha", "Beta", "Gamma"]);
  assert.ok(summary.thin.every((e) => e.memberCount === null));
});

test("getInterestSummary reads only the requested company and rejects invalid ids", async () => {
  const store = new FakeStore();
  store.counts.set("a/cook", 8); store.counts.set("b/cook", 20); store.counts.set("a/run", 2);
  const deps = { catalog: new FakeCatalog(), store };
  const summary = await getInterestSummary(deps, "a");
  assert.deepEqual(store.readPaths, ["companies/a/tagStats"]);
  assert.deepEqual(summary.top.map((e) => [e.tagId, e.memberCount]), [["cook", 8]]);
  for (const bad of ["a/b", "", "x".repeat(201)]) await assert.rejects(getInterestSummary(deps, bad));
  assert.deepEqual(store.readPaths, ["companies/a/tagStats"]);
});
