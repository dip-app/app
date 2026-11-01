import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";
import type { JoinCompanyResponse } from "../../functions/src/generated/models";
import { joinCodeLookupId } from "../../functions/src/modules/accounts/domain/joinCode";
import { FirestoreMembershipStore } from "../../functions/src/modules/accounts/infrastructure/firestoreMembershipStore";
import { handleJoinCompany } from "../../functions/src/modules/accounts/transport/joinCompanyV1";

// Emulator-backed test of the real Firestore adapter + joinCompanyV1 service.
// It exercises Admin SDK transactions, create() conflicts and server timestamps
// against the Firestore emulator. Auth tokens are supplied directly (the
// Functions runtime verifies real tokens); the email gate is unit-tested.
//
// Run: firebase emulators:exec --project demo-dip --only firestore \
//        "node --import tsx --test gcp/tests/integration/accounts-join-company.test.ts"

const PROJECT = "demo-dip";
const HOST = process.env.FIRESTORE_EMULATOR_HOST;
if (!["127.0.0.1:8080", "127.0.0.1:18080"].includes(HOST ?? "")) throw new Error("Expected a local test emulator.");
if (process.env.FIRESTORE_EMULATOR_HOST !== HOST || (process.env.GCLOUD_PROJECT ?? PROJECT) !== PROJECT) {
  throw new Error(`Refusing to run: set FIRESTORE_EMULATOR_HOST=${HOST} and project ${PROJECT} (use firebase emulators:exec).`);
}
process.env.GCLOUD_PROJECT = PROJECT;

// Load Admin from the Functions workspace so the adapter and test share one SDK instance.
const functionsRequire = createRequire(require.resolve("../../functions/package.json"));
const { initializeApp, deleteApp, getApps } = functionsRequire("firebase-admin/app") as typeof import("firebase-admin/app");
const { getFirestore, Timestamp } = functionsRequire("firebase-admin/firestore") as typeof import("firebase-admin/firestore");

type App = ReturnType<typeof initializeApp>;
let app: App;
let db: ReturnType<typeof getFirestore>;
let store: FirestoreMembershipStore;

const CODE = "TEAM-ALPHA";
const OTHER_CODE = "TEAM-BETA";

function caller(uid: string, overrides: Record<string, unknown> = {}) {
  return {
    uid,
    token: { email: `${uid}@example.invalid`, email_verified: true, ...overrides } as never,
    rawToken: "",
  };
}
const payload = (overrides: Record<string, unknown> = {}) => ({
  contractVersion: 1,
  joinCode: CODE,
  displayName: "Test Person",
  ...overrides,
});
const join = (uid: string, data: unknown = payload()) => handleJoinCompany(store, { auth: caller(uid), data });

async function rejectsWith(promise: Promise<unknown>, code: string, reason: string) {
  await assert.rejects(promise, (error: unknown) => {
    const e = error as { code?: string; details?: { reason?: string } };
    assert.equal(e.code, code);
    assert.equal(e.details?.reason, reason);
    return true;
  });
}

async function clearFirestore() {
  const response = await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, {
    method: "DELETE",
  });
  assert.ok(response.ok, `emulator reset failed: ${response.status}`);
}

before(() => {
  app = getApps()[0] ?? initializeApp({ projectId: PROJECT });
  db = getFirestore(app);
  store = new FirestoreMembershipStore(db);
});

after(async () => {
  await deleteApp(app);
});

beforeEach(async () => {
  await clearFirestore();
  const createdAt = Timestamp.fromDate(new Date("2026-10-28T12:00:00Z"));
  const company = { logoURL: "", emailDomain: "example.invalid", city: "Pittsburgh, PA", officeLatitude: 40.44, officeLongitude: -79.99, createdAt };
  await db.doc("companies/company-alpha").set({ name: "Alpha", ...company });
  await db.doc("companies/company-beta").set({ name: "Beta", ...company });
  await db.doc(`companyAccess/${joinCodeLookupId(CODE)}`).set({ companyId: "company-alpha" });
  await db.doc(`companyAccess/${joinCodeLookupId(OTHER_CODE)}`).set({ companyId: "company-beta" });
});

