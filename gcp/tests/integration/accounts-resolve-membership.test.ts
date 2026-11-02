import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";
import type { ResolveMembershipResponse } from "../../functions/src/generated/models";
import { FirestoreMembershipStore } from "../../functions/src/modules/accounts/infrastructure/firestoreMembershipStore";
import { handleResolveMembership } from "../../functions/src/modules/accounts/transport/resolveMembershipV1";

// Emulator-backed test of the real Firestore adapter + resolveMembershipV1
// service: Admin SDK transactions, create() conflicts, server timestamps and the
// display-name refresh. Token claims are supplied directly (the Functions
// runtime verifies real tokens; accounts-callable.test.ts covers that path).
//
// Run: npm run test:accounts:integration

const PROJECT = "demo-dip";
const HOST = process.env.FIRESTORE_EMULATOR_HOST;
if (!["127.0.0.1:8080", "127.0.0.1:18080"].includes(HOST ?? "")) throw new Error("Expected a local test emulator.");
if ((process.env.GCLOUD_PROJECT ?? PROJECT) !== PROJECT) throw new Error(`Refusing to run outside project ${PROJECT}.`);
process.env.GCLOUD_PROJECT = PROJECT;

// Load Admin from the Functions workspace so the adapter and test share one SDK instance.
const functionsRequire = createRequire(require.resolve("../../functions/package.json"));
const { initializeApp, deleteApp, getApps } = functionsRequire("firebase-admin/app") as typeof import("firebase-admin/app");
const { getFirestore, Timestamp } = functionsRequire("firebase-admin/firestore") as typeof import("firebase-admin/firestore");

type App = ReturnType<typeof initializeApp>;
let app: App;
let db: ReturnType<typeof getFirestore>;
let store: FirestoreMembershipStore;

function caller(uid: string, overrides: Record<string, unknown> = {}) {
  return {
    uid,
    rawToken: "",
    token: { email: `${uid}@eng.alpha.test`, email_verified: true, name: "Test Person", firebase: { sign_in_provider: "google.com" }, ...overrides } as never,
  };
}
const REQUEST = { contractVersion: 1 };
const resolve = (uid: string, overrides: Record<string, unknown> = {}) =>
  handleResolveMembership(store, { auth: caller(uid, overrides), data: REQUEST });

async function rejectsWith(promise: Promise<unknown>, code: string, reason: string) {
  await assert.rejects(promise, (error: unknown) => {
    const e = error as { code?: string; details?: { reason?: string } };
    assert.equal(e.code, code);
    assert.equal(e.details?.reason, reason);
    return true;
  });
}

async function clearFirestore() {
  const response = await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  assert.ok(response.ok, `emulator reset failed: ${response.status}`);
}

before(() => {
  app = getApps()[0] ?? initializeApp({ projectId: PROJECT });
  db = getFirestore(app);
  store = new FirestoreMembershipStore(db);
});
after(async () => { await deleteApp(app); });

beforeEach(async () => {
  await clearFirestore();
  const createdAt = Timestamp.fromDate(new Date("2026-10-28T12:00:00Z"));
  const company = { logoURL: "", city: "Pittsburgh, PA", officeLatitude: 40.44, officeLongitude: -79.99, createdAt };
  await db.doc("companies/company-alpha").set({ name: "Alpha", emailDomain: "alpha.test", ...company });
  await db.doc("companies/company-beta").set({ name: "Beta", emailDomain: "beta.co.uk", ...company });
  await db.doc("companyDomains/alpha.test").set({ companyId: "company-alpha" });
  await db.doc("companyDomains/beta.co.uk").set({ companyId: "company-beta" });
});

