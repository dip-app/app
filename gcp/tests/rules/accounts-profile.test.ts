import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { Timestamp, deleteField } from "firebase/firestore";

let environment: RulesTestEnvironment;
const profile = {
  companyId: "company-a", displayName: "Test Member", email: "member@example.test",
  photoURL: "", avatarId: "", department: "", jobTitle: "", city: "", role: "member",
  interestTagIds: [], travelRadiusMiles: 20, availability: [], friendIds: [],
  favoritePhotoIds: [], pointsBalance: 0, createdAt: Timestamp.fromMillis(1000),
};
const db = (uid = "member", verified = true) => environment.authenticatedContext(uid, { email_verified: verified }).firestore();
const own = () => db().doc("users/member");
before(async () => {
  environment = await initializeTestEnvironment({ projectId: "demo-dip", firestore: {
    host: "127.0.0.1", port: 8080, rules: readFileSync("gcp/firestore.rules", "utf8"),
  }});
  await environment.withSecurityRulesDisabled(async (context) => {
    const store = context.firestore();
    for (const [uid, data] of Object.entries({ member: profile, colleague: profile,
      outsider: { ...profile, companyId: "company-b" }, admin: { ...profile, role: "admin" },
      legacy: { ...profile, id: "legacy" } })) await store.doc(`users/${uid}`).set(data);
    await store.doc("companies/company-a").set({ name: "Company A", emailDomain: "example.test" });
    await store.doc("companies/company-b").set({ name: "Company B" });
    await store.doc("tags/wellbeing").set({ name: "Wellbeing" });
    await store.doc("accountRateLimits/member").set({ attempts: 1 });
  });
});
after(async () => { await environment?.cleanup(); });

test("verified self get and missing-document listener support membership onboarding", async () => {
  await assertSucceeds(own().get());
  assert.equal((await assertSucceeds(db("new-member").doc("users/new-member").get())).exists, false);
  await new Promise<void>((resolve, reject) => {
    const stop = db("new-member").doc("users/new-member").onSnapshot(snapshot => {
      try { assert.equal(snapshot.exists, false); stop(); resolve(); } catch (error) { stop(); reject(error); }
    }, reject);
  });
});

test("private profiles deny unauthenticated, unverified, other-user and collection reads", async () => {
  await assertFails(environment.unauthenticatedContext().firestore().doc("users/member").get());
  await assertFails(db("member", false).doc("users/member").get());
  await assertFails(environment.authenticatedContext("member").firestore().doc("users/member").get());
  await assertFails(db("colleague").doc("users/member").get());
  await assertFails(db("outsider").doc("users/member").get());
  await assertFails(db("admin").doc("users/member").get());
  await assertFails(db().collection("users").get());
  await assertFails(db().collection("users").where("email", "==", profile.email).get());
});

test("own profile supports only bounded V1 profile updates", async () => {
  await assertSucceeds(own().update({ photoURL: "https://example.test/avatar.png",
    avatarId: "avatar-1", department: "Engineering", jobTitle: "Designer", city: "Boston",
    interestTagIds: ["wellbeing"], travelRadiusMiles: 50, availability: ["weekend"] }));
  const saved = (await own().get()).data();
  assert.deepEqual(saved?.interestTagIds, ["wellbeing"]);
  assert.equal(saved?.companyId, "company-a");
  assert.equal(saved?.role, "member");
  await assertSucceeds(own().update({ interestTagIds: [], availability: [], travelRadiusMiles: 0 }));
  await assertSucceeds(own().update({ travelRadiusMiles: 500,
    availability: Array(10).fill("x"), interestTagIds: Array(10).fill("x") }));
});

for (const [field, value] of Object.entries({ companyId: "company-b", role: "admin", email: "other@example.test",
  pointsBalance: 100, createdAt: Timestamp.fromMillis(2000), id: "member", unknown: true, displayName: "Renamed",
  friendIds: ["colleague"], favoritePhotoIds: ["photo"] })) {
  test(`client cannot change server-owned or out-of-scope ${field}`, async () => {
    await assertFails(own().update({ [field]: value }));
  });
}

