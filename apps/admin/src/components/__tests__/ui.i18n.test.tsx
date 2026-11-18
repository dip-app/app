// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { Dialog } from "../Dialog";
import { PageSkeleton } from "../PageSkeletons";
import { Tabs } from "../Tabs";
import { Toggle } from "../Toggle";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute("open"); };
});
afterEach(() => { cleanup(); setLocale("en"); vi.useRealTimers(); });
afterAll(() => setLocale("en"));

describe("shared UI in Spanish", () => {
  it("Dialog shows Cancelar and the reason copy", () => {
    setLocale("es");
    render(<Dialog title="t" confirmLabel="Ok" reasonLabel="Motivo" onConfirm={async () => {}} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeTruthy();
    expect(screen.getByLabelText("Motivo (obligatorio)")).toBeTruthy();
  });

  it("Toggle state text is translated", () => {
    setLocale("es");
    render(<Toggle checked label="x" onChange={() => {}} />);
    expect(screen.getByRole("switch").textContent).toContain("Activado");
  });

  it("Tabs count uses the shared message", () => {
    setLocale("es");
    render(<Tabs label="l" value="a" onChange={() => {}} items={[{ id: "a", label: "Uno", count: 3 }]} />);
    expect(screen.getByRole("tab").textContent).toBe("Uno (3)");
  });

  it("a skeleton table header is translated", () => {
    vi.useFakeTimers();
    setLocale("es");
    const { container } = render(<PageSkeleton layout="events" label="Cargando" />);
    act(() => { vi.advanceTimersByTime(300); });
    expect([...container.querySelectorAll("th")].map((th) => th.textContent)).toContain("Evento");
  });
});
