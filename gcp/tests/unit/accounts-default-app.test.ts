import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import { test } from "node:test";
import { defaultAdminApp } from "../../functions/src/modules/accounts/transport/resolveMembershipV1";

const req = createRequire(require.resolve("../../functions/package.json"));
const admin = req("firebase-admin/app") as typeof import("firebase-admin/app");

test("defaultAdminApp creates the default app even when firebase-functions' named app exists", async () => {
  // Production order: firebase-functions verifies the callable's tokens with its own named app first.
  const sdkApp = admin.initializeApp({ projectId: "demo-dip" }, "__FIREBASE_FUNCTIONS_SDK__");
  try {
    assert.equal(admin.getApps().length, 1);
    const app = defaultAdminApp();
    assert.equal(app.name, "[DEFAULT]");
    assert.equal(defaultAdminApp(), app, "reused, not re-initialized");
    assert.equal(admin.getApps().length, 2);
    await admin.deleteApp(app);
  } finally {
    await admin.deleteApp(sdkApp);
  }
});
