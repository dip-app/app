import assert from "node:assert/strict";
import { test } from "node:test";
import { checkPortalKeys } from "./portalKeys.ts";

test("server message keys and the portal catalogs agree on the real repo", () => {
  assert.deepEqual(checkPortalKeys(), []);
});
