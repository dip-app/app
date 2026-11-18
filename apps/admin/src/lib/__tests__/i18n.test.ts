// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubLocalStorage } from "../../components/__tests__/storageStub";
import { en } from "../i18n/catalog/en";
import { es } from "../i18n/catalog/es";
import { argumentsOf, format, pseudoize } from "../i18n/icu";
import {
  STORAGE_KEY, detectLocale, formatDate, formatNumber, getLocale, initLocale, intlLocale, readPreference, resolveLocale,
  setLocale, setLocalePreference, subscribeLocale, t, translate,
} from "../i18n";

beforeEach(() => { stubLocalStorage(); });
afterEach(() => { setLocale("en"); vi.unstubAllGlobals(); });

describe("t()", () => {
  it("returns the English text unchanged by default", () => {
    expect(getLocale()).toBe("en");
    expect(t("shell.nav.events")).toBe("Events");
    expect(t("shell.docTitle", { title: "Members", brand: "DIP Admin" })).toBe("Members | DIP Admin");
    expect(t("common.showingOf", { shown: 25, total: 140 })).toBe("Showing 25 of 140");
  });

  it("switches language, and returns the key itself when no catalog has it", () => {
    setLocale("es");
    expect(t("shell.signOut")).toBe("Cerrar sesión");
    expect(translate("es", "no.such.key")).toBe("no.such.key");
    expect(intlLocale()).toBe("es-419");
  });

  it("leaves an unknown slot visible instead of blank", () => {
    expect(format("Hi {name}, {missing}", { name: "Ada" }, "en-US")).toBe("Hi Ada, {missing}");
  });
});

describe("plurals and select", () => {
  const msg = "{count, plural, =0 {No events} one {# event} other {# events}}";

  it("picks the English category and formats # with grouping", () => {
    expect(format(msg, { count: 0 }, "en-US")).toBe("No events");
    expect(format(msg, { count: 1 }, "en-US")).toBe("1 event");
    expect(format(msg, { count: 1234 }, "en-US")).toBe("1,234 events");
  });

  it("uses Spanish rules, with \"many\" falling back to other", () => {
    const es = "{count, plural, one {# evento} other {# eventos}}";
    expect(format(es, { count: 1 }, "es-419")).toBe("1 evento");
    expect(format(es, { count: 2 }, "es-419")).toBe("2 eventos");
    expect(new Intl.PluralRules("es").select(1_000_000)).toBe("many");
    expect(format(es, { count: 1_000_000 }, "es-419")).toBe("1,000,000 eventos");
  });

  it("supports nested select and plain slots inside plural branches", () => {
    const nested = "{role, select, admin {{n, plural, one {# admin in {team}} other {# admins in {team}}}} other {someone}}";
    expect(format(nested, { role: "admin", n: 2, team: "Ops" }, "en-US")).toBe("2 admins in Ops");
    expect(format(nested, { role: "x", n: 2, team: "Ops" }, "en-US")).toBe("someone");
  });

  it("rejects malformed messages", () => {
    expect(() => format("{count, plural, one {# x}}", { count: 1 }, "en-US")).toThrow(/other/);
    expect(() => format("Broken {name", {}, "en-US")).toThrow();
  });
});

describe("catalogs", () => {
  it("parse in every locale and keep the same placeholders as English", () => {
    for (const [key, message] of Object.entries(en)) {
      const translated = (es as Record<string, string>)[key];
      expect(translated, key).toBeTruthy();
      expect(argumentsOf(translated), key).toEqual(argumentsOf(message));
    }
  });

  it("build a pseudo-locale that keeps slots and plural syntax and is longer", () => {
    for (const message of Object.values(en)) {
      const pseudo = pseudoize(message);
      expect(argumentsOf(pseudo)).toEqual(argumentsOf(message));
    }
    const sample = pseudoize("Weekly themes");
    expect(sample).toMatch(/^⟦.*⟧$/);
    expect(sample.length).toBeGreaterThanOrEqual("Weekly themes".length * 2);
    setLocale("pseudo");
    expect(t("shell.docTitle", { title: "X", brand: "DIP Admin" })).toContain("X");
    expect(t("shell.nav.events")).not.toBe("Events");
  });

  it("have no em dashes", () => {
    for (const catalog of [en, es]) for (const [key, value] of Object.entries(catalog)) expect(value, key).not.toMatch(/—/);
  });
});

describe("locale selection", () => {
  it("detects a shipped language from the browser list", () => {
    expect(detectLocale(["es-MX", "en-US"])).toBe("es");
    expect(detectLocale(["fr-FR", "en-GB"])).toBe("en");
    expect(detectLocale(["fr-FR"])).toBe("en");
    expect(detectLocale([])).toBe("en");
    expect(resolveLocale("auto", ["es"])).toBe("es");
    expect(resolveLocale("en", ["es"])).toBe("en");
  });

  it("reads the stored choice and treats junk or blocked storage as auto", () => {
    expect(readPreference()).toBe("auto");
    localStorage.setItem(STORAGE_KEY, "es");
    expect(readPreference()).toBe("es");
    localStorage.setItem(STORAGE_KEY, "klingon");
    expect(readPreference()).toBe("auto");
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); } });
    expect(readPreference()).toBe("auto");
  });

  it("starts from the stored choice, else the browser, and sets <html lang>", () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["es-AR"]);
    expect(initLocale()).toBe("es");
    expect(document.documentElement.lang).toBe("es");
    localStorage.setItem(STORAGE_KEY, "en");
    expect(initLocale()).toBe("en");
    expect(document.documentElement.lang).toBe("en");
  });

  it("saves a choice in this browser and notifies listeners once per change", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeLocale(listener);
    setLocalePreference("es");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("es");
    expect(getLocale()).toBe("es");
    setLocalePreference("es");
    expect(listener).toHaveBeenCalledTimes(1);
    setLocalePreference("pseudo");
    expect(document.documentElement.lang).toBe("en-XA");
    setLocalePreference("auto");
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    unsubscribe();
  });
});

describe("formatting", () => {
  it("keeps en-US output for English and follows Spanish", () => {
    const date = new Date(2026, 10, 18, 15, 5);
    expect(formatNumber(12345)).toBe("12,345");
    expect(formatDate(date, { month: "short", day: "numeric", year: "numeric" })).toBe("Nov 18, 2026");
    setLocale("es");
    expect(formatDate(date, { month: "short", day: "numeric", year: "numeric" })).toBe(date.toLocaleDateString("es-419", { month: "short", day: "numeric", year: "numeric" }));
    expect(formatDate(date, { month: "long" })).toBe("noviembre");
  });
});
