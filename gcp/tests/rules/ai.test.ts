import { after, before, test } from "node:test";
import { readFileSync } from "node:fs";
import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { Timestamp, collection, deleteDoc, doc, getDoc, getDocs, limit, query, setDoc, updateDoc } from "firebase/firestore";

// AI event-draft usage state is server-only: usage counters, daily counters, request replays and the per-company switch
// are written and read by the Admin SDK in the callables. Every client, admin included, falls through to deny-all.
let env: RulesTestEnvironment;
const c = "ai-alpha";
const o = "ai-beta";
const user = (companyId: string, role: string) => ({
  companyId, role, displayName: `${role} user`, email: `${role}@x.test`, photoURL: "", avatarId: "a1", department: "Eng", jobTitle: "", city: "",
  interestTagIds: [], travelRadiusMiles: 20, availability: [], friendIds: [], favoritePhotoIds: [], pointsBalance: 0, createdAt: Timestamp.now(),
});
const fs = (uid: string) => env.authenticatedContext(uid, { email_verified: true }).firestore();
const PATHS = [
  `companies/${c}/aiUsage/203001`, `companies/${c}/aiUsageDaily/20300102_ai-admin`, `companies/${c}/aiRequests/ai-admin_req-12345678`, `companies/${c}/aiSettings/current`,
  `companies/${c}/aiVenueSearches/abc123`, `companies/${c}/aiVenueUsage/20300102`, `companies/${c}/placesUsage/20300102`,
  `companies/${c}/aiCache/ideas`,
];
const COLLECTIONS = PATHS.map(path => path.slice(0, path.lastIndexOf("/")));
const READERS = ["ai-admin", "ai-org", "ai-member", "ai-other-admin"] as const;

before(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-dip", firestore: { host: "127.0.0.1", port: 8080, rules: readFileSync("gcp/firestore.rules", "utf8") } });
  await env.withSecurityRulesDisabled(async context => {
    const store = context.firestore();
    await store.doc("users/ai-admin").set(user(c, "admin"));
    await store.doc("users/ai-org").set(user(c, "organizer"));
    await store.doc("users/ai-member").set(user(c, "member"));
    await store.doc("users/ai-other-admin").set(user(o, "admin"));
    for (const path of PATHS) await store.doc(path).set({ generations: 1, enabled: true, uid: "ai-admin", status: "done" });
  });
});
after(async () => { await env.cleanup(); });

test("no client role can get an AI usage, request or settings document", async () => {
  for (const uid of READERS) {
    for (const path of PATHS) await assertFails(getDoc(doc(fs(uid), path)));
  }
});

test("no client role can list or query the AI collections", async () => {
  for (const uid of READERS) {
    for (const path of COLLECTIONS) {
      await assertFails(getDocs(query(collection(fs(uid), path), limit(10))));
      await assertFails(getDocs(collection(fs(uid), path)));
    }
  }
});

test("no client role can create, update or delete AI documents; the counters and the switch cannot be forged", async () => {
  for (const uid of READERS) {
    const db = fs(uid);
    for (const path of PATHS) {
      await assertFails(setDoc(doc(db, path), { generations: 0, enabled: true }));
      await assertFails(updateDoc(doc(db, path), { generations: 0, enabled: true }));
      await assertFails(deleteDoc(doc(db, path)));
    }
    await assertFails(setDoc(doc(db, `companies/${c}/aiUsage/203002`), { generations: 0, spentMicros: 0, pending: {} }));
    await assertFails(setDoc(doc(db, `companies/${c}/aiSettings/current`), { enabled: true, monthlyGenerationLimit: 100000 }));
    await assertFails(setDoc(doc(db, `companies/${c}/aiRequests/${uid}_req-99999999`), { status: "done", response: { drafts: [] } }));
  }
});

test("an unauthenticated client is denied too", async () => {
  const anon = env.unauthenticatedContext().firestore();
  for (const path of PATHS) {
    await assertFails(getDoc(doc(anon, path)));
    await assertFails(setDoc(doc(anon, path), { generations: 1 }));
  }
});