describe("resolveMembershipV1 against the Firestore emulator", () => {
  test("first resolution from a subdomain writes contract defaults, OAuth name and a server timestamp", async () => {
    const started = Date.now();
    assert.deepEqual(await resolve("u-new", { name: " Pat  Lee " }), { contractVersion: 1, companyId: "company-alpha", role: "member" });
    const snap = await db.doc("users/u-new").get();
    const { createdAt, ...rest } = snap.data() as Record<string, unknown>;
    assert.deepEqual(rest, {
      companyId: "company-alpha", displayName: "Pat Lee", email: "u-new@eng.alpha.test", photoURL: "", avatarId: "",
      department: "", jobTitle: "", city: "", role: "member", interestTagIds: [], travelRadiusMiles: 20,
      availability: [], friendIds: [], favoritePhotoIds: [], pointsBalance: 0,
    });
    assert.ok(createdAt instanceof Timestamp);
    assert.ok(createdAt.toMillis() >= started - 60_000);
  });

  test("unchanged replay performs no write; a new OAuth name is refreshed and nothing else changes", async () => {
    await resolve("u-replay");
    const first = await db.doc("users/u-replay").get();
    await resolve("u-replay");
    const second = await db.doc("users/u-replay").get();
    assert.ok(second.updateTime?.isEqual(first.updateTime!), "replay performs no write");
    await resolve("u-replay", { name: "Renamed Person" });
    assert.deepEqual((await db.doc("users/u-replay").get()).data(), { ...first.data(), displayName: "Renamed Person" });
  });

  test("existing admin stays admin", async () => {
    await db.doc("users/u-admin").set({ companyId: "company-alpha", role: "admin", displayName: "Test Person", pointsBalance: 75 });
    assert.deepEqual(await resolve("u-admin"), { contractVersion: 1, companyId: "company-alpha", role: "admin" });
    assert.equal((await db.doc("users/u-admin").get()).get("pointsBalance"), 75);
  });

  test("member of another company is refused and unchanged", async () => {
    await db.doc("users/u-beta").set({ companyId: "company-beta", role: "member", displayName: "Test Person" });
    await rejectsWith(resolve("u-beta"), "failed-precondition", "MEMBERSHIP_CONFLICT");
    assert.equal((await db.doc("users/u-beta").get()).get("companyId"), "company-beta");
  });

  test("unmapped, orphaned and malformed mappings are one NO_COMPANY_FOR_DOMAIN with no writes", async () => {
    await db.doc("companyDomains/orphan.test").set({ companyId: "company-deleted" });
    await db.doc("companyDomains/broken.test").set({ companyId: 42 });
    for (const domain of ["unknown.test", "orphan.test", "broken.test"]) {
      await rejectsWith(resolve("u-none", { email: `x@${domain}` }), "not-found", "NO_COMPANY_FOR_DOMAIN");
    }
    assert.equal((await db.doc("users/u-none").get()).exists, false);
  });

  test("personal domains and non-Google providers are refused with no writes", async () => {
    await rejectsWith(resolve("u-gmail", { email: "x@gmail.com" }), "permission-denied", "PERSONAL_EMAIL_DOMAIN");
    await rejectsWith(resolve("u-pass", { firebase: { sign_in_provider: "password" } }), "permission-denied", "PROVIDER_NOT_ALLOWED");
    assert.equal((await db.doc("users/u-gmail").get()).exists, false);
    assert.equal((await db.doc("users/u-pass").get()).exists, false);
  });

  test("multi-part public suffix maps to its registrable root", async () => {
    assert.deepEqual(await resolve("u-uk", { email: "x@london.beta.co.uk" }), { contractVersion: 1, companyId: "company-beta", role: "member" });
  });

  test("concurrent first resolutions by one user create exactly one profile", async () => {
    const results = await Promise.all([1, 2, 3, 4].map(() => resolve("u-race")));
    for (const result of results) assert.deepEqual(result, { contractVersion: 1, companyId: "company-alpha", role: "member" });
    assert.deepEqual((await db.collection("users").get()).docs.map((d) => d.id), ["u-race"]);
  });

  test("concurrent resolutions from two domains leave one membership and one conflict", async () => {
    const results = await Promise.allSettled([resolve("u-split"), resolve("u-split", { email: "x@beta.co.uk" })]);
    const ok = results.filter((r): r is PromiseFulfilledResult<ResolveMembershipResponse> => r.status === "fulfilled");
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    assert.equal(ok.length, 1);
    assert.equal(failed.length, 1);
    assert.equal((failed[0]!.reason as { details?: { reason?: string } }).details?.reason, "MEMBERSHIP_CONFLICT");
    assert.equal((await db.doc("users/u-split").get()).get("companyId"), ok[0]!.value.companyId);
  });
});
