import { after, before, test } from "node:test";
import { readFileSync } from "node:fs";
import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";

let environment: RulesTestEnvironment;

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
