import { strict as assert } from "node:assert";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { reconcileCompanyTagStats } from "../../functions/src/modules/tags/application/reconcileTagStats";
import { FirestoreTagReconcileStore } from "../../functions/src/modules/tags/infrastructure/firestoreTagReconcile";
import { FirestoreTagCatalog } from "../../functions/src/modules/tags/infrastructure/firestoreTagStats";

// Run with: npm run test:tags:integration. The functions emulator is live, so the users trigger maintains the counts we then corrupt.
const projectId = "demo-dip";
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
if (!firestoreHost || !/^(127\.0\.0\.1|localhost):[0-9]+$/.test(firestoreHost)) throw new Error("Requires local emulators.");
if ((process.env.GCLOUD_PROJECT ?? projectId) !== projectId) throw new Error("Requires demo-dip.");
const req = createRequire(require.resolve("../../functions/package.json"));
const adminApp = req("firebase-admin/app") as typeof import("firebase-admin/app");
const adminFirestore = req("firebase-admin/firestore") as typeof import("firebase-admin/firestore");

async function eventually<T>(read: () => Promise<T>, accept: (value: T) => boolean, label: string, timeoutMs = 60_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (accept(value)) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label} (last: ${JSON.stringify(value)})`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

test("reconcile corrects drift, recreates, deletes orphans and respects recency", { timeout: 300_000 }, async (t) => {
  const stamp = `rec-${Date.now()}`;
  const app = adminApp.initializeApp({ projectId }, stamp);
  t.after(() => adminApp.deleteApp(app));
  const db = adminFirestore.getFirestore(app);
  const { Timestamp } = adminFirestore;
  const A = `${stamp}-a`;
  const B = `${stamp}-b`;
  const C = `${stamp}-c`;
  const orphan = `${stamp}-orphan`;
  // The trigger caches the catalog, so reuse tags that already exist (an earlier test file may have primed the cache) and only top up to three.
  const tagIds = (await db.collection("tags").get()).docs.map((doc) => doc.id).slice(0, 3);
  while (tagIds.length < 3) {
    const id = `${stamp}-t${tagIds.length}`;
    await db.doc(`tags/${id}`).set({ name: `Tag ${tagIds.length}`, icon: "star", sortOrder: tagIds.length });
    tagIds.push(id);
  }
  const [t1, t2, t3] = tagIds as [string, string, string];

  const profile = (companyId: string, interestTagIds: string[], extra: Record<string, unknown> = {}) => ({
    companyId, displayName: "Synthetic Member", email: `${stamp}@synthetic.test`, photoURL: "", avatarId: "avatar-1",
    department: "Engineering", jobTitle: "", city: "", role: "member", interestTagIds, travelRadiusMiles: 20, availability: [],
    friendIds: [], favoritePhotoIds: [], pointsBalance: 0, createdAt: Timestamp.now(), ...extra,
  });
  await db.doc(`users/${stamp}-u1`).set(profile(A, [t1, t2, t3], { status: "active" }));
  await db.doc(`users/${stamp}-u2`).set(profile(A, [t1, t3])); // no status field: counts as active
  await db.doc(`users/${stamp}-u3`).set(profile(A, [t1, t2, t3], { status: "deactivated" }));
  await db.doc(`users/${stamp}-u4`).set(profile(B, [t1]));
  await db.doc(`users/${stamp}-u5`).set(profile(C, [t1]));

  const stat = (company: string, tagId: string) => db.doc(`companies/${company}/tagStats/${tagId}`);
  const countOf = async (company: string, tagId: string) => {
    const value: unknown = (await stat(company, tagId).get()).get("memberCount");
    return typeof value === "number" ? value : null;
  };
  const expectCount = (company: string, tagId: string, expected: number) =>
    eventually(() => countOf(company, tagId), (value) => value === expected, `${tagId} == ${expected}`);
  await expectCount(A, t1, 2); await expectCount(A, t2, 1); await expectCount(A, t3, 2); await expectCount(C, t1, 1); await expectCount(B, t1, 1);

  const longAgo = Timestamp.fromMillis(Date.now() - 3_600_000);
  await stat(A, t1).set({ tagId: t1, memberCount: 99, updatedAt: longAgo });
  await stat(A, t2).delete();
  await stat(A, orphan).set({ tagId: orphan, memberCount: 4, updatedAt: longAgo });
  await stat(C, t1).set({ tagId: t1, memberCount: 7, updatedAt: Timestamp.now() }); // recent
  const watched = [[A, t1], [A, t2], [A, t3], [C, t1], [A, orphan], [B, t1]] as const;
  const snapshot = async () => Object.fromEntries(await Promise.all(watched.map(async ([c, id]) => {
    const doc = await stat(c, id).get();
    return [`${c.slice(-1)}/${id === orphan ? "orphan" : tagIds.indexOf(id) + 1}`, doc.exists ? `${doc.updateTime!.toMillis()}:${doc.get("memberCount")}` : "missing"];
  })));

  const deps = { catalog: new FirestoreTagCatalog(db, 0), store: new FirestoreTagReconcileStore(db) };
  const before = await snapshot();
  const sameAsBefore = (after: Record<string, string>, keys: string[]) => keys.forEach((k) => assert.equal(after[k], before[k], k));

  await t.test("a dry run changes nothing, in code and through the script", async () => {
    const report = await reconcileCompanyTagStats(deps, A, { dryRun: true });
    assert.equal(report.corrected, 2); // t1 drift and t2 recreate
    assert.equal(report.deleted, 1);
    const recent = await reconcileCompanyTagStats(deps, C, { dryRun: true });
    assert.deepEqual(recent.skippedRecentTags, [t1]);
    assert.deepEqual(await snapshot(), before);

    const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", "gcp/scripts/backfill-tag-stats.ts", "--company", A, "--company", C], {
      env: { ...process.env, GCLOUD_PROJECT: projectId },
    });
    assert.match(stdout, /^DRY-RUN emulator /);
    assert.match(stdout, /Dry run: nothing was written/);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test("real run fixes drift, recreates, deletes the orphan, skips recent and leaves correct and other-company docs untouched", async () => {
    const report = await reconcileCompanyTagStats(deps, A, { force: false });
    assert.equal(report.corrected, 2);
    assert.equal(report.deleted, 1);
    assert.equal(report.skippedConcurrent, 0);
    assert.equal(report.drift, 97 + 1);
    const after = await snapshot();
    assert.equal(await countOf(A, t1), 2);
    assert.equal(await countOf(A, t2), 1);
    const recreated = (await stat(A, t2).get()).data()!;
    assert.equal(recreated.tagId, t2);
    assert.ok(recreated.reconciledAt && recreated.updatedAt);
    assert.equal((await stat(A, orphan).get()).exists, false);
    assert.ok((await stat(A, t1).get()).get("reconciledAt"));
    sameAsBefore(after, ["a/3", "b/1"]);
    assert.equal(await countOf(A, t3), 2); // the correct doc kept its count and was not rewritten
  });

  await t.test("a recent doc is skipped without force", async () => {
    const report = await reconcileCompanyTagStats(deps, C, { force: false });
    assert.equal(report.skippedRecent, 1);
    assert.equal(report.corrected, 0);
    assert.equal(await countOf(C, t1), 7);
    sameAsBefore(await snapshot(), ["c/1"]);
  });

  await t.test("a second run writes nothing", async () => {
    const mid = await snapshot();
    const report = await reconcileCompanyTagStats(deps, A, { force: false });
    assert.equal(report.corrected + report.deleted, 0);
    assert.deepEqual(await snapshot(), { ...mid });
  });

  await t.test("force corrects the recent doc", async () => {
    const report = await reconcileCompanyTagStats(deps, C, { force: true });
    assert.equal(report.corrected, 1);
    assert.equal(await countOf(C, t1), 1);
  });

  await t.test("a write between read and correction is reported as skippedConcurrent", async () => {
    await stat(A, t1).update({ memberCount: 50, updatedAt: longAgo });
    const racing = new FirestoreTagReconcileStore(db);
    const listStatDocs = racing.listStatDocs.bind(racing);
    racing.listStatDocs = async (company) => {
      const docs = await listStatDocs(company);
      await stat(A, t1).update({ memberCount: 51 }); // a trigger increment landing after our read
      return docs;
    };
    const report = await reconcileCompanyTagStats({ catalog: deps.catalog, store: racing }, A, { force: true });
    assert.equal(report.skippedConcurrent, 1);
    assert.equal(await countOf(A, t1), 51);
    const fixed = await reconcileCompanyTagStats(deps, A, { force: true });
    assert.equal(fixed.corrected, 1);
    assert.equal(await countOf(A, t1), 2);
  });
});
