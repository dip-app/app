import { before, after, test } from "node:test";
import { readFileSync } from "node:fs";
import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from "firebase/firestore";

// The email module's collections are server-only and fall through to the deny-all rule.
let env: RulesTestEnvironment;
const company = "email-alpha";
const collections = ["emailOutbox", "emailSuppressions", "emailCaps", "emailSettings", "emulatorEmailOutbox"] as const;

before(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-dip", firestore: {
    host: "127.0.0.1", port: 8080, rules: readFileSync("gcp/firestore.rules", "utf8"),
  }});
  await env.withSecurityRulesDisabled(async (context) => {
    const store = context.firestore();
    await store.doc("users/member").set({ companyId: company, role: "member", displayName: "Member" });
    await store.doc("users/boss").set({ companyId: company, role: "admin", displayName: "Boss" });
    for (const name of collections) await store.doc(`${name}/seeded`).set({ companyId: company, uid: "member", status: "queued", count: 1, enabled: true });
  });
});
after(async () => { await env?.cleanup(); });

for (const [label, uid] of [["verified member", "member"], ["company admin", "boss"]] as const) {
  test(`${label} cannot read or write server-only email collections`, async () => {
    const db = env.authenticatedContext(uid, { email_verified: true }).firestore();
    for (const name of collections) {
      await assertFails(getDoc(doc(db, `${name}/seeded`)));
      await assertFails(getDocs(collection(db, name)));
      await assertFails(setDoc(doc(db, `${name}/new`), { companyId: company, uid, status: "queued", enabled: true }));
      await assertFails(updateDoc(doc(db, `${name}/seeded`), { status: "sent" }));
      await assertFails(deleteDoc(doc(db, `${name}/seeded`)));
    }
  });
}

test("anonymous clients are denied as well", async () => {
  const db = env.unauthenticatedContext().firestore();
  for (const name of collections) {
    await assertFails(getDoc(doc(db, `${name}/seeded`)));
    await assertFails(setDoc(doc(db, `${name}/new`), { enabled: true }));
  }
});
