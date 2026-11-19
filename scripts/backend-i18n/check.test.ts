import assert from "node:assert/strict";
import { test } from "node:test";
import { checkCatalogs } from "../../gcp/functions/src/modules/i18n/domain/catalog.ts";
import { runChecks, SERVER_CATALOGS, usageProblems, type ServerCatalog } from "./check.ts";

test("the real email and push catalogs and the portal keys pass", () => {
  assert.deepEqual(runChecks(), []);
});

test("a missing, empty or mismatched Spanish key fails the check", () => {
  const email = SERVER_CATALOGS.find((c) => c.name === "email")!;
  const { ["email.cta.open"]: _dropped, ...missing } = email.es;
  assert.ok(checkCatalogs("email", email.en, missing).some((p) => p.includes("es is missing email.cta.open")));
  assert.ok(checkCatalogs("email", email.en, { ...email.es, "email.cta.open": " " }).some((p) => p.includes("is empty")));
  assert.ok(checkCatalogs("email", email.en, { ...email.es, "email.eventCanceled.subject": "Cancelado: {titulo}" })
    .some((p) => p.includes("email.eventCanceled.subject placeholders")));
  assert.ok(checkCatalogs("email", email.en, { ...email.es, "email.challenge.points": "{points, plural, other {+{points} puntos}}" })
    .some((p) => p.includes('no "one" form')));
  const push = SERVER_CATALOGS.find((c) => c.name === "push")!;
  const firstPushKey = Object.keys(push.en)[0]!;
  const { [firstPushKey]: _gone, ...pushMissing } = push.es;
  assert.ok(checkCatalogs("push", push.en, pushMissing).some((p) => p.includes(`es is missing ${firstPushKey}`)));
});

test("unused keys and unknown keys in code are reported; log event names are not keys", () => {
  const catalog: ServerCatalog = {
    name: "email", prefix: "email.", en: { "email.a.one": "One", "email.a.two": "Two", "email.reason.x": "X" }, es: {},
    sourceDir: "", dynamicPrefixes: ["email.reason."],
  };
  const problems = usageProblems(catalog, [{ file: "/x.ts", text: 't("email.a.one"); t("email.a.three"); log("email.result"); t(`email.reason.${c}`)' }]);
  assert.equal(problems.length, 2, problems.join("\n"));
  assert.ok(problems.some((p) => p.endsWith("uses email.a.three, which is not in the catalog")));
  assert.ok(problems.includes("email: email.a.two is never used"));
});
