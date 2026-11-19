import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../contract";
import { apiErrorFrom } from "../firebaseAdapter";
import { en } from "../i18n/catalog/en";
import { es } from "../i18n/catalog/es";
import { setLocale, t } from "../i18n";
import { LEAK_PATTERNS, fieldMessage, presentable, saveFailureMessage, stripStatus, userError, userErrorMessage } from "../userError";

afterEach(() => { setLocale("en"); vi.unstubAllGlobals(); });

/** What the Firebase JS SDK throws for a callable failure: `functions/<code>` and the HTTP status appended. */
const sdk = (code: string, message: string, details?: unknown) => Object.assign(new Error(message), { name: "FirebaseError", code: `functions/${code}`, details });
/** The same, after the portal's adapter (apiErrorFrom) has typed it. */
const wire = (code: string, message: string, details?: unknown) => apiErrorFrom(sdk(code, message, details));

const leaks = (text: string) => LEAK_PATTERNS.filter((pattern) => pattern.test(text)).map(String);

describe("userError: Firebase callable codes", () => {
  // [code, what the SDK says, the catalog key we show, retryable]
  const CASES: [string, string, string, boolean][] = [
    ["unauthenticated", "unauthenticated [401]", "failure.signedOut", false],
    ["permission-denied", "permission-denied [403]", "failure.permission", false],
    ["resource-exhausted", "resource-exhausted [429]", "failure.rateLimit", true],
    ["invalid-argument", "Invalid request. [400]", "failure.rejected", false], // no field flagged
    ["not-found", "not-found [404]", "failure.notFound", false],
    ["internal", "internal [500]", "failure.unknown", true],
    ["internal", "internal [0]", "failure.network", true], // status 0: no answer (offline, blocked)
    ["unavailable", "unavailable [503]", "failure.busy", true], // the server answered: busy, not offline
    ["deadline-exceeded", "deadline-exceeded", "failure.busy", true],
    ["aborted", "aborted [409]", "failure.conflict", true],
    ["failed-precondition", "failed-precondition [400]", "failure.unavailable", true],
    ["unknown", "Unknown backend error status: WEIRD [418]", "failure.unknown", true],
  ];

  for (const locale of ["en", "es"] as const) {
    it(`maps each code to plain copy in ${locale}, straight from the SDK and through apiErrorFrom`, () => {
      setLocale(locale);
      const catalog = locale === "en" ? en : es;
      for (const [code, message, key, retryable] of CASES) {
        for (const thrown of [sdk(code, message), apiErrorFrom(sdk(code, message))]) {
          const shown = userError(thrown);
          expect(shown.message, `${code} ${message}`).toBe(catalog[key as keyof typeof catalog]);
          expect(shown.retryable, `${code} retryable`).toBe(retryable);
          expect(leaks(shown.message)).toEqual([]);
        }
      }
    });
  }

  it("never shows the status suffix the SDK appends to a server sentence", () => {
    const error = wire("not-found", "Member not found. [404]", { reason: "MEMBER_NOT_FOUND", messageKey: "errors.memberNotFound" });
    expect((error as Error).message).toBe("Member not found.");
    expect(userErrorMessage(error)).toBe("Member not found.");
    expect(userErrorMessage(new ApiError("not-found", "Event not found. [404]"))).toBe("Event not found.");
  });

  it("shows the server's typed message in the active language", () => {
    const thrown = () => wire("failed-precondition", "This theme's dates have already passed. [400]", { reason: "THEME_LOCKED", messageKey: "errors.validationFailed.themeDatesPassed" });
    expect(userErrorMessage(thrown())).toBe(en["errors.validationFailed.themeDatesPassed"]);
    setLocale("es");
    expect(userErrorMessage(thrown())).toBe(es["errors.validationFailed.themeDatesPassed"]);
    expect(userError(thrown()).retryable).toBe(false);
  });

  it("replaces a vague 'Invalid request.' with copy that says what to do, also under fields", () => {
    const error = wire("invalid-argument", "Invalid request. [400]", { reason: "VALIDATION_FAILED", fields: ["title"], messageKey: "errors.validationFailed" }) as ApiError;
    expect(userErrorMessage(error)).toBe(en["failure.validation"]);
    expect(error.fields).toEqual({ title: en["failure.field"] });
    setLocale("es");
    expect(userErrorMessage(wire("invalid-argument", "Invalid request. [400]", { fields: ["title"], messageKey: "errors.validationFailed" }))).toBe(es["failure.validation"]);
    // No field flagged: nothing to fix on screen, so it says the change was not accepted.
    expect(userErrorMessage(wire("invalid-argument", "Invalid request. [400]", { messageKey: "errors.validationFailed" }))).toBe(es["failure.rejected"]);
  });

  it("a conflict in a form with Reload latest says that reloading drops the edits", () => {
    const conflict = wire("aborted", "Someone else changed this event. Reload it and try again. [409]", { messageKey: "errors.revisionConflict.event" });
    expect(saveFailureMessage(conflict, true)).toBe(`${en["errors.revisionConflict.event"]} ${en["failure.reloadLoses"]}`);
    expect(saveFailureMessage(conflict, false)).toBe(en["errors.revisionConflict.event"]);
    expect(saveFailureMessage(wire("aborted", "aborted [409]"), true)).toBe(en["failure.conflict"]);
  });
});