describe("joinCompanyV1 against the Firestore emulator", () => {
  test("first join creates users/{uid} with contract defaults and a server timestamp", async () => {
    const before = Date.now();
    const response = await join("u-new", payload({ joinCode: "  team-alpha ", displayName: " Pat Lee " }));
    assert.deepEqual(response, { contractVersion: 1, companyId: "company-alpha", role: "member" });

    const snap = await db.doc("users/u-new").get();
    assert.ok(snap.exists);
    const { createdAt, ...rest } = snap.data() as Record<string, unknown>;
    assert.deepEqual(rest, {
      companyId: "company-alpha",
      displayName: "Pat Lee",
      email: "u-new@example.invalid",
      photoURL: "",
      avatarId: "",
      department: "",
      jobTitle: "",
      city: "",
      role: "member",
      interestTagIds: [],
      travelRadiusMiles: 20,
      availability: [],
      friendIds: [],
      favoritePhotoIds: [],
      pointsBalance: 0,
    });
    assert.ok(createdAt instanceof Timestamp, "createdAt must be a Firestore Timestamp");
    assert.ok(createdAt.toMillis() >= before - 60_000, "createdAt is server time");
    assert.equal("id" in rest, false, "document id is not persisted");
  });

  test("same-company replay returns the stored membership and does not rewrite the profile", async () => {
    await join("u-replay");
    const first = await db.doc("users/u-replay").get();
    const replay = await join("u-replay", payload({ displayName: "Renamed" }));
    assert.deepEqual(replay, { contractVersion: 1, companyId: "company-alpha", role: "member" });
    const second = await db.doc("users/u-replay").get();
    assert.deepEqual(second.data(), first.data());
    assert.ok(second.updateTime?.isEqual(first.updateTime!), "replay performs no write");
  });

  test("existing admin replays as admin without changes", async () => {
    await db.doc("users/u-admin").set({ companyId: "company-alpha", role: "admin", pointsBalance: 75 });
    assert.deepEqual(await join("u-admin"), { contractVersion: 1, companyId: "company-alpha", role: "admin" });
    assert.deepEqual((await db.doc("users/u-admin").get()).data(), { companyId: "company-alpha", role: "admin", pointsBalance: 75 });
  });

  test("member of another company is refused and left unchanged", async () => {
    await db.doc("users/u-beta").set({ companyId: "company-beta", role: "member" });
    await rejectsWith(join("u-beta"), "failed-precondition", "MEMBERSHIP_CONFLICT");
    assert.deepEqual((await db.doc("users/u-beta").get()).data(), { companyId: "company-beta", role: "member" });
  });

  test("wrong code, orphaned code and malformed lookup are the same not-found with no writes", async () => {
    await db.doc(`companyAccess/${joinCodeLookupId("ORPHAN")}`).set({ companyId: "company-deleted" });
    await db.doc(`companyAccess/${joinCodeLookupId("BROKEN")}`).set({ companyId: 42 });
    for (const joinCode of ["nope", "orphan", "broken"]) {
      await rejectsWith(join("u-wrong", payload({ joinCode })), "not-found", "INVALID_JOIN_CODE");
    }
    assert.equal((await db.doc("users/u-wrong").get()).exists, false);
  });

  test("unverified caller is refused before any lookup or write", async () => {
    await rejectsWith(
      handleJoinCompany(store, { auth: caller("u-unverified", { email_verified: false }), data: payload() }),
      "permission-denied",
      "EMAIL_NOT_VERIFIED",
    );
    assert.equal((await db.doc("users/u-unverified").get()).exists, false);
  });

  test("stored profile with a non-string role is not treated as a membership", async () => {
    await db.doc("users/u-corrupt").set({ companyId: "company-alpha", role: 7 });
    await rejectsWith(join("u-corrupt"), "internal", "INVALID_STORED_MEMBERSHIP");
  });

  test("concurrent first joins by one user create exactly one profile", async () => {
    const results = await Promise.all([1, 2, 3, 4].map((n) => join("u-race", payload({ displayName: `Attempt ${n}` }))));
    for (const result of results) {
      assert.deepEqual(result, { contractVersion: 1, companyId: "company-alpha", role: "member" });
    }
    const users = await db.collection("users").get();
    assert.deepEqual(users.docs.map((d) => d.id), ["u-race"]);
  });

  test("concurrent joins to two companies leave one membership and one conflict", async () => {
    const results = await Promise.allSettled([join("u-split"), join("u-split", payload({ joinCode: OTHER_CODE }))]);
    const ok = results.filter((r): r is PromiseFulfilledResult<JoinCompanyResponse> => r.status === "fulfilled");
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    assert.equal(ok.length, 1);
    assert.equal(failed.length, 1);
    assert.equal((failed[0]!.reason as { details?: { reason?: string } }).details?.reason, "MEMBERSHIP_CONFLICT");
    const stored = (await db.doc("users/u-split").get()).data();
    assert.equal(stored?.companyId, ok[0]!.value.companyId);
  });
});
