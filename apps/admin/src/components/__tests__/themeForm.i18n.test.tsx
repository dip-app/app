// @vitest-environment jsdom
// Spanish for the theme form area: the preview card renders translated, English stays unchanged.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ThemeDraft } from "@/lib/challenge";
import { setLocale, t } from "@/lib/i18n";
import { ThemePreview } from "../ThemePreview";

afterEach(() => {
  cleanup();
  setLocale("en");
});

const draft: ThemeDraft = {
  title: "", description: "", tagIds: [], type: "weekly", goal: 3, goalUnit: "workouts",
  coverImageURL: "catalog://theme/fitness", startDate: "2026-11-09T05:00:00.000Z", endDate: "2026-11-16T04:59:59.000Z", pointsReward: 50,
};

describe("theme preview", () => {
  it("renders English unchanged", () => {
    render(<ThemePreview draft={draft} participantCount={3} />);
    expect(screen.getByLabelText("Preview")).toBeTruthy();
    expect(screen.getByText("Preview: This Week’s Challenge")).toBeTruthy();
    expect(screen.getByText("Theme title")).toBeTruthy();
    expect(screen.getByText("+ 3 others participating")).toBeTruthy();
    expect(screen.getByText("3 workouts")).toBeTruthy();
  });

  it("renders Spanish", () => {
    setLocale("es");
    render(<ThemePreview draft={draft} participantCount={0} />);
    expect(screen.getByLabelText("Vista previa")).toBeTruthy();
    expect(screen.getByText("Título del tema")).toBeTruthy();
    expect(screen.getByText("Sé el primero esta semana")).toBeTruthy();
    expect(screen.getByText("Semana")).toBeTruthy();
  });
});

describe("theme form messages", () => {
  it("pluralizes the field count and fills slots", () => {
    expect(t("themeForm.fixFields", { count: 1 })).toBe("Fix 1 field to continue.");
    expect(t("themeForm.fixFields", { count: 3 })).toBe("Fix 3 fields to continue.");
    setLocale("es");
    expect(t("themeForm.fixFields", { count: 1 })).toBe("Corrige 1 campo para continuar.");
    expect(t("themeForm.fixFields", { count: 3 })).toBe("Corrige 3 campos para continuar.");
    expect(t("themeForm.optionTaken", { label: "Semana", title: "Yoga" })).toBe("Semana (ocupada: Yoga)");
    expect(t("themeForm.pointsHint", { max: 1000 })).toContain("de 0 a 1000");
  });

  it("keeps English strings byte for byte", () => {
    expect(t("themeForm.toast.saved", { title: "Yoga" })).toBe("Saved changes to “Yoga”.");
    expect(t("themeForm.weeksHint", { zone: "Eastern Time" })).toBe("Themes run Monday 12:00 AM to Sunday 11:59 PM Eastern Time, for one or two weeks. Weeks that already have a theme are marked taken.");
    expect(t("themeForm.counts", { joined: 4, completed: 2 })).toBe("4 joined · 2 completed. These counts update as members take part.");
  });
});
