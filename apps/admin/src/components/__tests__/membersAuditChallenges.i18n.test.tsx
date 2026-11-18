// @vitest-environment jsdom
// Spanish for the members, audit and challenges areas: labels, plurals, dates and a rendered row.
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { aiFacts, auditAction, auditCategoryLabel } from "@/lib/auditLabels";
import { formatGoal, formatReward, overlapMessage, phaseLabel, validateThemeDraft, type ThemeDraft, type WeeklyTheme } from "@/lib/challenge";
import { setLocale, t } from "@/lib/i18n";
import { formatWindow } from "@/lib/weeks";
import { ChallengeRow, ChallengeTable } from "../ChallengeRows";

afterEach(() => {
  cleanup();
  setLocale("en");
});

function theme(over: Partial<WeeklyTheme> = {}): WeeklyTheme {
  return {
    id: "t1", companyId: "acme", title: "Fitness", description: "", tagIds: [], type: "weekly", goal: 3, goalUnit: "workouts",
    coverImageURL: "catalog://theme/fitness", startDate: "2026-11-09T05:00:00.000Z", endDate: "2026-11-16T04:59:59.000Z", pointsReward: 50,
    participantCount: 1280, completedCount: 41, createdBy: "u", createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z", revision: 1, ...over,
  };
}

describe("members (Spanish)", () => {
  it("pluralizes the person counts", () => {
    setLocale("es");
    expect(t("members.count.matches", { shown: 1 })).toBe("1 persona coincide");
    expect(t("members.count.matches", { shown: 12 })).toBe("12 personas coinciden");
    expect(t("members.count.showingOf", { shown: "20", total: 1 })).toBe("Mostrando 20 de 1 persona");
    expect(t("members.export.done", { count: 3 })).toBe("Se exportaron 3 personas a members.csv.");
  });

  it("keeps English unchanged", () => {
    expect(t("members.count.matches", { shown: 1 })).toBe("1 person matches");
    expect(t("members.count.matches", { shown: 1234 })).toBe("1,234 people match");
  });
});

describe("audit (Spanish)", () => {
  it("translates the action label and category but keeps the category id", () => {
    setLocale("es");
    const action = auditAction("ai.generateDrafts");
    expect(action.label).toBe("Generó borradores de eventos con Dipbot");
    expect(action.category).toBe("AI");
    expect(auditCategoryLabel(action.category)).toBe("IA");
  });

  it("falls back to the humanized key for unknown actions and translates AI facts and counts", () => {
    setLocale("es");
    expect(auditAction("tags.backfillIcons")).toEqual({ label: "Tags backfill icons", category: "Settings", known: false });
    expect(aiFacts([{ field: "credits", before: "", after: "10" }])).toEqual([{ label: "Créditos usados", value: "10" }]);
    expect(t("audit.showingOf", { shown: 1, total: 1 })).toBe("Mostrando 1 de 1 entrada");
    expect(t("audit.export.done", { count: 2 })).toBe("Se exportaron 2 entradas a audit-log.csv.");
  });
});

describe("challenges (Spanish)", () => {
  it("formats phases, windows, goals, rewards and validation messages", () => {
    setLocale("es");
    expect(phaseLabel("current")).toBe("Esta semana");
    expect(formatWindow(theme().startDate, theme().endDate)).toMatch(/ al /);
    expect(formatGoal(15, "pasos")).toBe("15 pasos");
    expect(formatReward(50)).toBe("+50 puntos");
    const draft: ThemeDraft = { ...theme(), title: "" };
    expect(validateThemeDraft(draft).title).toBe("El título debe tener de 1 a 60 caracteres.");
    expect(overlapMessage(theme())).toContain("Se superpone con “Fitness”");
  });

  it("renders a review row in Spanish", () => {
    setLocale("es");
    render(<ChallengeTable><ChallengeRow theme={theme()} phase="current" pending="7" /></ChallengeTable>);
    const row = screen.getByTestId("challenge-row");
    expect(within(row).getByText("Esta semana")).toBeTruthy();
    expect(within(row).getByText("7 pendientes")).toBeTruthy();
    expect(within(row).getByText("41 completaron")).toBeTruthy();
    expect(within(row).getByRole("link", { name: /Revisar participaciones de Fitness/ })).toBeTruthy();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toContain("Reto");
  });
});
