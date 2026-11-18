import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "../i18n";
import { considerationById } from "../considerations";
import { considerationHint, considerationLabel, groupedConsiderations } from "../considerationsView";
import { resetDate } from "../credits";
import { DEFAULT_PRESETS } from "../dipbotTouches";
import { STEPS, costLabel, durationLabel, summaryLines, emptyAnswers } from "../ideas";
import { HOUR_OPTIONS, WEEKDAY_OPTIONS, engineLabel, linkMessage, nextSendLabel } from "../suggestions";

afterEach(() => setLocale("en"));

describe("Dipbot copy in Spanish", () => {
  it("formats the credits reset date with es-419", () => {
    expect(resetDate("2026-12-01T12:00:00Z", "UTC")).toBe("Dec 1");
    setLocale("es");
    expect(resetDate("2026-12-01T12:00:00Z", "UTC")).toBe("1 dic");
    expect(resetDate("nope")).toBe("el primero del próximo mes");
  });

  it("translates draft labels and keeps the slots", () => {
    setLocale("es");
    expect(durationLabel(90)).toBe("1 h 30 min");
    expect(costLabel(0)).toBe("Gratis");
    expect(costLabel(1250)).toBe("$12.50 por persona");
  });

  it("reads step labels and summary lines in the current language", () => {
    expect(STEPS.map((s) => s.label)[0]).toBe("Interests");
    setLocale("es");
    expect(STEPS[0].label).not.toBe("Interests");
    const lines = summaryLines(emptyAnswers(), (id) => id);
    expect(lines[1].empty).toBe(true);
    expect(lines[1].value).not.toBe("Not set");
  });

  it("builds the weekly email labels from the current language", () => {
    setLocale("es");
    expect(WEEKDAY_OPTIONS[0].label).toBe("lunes");
    expect(HOUR_OPTIONS[15].label).toBe("3:00 p.m.");
    expect(engineLabel("jev")).toBe("Clasificado por Dipbot");
    expect(linkMessage("expired")).toMatch(/^Este enlace caducó/);
    expect(nextSendLabel("2026-11-30T17:00:00Z", "America/Los_Angeles")).toMatch(/^lunes, 30 nov a las /);
  });

  it("translates the time presets and the preference chips", () => {
    setLocale("es");
    expect(DEFAULT_PRESETS[0].label.startsWith("Almuerzo ")).toBe(true);
    const item = considerationById("vegan")!;
    expect(considerationLabel(item)).toBe("Opciones veganas");
    expect(considerationHint(item)).toBe("Platos sin ningún producto de origen animal");
    const groups = groupedConsiderations(["vegan"], "vegano");
    expect(groups).toEqual([]);
    expect(groupedConsiderations(["vegan"], "veganas").flatMap((g) => g.items.map((i) => i.id))).toEqual(["vegan"]);
  });
});
