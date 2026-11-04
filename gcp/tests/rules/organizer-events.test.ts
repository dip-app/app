import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { Timestamp } from "firebase/firestore";

let environment: RulesTestEnvironment;
const base = {
  displayName: "Test", email: "x@example.test", photoURL: "", avatarId: "", department: "", jobTitle: "", city: "",
  interestTagIds: [], travelRadiusMiles: 20, availability: [], friendIds: [], favoritePhotoIds: [], pointsBalance: 0,
  createdAt: Timestamp.fromMillis(1000),
};
const event = (status: string) => ({
  companyId: "company-a", title: "Trivia", description: "d", tagIds: [], coverImageURL: "catalog://default/games",
  startTime: Timestamp.fromMillis(4_000_000_000_000), endTime: Timestamp.fromMillis(4_000_003_600_000),
  venue: { name: "Pub", address: "1 Main", locality: "PGH", latitude: 1, longitude: 1 },
  costCents: 0, costNote: "", capacity: 10, pointsValue: 0, isOutdoor: false, status, attendeeCount: 0,
  createdBy: "admin", createdAt: Timestamp.fromMillis(1000), revision: 1,
});
const db = (uid: string, verified = true) => environment.authenticatedContext(uid, { email_verified: verified }).firestore();
const events = (uid: string, company = "company-a") => db(uid).collection(`companies/${company}/events`);

before(async () => {
  environment = await initializeTestEnvironment({ projectId: "demo-dip", firestore: {
    host: "127.0.0.1", port: 8080, rules: readFileSync("gcp/firestore.rules", "utf8"),
  }});
  await environment.withSecurityRulesDisabled(async (context) => {
    const store = context.firestore();
    await store.doc("users/member").set({ ...base, companyId: "company-a", role: "member" });
    await store.doc("users/admin").set({ ...base, companyId: "company-a", role: "admin" });
    await store.doc("users/outsider").set({ ...base, companyId: "company-b", role: "member" });
    await store.doc("users/outsider-admin").set({ ...base, companyId: "company-b", role: "admin" });
    await store.doc("companies/company-a/events/scheduled").set(event("scheduled"));
    await store.doc("companies/company-a/events/cancelled").set(event("cancelled"));
    await store.doc("companies/company-a/commandReceipts/admin_x").set({ hash: "h", eventId: "scheduled", revision: 1 });
  });
});
after(async () => { await environment?.cleanup(); });

test("signed-out and unverified callers cannot read events", async () => {
  const anonymous = environment.unauthenticatedContext().firestore();
  await assertFails(anonymous.doc("companies/company-a/events/scheduled").get());
  await assertFails(anonymous.collection("companies/company-a/events").where("status", "==", "scheduled").get());
  await assertFails(db("member", false).doc("companies/company-a/events/scheduled").get());
});

test("same-company members read scheduled events only", async () => {
  await assertSucceeds(events("member").doc("scheduled").get());
  await assertFails(events("member").doc("cancelled").get());
  await assertSucceeds(events("member").where("status", "==", "scheduled").get());
  // An unfiltered list could return cancelled events, so rules refuse it for members.
  await assertFails(events("member").get());
});

test("organizers read scheduled and cancelled events in their own company", async () => {
  await assertSucceeds(events("admin").doc("scheduled").get());
  await assertSucceeds(events("admin").doc("cancelled").get());
  await assertSucceeds(events("admin").get());
});

test("another company's members and organizers cannot read or list these events", async () => {
  for (const uid of ["outsider", "outsider-admin"]) {
    await assertFails(events(uid).doc("scheduled").get());
    await assertFails(events(uid).where("status", "==", "scheduled").get());
    await assertFails(events(uid).get());
  }
});

test("no client can write events, even an organizer; receipts are server-only", async () => {
  await assertFails(events("admin").doc("new").set(event("scheduled")));
  await assertFails(events("admin").doc("scheduled").update({ title: "Changed", revision: 2 }));
  await assertFails(events("admin").doc("scheduled").delete());
  await assertFails(events("member").doc("scheduled").update({ attendeeCount: 99 }));
  await assertFails(db("admin").doc("companies/company-a/commandReceipts/admin_x").get());
  await assertFails(db("admin").doc("companies/company-a/commandReceipts/admin_y").set({ hash: "h" }));
});
