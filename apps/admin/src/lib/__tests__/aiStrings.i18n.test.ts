import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import { t, tn } from "@/lib/aiStrings";

describe("aiStrings in Spanish", () => {
  afterEach(() => setLocale("en"));

  it("serves Spanish copy with the brand untranslated", () => {
    setLocale("es");
    expect(t("nav.label")).toBe("Dipbot");
    expect(t("action.generate")).toBe("Generar borradores");
  });

  it("picks singular and plural forms", () => {
    setLocale("es");
    expect(tn("credits.unit", 1)).toBe("1 crédito");
    expect(tn("credits.unit", 3)).toBe("3 créditos");
  });

  it("fills slots", () => {
    setLocale("es");
    const meter = t("credits.meter", { left: 4, total: 10 });
    expect(meter).toContain("4");
    expect(meter).toContain("10");
  });
});
