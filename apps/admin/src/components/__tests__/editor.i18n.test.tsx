// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import { describeDuration, dstNote, formatDuration } from "@/lib/when";
import { coverByURL } from "@/lib/covers";
import { WhenPicker } from "../WhenPicker";

afterEach(() => { cleanup(); setLocale("en"); });

describe("editor area in Spanish", () => {
  it("renders the When picker labels, month and weekdays in Spanish", () => {
    setLocale("es");
    render(<WhenPicker startTime="2026-11-20T18:00:00.000Z" endTime="2026-11-20T19:30:00.000Z" onChange={() => {}} now={new Date(2026, 10, 18, 9, 0)} />);
    expect(screen.getByRole("group", { name: "Fecha y hora del evento" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mes siguiente" })).toBeTruthy();
    expect(screen.getByText("Hoy")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "domingo" })).toBeTruthy();
    expect(screen.getByText(/noviembre de 2026/i)).toBeTruthy();
  });

  it("spells durations and plurals in Spanish", () => {
    setLocale("es");
    expect(describeDuration(90)).toBe("1 hora 30 minutos");
    expect(describeDuration(24 * 60 * 2)).toBe("2 días");
    expect(formatDuration(26 * 60)).toBe("1 d 2 h");
    expect(dstNote("2026-03-08", 2 * 60 + 30)).toMatch(/no existen ese día/);
  });

  it("translates the generic photo label", () => {
    setLocale("es");
    expect(coverByURL("catalog://cover/pixabay-123")?.label).toBe("Foto");
  });
});
