import { after, before, test } from "node:test";
import { readFileSync } from "node:fs";
import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";

let environment: RulesTestEnvironment;
const LIVE_COVER_DOCS = [
  "coverLibraryDynamic/pixabay-1", "coverSearchCache/abc123", "coverLiveCandidates/pixabay-1", "coverLiveUsage/2026-11-18",
];

before(async () => {
  environment = await initializeTestEnvironment({
    projectId: "demo-dip",
    firestore: {
      host: "127.0.0.1",
      port: 8080,
      rules: readFileSync("gcp/firestore.rules", "utf8"),
    },
    storage: {
      host: "127.0.0.1",
      port: 9199,
      rules: readFileSync("gcp/storage.rules", "utf8"),
    },
  });
  // Existing resources ensure denied reads exercise authorization, not missing-data handling.
  await environment.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc("companies/company-a/events/event-a").set({
      companyId: "company-a",
      title: "Emulator-only fixture",
    });
    await context.storage().ref("companies/company-a/events/event-a/photo.jpg").putString("emulator-only fixture");
    // Live cover fallback data is server-only (Admin SDK): a member and an admin of the company must still be denied.
    await context.firestore().doc("users/live-admin").set({ companyId: "company-a", role: "admin", displayName: "Admin" });
    await context.firestore().doc("users/live-member").set({ companyId: "company-a", role: "member", displayName: "Member" });
    for (const path of LIVE_COVER_DOCS) await context.firestore().doc(path).set({ fixture: true });
    await context.storage().ref("covers-dynamic/pixabay-1.webp").putString("emulator-only fixture");
    await context.storage().ref("covers-dynamic/jpg/pixabay-1.jpg").putString("emulator-only fixture");
  });
});

after(async () => {
  await environment?.cleanup();
});

for (const signedIn of [false, true]) {
  const identity = signedIn ? "signed-in client" : "anonymous client";
  const context = () => signedIn
    ? environment.authenticatedContext("test-member")
    : environment.unauthenticatedContext();

  test(`setup baseline denies Firestore reads for ${identity}`, async () => {
    await assertFails(context().firestore().doc("companies/company-a/events/event-a").get());
  });

  test(`setup baseline denies Firestore writes for ${identity}`, async () => {
    await assertFails(context().firestore().doc("users/test-member").set({
      companyId: "company-a",
      role: "admin",
      pointsBalance: 999,
    }));
  });

  test(`setup baseline denies Storage reads for ${identity}`, async () => {
    await assertFails(context().storage().ref("companies/company-a/events/event-a/photo.jpg").getDownloadURL());
  });

  test(`setup baseline denies Storage writes for ${identity}`, async () => {
    await assertFails(context().storage().ref("companies/company-a/events/event-a/photo.jpg").putString("test payload"));
  });
}

for (const uid of ["live-member", "live-admin"]) {
  const context = () => environment.authenticatedContext(uid, { email_verified: true });

  test(`live cover collections are server-only for ${uid}`, async () => {
    for (const path of LIVE_COVER_DOCS) {
      await assertFails(context().firestore().doc(path).get());
      await assertFails(context().firestore().doc(path).set({ fixture: false }));
      await assertFails(context().firestore().doc(path).delete());
    }
    await assertFails(context().firestore().collection("coverLibraryDynamic").get());
  });

  test(`dynamic cover Storage objects are not readable or writable by ${uid}`, async () => {
    for (const path of ["covers-dynamic/pixabay-1.webp", "covers-dynamic/jpg/pixabay-1.jpg", "covers-dynamic/pixabay-2.webp"]) {
      await assertFails(context().storage().ref(path).getDownloadURL());
      await assertFails(context().storage().ref(path).putString("client payload"));
      await assertFails(context().storage().ref(path).delete());
    }
  });
}
