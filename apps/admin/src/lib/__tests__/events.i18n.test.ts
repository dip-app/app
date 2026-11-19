import { afterEach, describe, expect, it } from "vitest";
import { emptyDraft, formatDuration, formatPrice, formatWhen, validateDraft } from "@/lib/contract";
import { setLocale, t } from "@/lib/i18n";

afterEach(() => setLocale("en"));

describe("events i18n", () => {
  it("keeps English output unchanged", () => {
    expect(formatPrice(0)).toBe("Free");
    expect(formatPrice(1250)).toBe("$12.50");
    expect(formatDuration("2026-11-16T09:00:00Z", "2026-11-16T11:30:00Z")).toBe("2 hr 30 min");
    expect(formatWhen("2026-11-16T09:00:00", "2026-11-16T11:00:00")).toBe("Mon, Nov 16 · 9:00 AM to 11:00 AM");
    expect(t("events.form.fixToCreate")).toBe("Fix these to create the event");
    expect(t("events.form.optional", { label: "Tags" })).toBe("Tags (optional)");
  });

  it("produces Spanish strings, durations and plurals", () => {
    setLocale("es");
    expect(formatPrice(0)).toBe("Gratis");
    expect(formatDuration("2026-11-16T09:00:00Z", "2026-11-16T09:45:00Z")).toBe("45 min");
    expect(formatDuration("2026-11-16T09:00:00Z", "2026-11-16T11:30:00Z")).toBe("2 h 30 min");
    expect(formatWhen("2026-11-16T09:00:00", "2026-11-16T11:00:00")).toContain(" a ");
    expect(t("events.form.fixToCreate")).toBe("Corrige esto para crear el evento");
    expect(t("events.form.optional", { label: "Etiquetas" })).toBe("Etiquetas (opcional)");
    const errors = validateDraft(emptyDraft(), { requireFuture: false });
    expect(errors.title).toBe("El título debe tener de 1 a 120 caracteres.");
    expect(errors.startTime).toBe("Elige una hora de inicio.");
  });
});
