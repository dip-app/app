// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import { buildMockInsights } from "@/lib/insightsMock";
import { refreshFailureMessage, updatedLabel, weekRange } from "@/lib/insights";
import { interestLabel } from "@/lib/tagStats";
import { tagBlurb } from "@/lib/tagArt";
import { stubLocalStorage } from "./storageStub";
import { InterestsCard, StatTiles, UnavailableNotice } from "../Overview";

const NOW = new Date("2026-11-11T12:00:00Z");

beforeEach(() => { stubLocalStorage(); setLocale("es"); });
afterEach(() => { cleanup(); setLocale("en"); });

describe("Overview in Spanish", () => {
  it("translates tiles, plurals and notices", () => {
    const insights = buildMockInsights({
      members: [{ id: "m1", displayName: "Ada", status: "active", pointsBalance: 5 }], invited: 1,
      events: [], photos: 1, comments: 1, theme: null, pendingReviews: 0,
    }, "default", "admin", NOW);
    render(<><UnavailableNotice insights={{ ...insights, unavailable: ["events"] }} /><StatTiles insights={insights} role="admin" /></>);
    expect(screen.getByRole("group", { name: "Miembros" })).toBeTruthy();
    expect(screen.getByText("Persona que aún no inicia sesión")).toBeTruthy();
    expect(screen.getAllByText(/\d comentarios?$/).length).toBe(1);
    expect(screen.getByText(/No se pudieron cargar algunas secciones/)).toBeTruthy();
  });

  it("translates the interests card and its plural", () => {
    render(<InterestsCard stats={[{ tagId: "a", memberCount: 1, updatedAt: "2026-11-01T00:00:00Z" }]} tags={[{ id: "a", name: "Alpha" }]} activeMembers={null} />);
    expect(screen.getByText("Miembros que eligieron cada interés")).toBeTruthy();
  });

  it("translates helper strings", () => {
    expect(updatedLabel("2026-11-11T11:56:00Z", NOW)).toBe("Actualizado hace 4 min");
    expect(interestLabel(2)).toBe("2 miembros interesados");
    expect(weekRange("2026-11-09T12:00:00Z", "2026-11-15T12:00:00Z")).toContain(" al ");
    expect(refreshFailureMessage(["insights", "interestCounts"])).toContain("resumen de datos y conteos de intereses");
    expect(tagBlurb({ name: "Chill" })).toBe("Tranquilo y relajado");
  });
});
