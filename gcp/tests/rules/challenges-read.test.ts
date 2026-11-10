import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { Timestamp } from "firebase/firestore";

let env: RulesTestEnvironment;
const company = "challenge-alpha";
const other = "challenge-beta";
const now = Timestamp.fromMillis(Date.now());
const challenge = (companyId: string, startMs: number) => ({
  companyId, title: "Fitness", description: "Move together.", tagIds: ["tag-fitness"], type: "weekly",
  goal: 3, goalUnit: "workouts", coverImageURL: "catalog://theme/fitness",
  startDate: Timestamp.fromMillis(startMs), endDate: Timestamp.fromMillis(startMs + 7 * 86_400_000 - 1000),
  pointsReward: 50, participantCount: 0, completedCount: 0, createdBy: "admin", createdAt: Timestamp.fromMillis(1000),
  updatedAt: Timestamp.fromMillis(1000), revision: 1,
});
const client = (uid: string, verified = true) => env.authenticatedContext(uid, { email_verified: verified }).firestore();
const col = (uid: string, companyId = company) => client(uid).collection(`companies/${companyId}/challenges`);
/** The iOS Home query: current/upcoming themes ordered by endDate. */
const home = (uid: string, companyId = company) => col(uid, companyId).where("endDate", ">=", now).orderBy("endDate");

before(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-dip", firestore: {
    host: "127.0.0.1", port: 8080, rules: readFileSync("gcp/firestore.rules", "utf8"),
  }});
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.doc("users/ch-member").set({ companyId: company, role: "member" });
    await db.doc("users/ch-admin").set({ companyId: company, role: "admin" });
    await db.doc("users/ch-outsider").set({ companyId: other, role: "member" });
    await db.doc("users/ch-outsider-admin").set({ companyId: other, role: "admin" });
    await db.doc(`companies/${company}/challenges/current`).set(challenge(company, Date.now() - 86_400_000));
    await db.doc(`companies/${company}/challenges/next`).set(challenge(company, Date.now() + 6 * 86_400_000 + 1000));
    // A tenant-mismatched document (never written by the server); ended, so the Home query skips it.
    await db.doc(`companies/${company}/challenges/malformed`).set(challenge(other, Date.now() - 30 * 86_400_000));
    await db.doc(`companies/${company}/challenges/current/submissions/ch-member`).set({ status: "pending" });
    await db.doc(`companies/${company}/commandReceipts/challenge_ch-admin_x`).set({ kind: "challenge", hash: "h", challengeId: "current" });
    await db.doc(`companies/${other}/challenges/theirs`).set(challenge(other, Date.now()));
  });
});
after(async () => { await env?.cleanup(); });

test("same-company members get themes and run the bounded Home query", async () => {
  await assertSucceeds(col("ch-member").doc("current").get());
  const missing = await assertSucceeds(col("ch-member").doc("missing").get());
  assert.equal(missing.exists, false);
  // Spec section 4 Home query: endDate >= now ordered by endDate, limit 5 (no composite index).
  const page = await assertSucceeds(home("ch-member").limit(5).get());
  assert.deepEqual(page.docs.map((d) => d.id), ["current", "next"]);
  await assertSucceeds(home("ch-member").limit(20).get());
});

test("member lists must be bounded to 20", async () => {
  await assertFails(home("ch-member").limit(21).get());
  await assertFails(home("ch-member").get());
  await assertFails(col("ch-member").get());
  await assertSucceeds(col("ch-member").limit(5).get());
});

test("payload-tenant mismatches are denied", async () => {
  await assertFails(col("ch-member").doc("malformed").get());
  await assertFails(col("ch-admin").doc("malformed").get());
});

test("organizers list all of their own company's themes", async () => {
  await assertSucceeds(col("ch-admin").get());
  await assertSucceeds(col("ch-admin").doc("current").get());
});

test("signed-out, unverified, absent-profile and other-company callers cannot read", async () => {
  const dbs = [env.unauthenticatedContext().firestore(), client("ch-member", false), client("ch-no-profile"), client("ch-outsider"), client("ch-outsider-admin")];
  for (const db of dbs) {
    await assertFails(db.doc(`companies/${company}/challenges/current`).get());
    await assertFails(db.doc(`companies/${company}/challenges/missing`).get());
    await assertFails(db.collection(`companies/${company}/challenges`).limit(5).get());
    await assertFails(db.collection(`companies/${company}/challenges`).where("endDate", ">=", now).orderBy("endDate").limit(5).get());
  }
  await assertFails(client("ch-member").collectionGroup("challenges").where("companyId", "==", company).limit(5).get());
});

test("no client writes themes or counts, even an organizer; submissions and receipts stay denied", async () => {
  for (const uid of ["ch-member", "ch-admin"]) {
    await assertFails(col(uid).doc("new").set(challenge(company, Date.now() + 60 * 86_400_000)));
    await assertFails(col(uid).doc("current").update({ participantCount: 99 }));
    await assertFails(col(uid).doc("current").update({ completedCount: 1, revision: 2 }));
    await assertFails(col(uid).doc("current").update({ title: "Changed" }));
    await assertFails(col(uid).doc("current").delete());
    await assertFails(client(uid).doc(`companies/${company}/challenges/current/submissions/ch-member`).get());
    await assertFails(client(uid).doc(`companies/${company}/challenges/current/submissions/${uid}`).set({ status: "approved" }));
    await assertFails(client(uid).doc(`companies/${company}/commandReceipts/challenge_ch-admin_x`).get());
  }
});