describe("userError: reason keys never show", () => {
  it("words the reasons it knows and falls back to the code's copy for the rest", () => {
    expect(userErrorMessage(new ApiError("failed-precondition", "AI_VENUES_DISABLED", {}, "AI_VENUES_DISABLED"))).toBe(en["failure.venuesOff"]);
    expect(userErrorMessage(new ApiError("failed-precondition", "", {}, "PLACES_DISABLED"))).toBe(en["failure.venuesOff"]);
    expect(userErrorMessage(new ApiError("failed-precondition", "SOME_NEW_REASON", {}, "SOME_NEW_REASON"))).toBe(en["failure.unavailable"]);
    expect(userErrorMessage(new ApiError("resource-exhausted", "", {}, "AI_UNAVAILABLE"))).toMatch(/^Dipbot is busy right now/);
    setLocale("es");
    expect(userErrorMessage(new ApiError("failed-precondition", "AI_VENUES_DISABLED", {}, "AI_VENUES_DISABLED"))).toBe(es["failure.venuesOff"]);
    expect(userErrorMessage(new ApiError("permission-denied", "INSUFFICIENT_ROLE", {}, "SOMETHING"))).toBe(es["failure.permission"]);
  });

  it("the message alone is enough to reject a key", () => {
    expect(presentable("AI_VENUES_DISABLED")).toBe(false);
    expect(presentable("Failed: CHALLENGE_WINDOW_OVERLAP")).toBe(false);
    expect(presentable("internal")).toBe(false);
    expect(presentable("permission-denied")).toBe(false);
    expect(presentable("Firebase: Error (auth/network-request-failed).")).toBe(false);
    expect(presentable("Request failed with status code 500")).toBe(false);
    expect(presentable("Member not found.")).toBe(true);
    expect(stripStatus("Invalid request. [400]")).toBe("Invalid request.");
  });
});

