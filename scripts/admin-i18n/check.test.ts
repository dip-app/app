// Unit tests for the admin i18n guardrail. Run with `npm run test:admin-i18n`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkCatalogs, checkUsage, findHardCoded, isMigrated, readAllowlist, requiredPluralForms, translateHelpers } from "./check.ts";

describe("checkCatalogs", () => {
  it("accepts a complete translation with the same placeholders", () => {
    assert.deepEqual(checkCatalogs({ "a.x": "Hi {name}" }, { "a.x": "Hola {name}" }, "es"), []);
  });

  it("reports missing, empty and extra keys", () => {
    const problems = checkCatalogs({ "a.x": "One", "a.y": "Two" }, { "a.y": " ", "a.z": "Tres" }, "es");
    assert.ok(problems.includes("es: missing key a.x"));
    assert.ok(problems.includes("es: empty translation for a.y"));
    assert.ok(problems.includes("es: extra key a.z (not in English)"));
  });

  it("reports placeholder mismatches, including plural arguments", () => {
    const [problem] = checkCatalogs({ "a.x": "{count, plural, one {# event} other {# events}} for {team}" }, { "a.x": "{n, plural, one {# evento} other {# eventos}} para {team}" }, "es");
    assert.match(problem, /placeholder mismatch in a\.x/);
    assert.match(checkCatalogs({ "a.x": "Hi {name}" }, { "a.x": "Hola {nombre}" }, "es")[0], /placeholder mismatch/);
  });

  it("requires the Spanish one form unless =1 covers it", () => {
    assert.deepEqual(requiredPluralForms("es"), ["one", "other"]);
    const en = { "a.x": "{n, plural, one {# day} other {# days}}" };
    assert.match(checkCatalogs(en, { "a.x": "{n, plural, other {# días}}" }, "es")[0], /has no "one" form/);
    assert.deepEqual(checkCatalogs(en, { "a.x": "{n, plural, =1 {un día} other {# días}}" }, "es"), []);
  });

  it("reports messages that do not parse", () => {
    assert.match(checkCatalogs({ "a.x": "Hi {name" }, { "a.x": "Hola" }, "es")[0], /does not parse/);
  });
});

describe("checkUsage", () => {
  const catalog = {
    "events.title": "Events",
    "events.unused": "Nobody uses me",
    "events.filter.upcoming": "Upcoming",
    "ai.nav.label": "{ai}",
    "ai.credits.unit.one": "{n} credit",
    "ai.credits.unit.other": "{n} credits",
    "ai.goal.wellness": "Wellness",
  };

  it("finds literal, aiStrings, plural-base, template-prefix and dynamic-prefix uses", () => {
    const { unused, missing } = checkUsage(catalog, [
      { path: "a.tsx", text: `import { t } from "@/lib/i18n";\nt("events.title"); const k = \`events.filter.\${id}\`;` },
      { path: "b.tsx", text: `import { t, tn } from "@/lib/aiStrings";\nt("nav.label"); tn("credits.unit", 2);` },
    ]);
    assert.deepEqual(unused, ["events.unused"]);
    assert.deepEqual(missing, []);
  });

  it("reports keys passed to t() that the catalog lacks, per helper", () => {
    const { missing } = checkUsage(catalog, [
      { path: "a.tsx", text: `import { t } from "@/lib/i18n";\nimport { t as tAi, tn as tnAi } from "@/lib/aiStrings";\nt("events.nope"); tAi("nav.label"); tAi("nav.nope"); tnAi("credits.nope", 1);` },
    ]);
    assert.deepEqual(missing, [
      "a.tsx: events.nope is not in the English catalog",
      "a.tsx: ai.nav.nope is not in the English catalog",
      "a.tsx: ai.credits.nope.one/.other is not in the English catalog",
    ]);
  });

  it("maps local helper names to their module", () => {
    const helpers = translateHelpers(`import { type MessageKey, t } from "@/lib/i18n";\nimport { t as tAi } from "../aiStrings";`);
    assert.deepEqual(helpers.get("t"), { ai: false, plural: false });
    assert.deepEqual(helpers.get("tAi"), { ai: true, plural: false });
  });
});

describe("findHardCoded", () => {
  const scan = (text: string, keys: string[] = []) => findHardCoded("x.tsx", text, new Set(keys)).map((f) => `${f.why}: ${f.text}`);

  it("flags JSX text, UI attributes, JSX expressions, toasts and label properties", () => {
    const found = scan(`
      const ITEMS = [{ id: "a", label: "Upcoming" }];
      export function A({ open }: { open: boolean }) {
        toast("Saved the event.");
        return <div aria-label="Main menu" className="nav big">Hello there{open ? "Hide details" : null}</div>;
      }`);
    assert.deepEqual(found, [
      "property label: Upcoming",
      "toast() message: Saved the event.",
      "attribute aria-label: Main menu",
      "JSX text: Hello there",
      "JSX expression: Hide details",
    ]);
  });

  it("ignores translated text, comparisons, catalog keys and class names", () => {
    assert.deepEqual(scan(`
      const ITEMS = [{ id: "a", label: "events.filter.upcoming" }];
      export function A({ phase }: { phase: string }) {
        return <div className="table responsive" title={t("events.title")}>{phase === "loading" ? t("common.loadMore") : null}{t("x.y", { name: "Ada Lovelace" })}</div>;
      }`, ["events.filter.upcoming"]), []);
  });

  it("flags t() at module scope and fixed en-US formatting", () => {
    assert.deepEqual(scan(`const LABEL = t("events.title");\nexport const f = (n: number) => n.toLocaleString("en-US");`), [
      `t() at module scope: t("events.title")`,
      "fixed en-US formatting (use intlLocale()): en-US",
    ]);
    assert.deepEqual(scan(`export function f() { return t("events.title"); }\nexport const g = () => t("events.title");`), []);
  });
});

describe("files and allowlist", () => {
  it("recognizes the migration marker and reads allowlist lines", () => {
    assert.equal(isMigrated(`"use client";\n// @i18n-migrated\n`), true);
    assert.equal(isMigrated(`"use client";\n`), false);
    assert.deepEqual([...readAllowlist("# comment\na.tsx\tloading\n\nb.ts\ten-US  \n")], ["a.tsx\tloading", "b.ts\ten-US"]);
  });
});