test("even admins cannot overwrite their own membership or private profile peers", async () => {
  await assertSucceeds(db("admin").doc("users/admin").update({ jobTitle: "Organizer" }));
  await assertFails(db("admin").doc("users/admin").update({ displayName: "Admin Profile" }));
  await assertFails(db("admin").doc("users/admin").update({ companyId: "company-b" }));
  await assertFails(db("admin").doc("users/admin").update({ role: "member" }));
  await assertFails(db("admin").doc("users/member").update({ city: "Changed" }));
});

test("direct create/delete, unverified update and other-user update remain forbidden", async () => {
  await assertFails(db("new-member").doc("users/new-member").set(profile));
  await assertFails(own().delete());
  await assertFails(db("member", false).doc("users/member").update({ city: "Boston" }));
  await assertFails(db("colleague").doc("users/member").update({ city: "Boston" }));
  await assertFails(db("legacy").doc("users/legacy").update({ city: "Boston" }));
});

const invalid: [string, unknown][] = [
  ...["photoURL", "avatarId", "department", "jobTitle", "city"].flatMap(field => [
    [field, null], [field, 123], [field, "x".repeat(field === "photoURL" ? 2049 : 121)],
  ] as [string, unknown][]),
  ...[-1, 501, 1.5, "20", null].map(value => ["travelRadiusMiles", value] as [string, unknown]),
  ...["interestTagIds", "availability"].flatMap(field => [
    [field, "bad"], [field, [1]], [field, [null]], [field, [{}]], [field, [""]],
    [field, ["x".repeat(121)]], [field, Array(11).fill("x")],
    ...Array.from({ length: 10 }, (_, index) => [field, Array.from({ length: 10 }, (_, i) => i === index ? false : "x")]),
  ] as [string, unknown][]),
  ["displayName", deleteField()], ["availability", deleteField()],
];
for (const [index, [field, value]] of invalid.entries()) {
  test(`profile validation denies invalid ${field} case ${index}`, async () => { await assertFails(own().update({ [field]: value })); });
}

test("company metadata get requires verified same-company membership", async () => {
  await assertSucceeds(db().doc("companies/company-a").get());
  await assertFails(db().doc("companies/company-b").get());
  await assertFails(db("new-member").doc("companies/company-a").get());
  await assertFails(db("member", false).doc("companies/company-a").get());
  await assertFails(environment.unauthenticatedContext().firestore().doc("companies/company-a").get());
  await assertFails(db().collection("companies").get());
  await assertFails(db().doc("companies/company-a").update({ name: "Changed" }));
  // emailDomain decides membership server-side: clients cannot change it or look companies up by it.
  await assertFails(db().doc("companies/company-a").update({ emailDomain: "attacker.test" }));
  await assertFails(db().collection("companies").where("emailDomain", "==", "example.test").get());
  await assertFails(environment.unauthenticatedContext().firestore().collection("companies").where("emailDomain", "==", "example.test").get());
});

test("verified catalog reads permit interest selection without catalog writes", async () => {
  await assertSucceeds(db().collection("tags").get());
  await assertSucceeds(db().doc("tags/wellbeing").get());
  await assertFails(db("member", false).collection("tags").get());
  await assertFails(environment.unauthenticatedContext().firestore().collection("tags").get());
  await assertFails(db().doc("tags/wellbeing").set({ name: "Changed" }));
});

for (const path of ["accountRateLimits/member",
  "companies/company-a/events/event/rsvps/someone-else", "users/member/notifications/n", "partners/partner"]) {
  test(`unreviewed and private path ${path} stays denied`, async () => {
    await assertFails(db().doc(path).get());
    await assertFails(db().doc(path).set({ value: true }));
  });
}