describe("userError: transport and other thrown values", () => {
  it("network failures, in en and es", () => {
    expect(userErrorMessage(new TypeError("Failed to fetch"))).toBe(en["failure.network"]);
    expect(userErrorMessage(Object.assign(new Error("Firebase: Error (auth/network-request-failed)."), { code: "auth/network-request-failed" }))).toBe(en["failure.network"]);
    expect(userErrorMessage(Object.assign(new Error("Failed to get document because the client is offline."), { code: "unavailable" }))).toBe(en["failure.busy"]);
    expect(userError(Object.assign(new Error("unavailable [503]"), { code: "functions/unavailable" }), { dipbot: true }).message).toBe("Dipbot is busy right now. Try again in a moment.");
    setLocale("es");
    expect(userErrorMessage(new TypeError("Load failed"))).toBe(es["failure.network"]);
  });

  it("offline wins over whatever was thrown", () => {
    vi.stubGlobal("navigator", { onLine: false });
    expect(userError(new Error("boom")).kind).toBe("network");
  });

  it("our own sentences pass; anything else gets the generic copy or the surface's fallback", () => {
    expect(userErrorMessage(new Error(t("roster.message.copyFailed")))).toBe(en["roster.message.copyFailed"]);
    expect(userErrorMessage(new Error("Cannot read properties of undefined (reading 'x')"))).toBe(en["failure.unknown"]);
    expect(userErrorMessage(new Error("This workbook has no readable sheet."), "Couldn’t read the file.")).toBe("Couldn’t read the file.");
    expect(userErrorMessage("a string")).toBe(en["failure.unknown"]);
    expect(userErrorMessage(null)).toBe(en["failure.unknown"]);
    expect(userErrorMessage(undefined, "Fallback.")).toBe("Fallback.");
    setLocale("es");
    expect(userErrorMessage(new Error(t("roster.message.copyFailed")))).toBe(es["roster.message.copyFailed"]);
    // An English sentence of ours is not shown to a Spanish reader: it is not catalog text in es.
    expect(userErrorMessage(new Error(en["roster.message.copyFailed"]))).toBe(es["failure.unknown"]);
  });

  it("client-made ApiErrors keep their sentence; a specific sentence is not retryable unless transient", () => {
    expect(userError(new ApiError("not-found", "That event doesn’t exist."))).toMatchObject({ message: "That event doesn’t exist.", retryable: false, kind: "notFound" });
    expect(userError(new ApiError("not-found", ""), { notFound: "This event no longer exists." }).message).toBe("This event no longer exists.");
    expect(userError(new ApiError("aborted", "")).retryable).toBe(true);
  });

  it("titles only when the surface asks; generic copy is flagged", () => {
    expect(userError(new TypeError("Failed to fetch"), { title: "Couldn’t save" })).toMatchObject({ title: "Couldn’t save", generic: true });
    expect(userError(new ApiError("not-found", "Member not found."))).not.toHaveProperty("title");
    expect(userError(new ApiError("not-found", "Member not found.")).generic).toBeUndefined();
  });

  it("field errors: a server sentence stays, a vague or technical one becomes 'Check this field.'", () => {
    expect(fieldMessage("Choose tags from the list.")).toBe("Choose tags from the list.");
    expect(fieldMessage("Invalid request. [400]")).toBe(en["failure.field"]);
    expect(fieldMessage("TITLE_TOO_LONG")).toBe(en["failure.field"]);
  });
});

describe("guardrail: user-facing text has no codes or keys", () => {
  it("no catalog message in en or es contains a status code, reason key or SDK wording", () => {
    const found = [...Object.entries(en), ...Object.entries(es)].filter(([, text]) => leaks(text).length > 0).map(([key, text]) => `${key}: ${text}`);
    expect(found).toEqual([]);
  });

  it("every failure.* message is presentable in both languages", () => {
    for (const catalog of [en, es]) {
      for (const [key, text] of Object.entries(catalog)) if (key.startsWith("failure.") && key.split(".").length === 2) expect(presentable(text), key).toBe(true);
    }
  });

  it("no source file renders a bracketed status code or a raw reason key as a string literal in JSX", () => {
    const root = join(__dirname, "..", "..");
    const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return name === "__tests__" ? [] : files(full);
      return full.endsWith(".tsx") ? [full] : [];
    });
    const offenders = files(root).filter((file) => {
      const text = readFileSync(file, "utf8");
      // JSX text between tags, and string literals in toast(...) calls.
      return />[^<>{}]*\[\d{3}\][^<>{}]*</.test(text) || /toast\(\s*["'`][^"'`]*(\[\d{3}\]|\b[A-Z]+_[A-Z_]+\b)/.test(text);
    }).map((file) => relative(root, file));
    expect(offenders).toEqual([]);
  });
});
