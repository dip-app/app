// @vitest-environment jsdom
// Spanish for the bug reports page: labels, plurals, the report list and the detail form; English stays unchanged.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale, t } from "@/lib/i18n";
import { stubLocalStorage } from "./storageStub";

const report = {
  id: "b1", category: "looksWrong", description: "Button is cut off", source: "shake", screen: "myEvents", createdAt: "2026-11-10T15:30:00.000Z",
  reporterId: "u1", reporterName: "Ada Lovelace", hasScreenshot: false, status: "new", hasNote: false,
};
const api = {
  listMembersPage: vi.fn(async () => ({ members: [], nextCursor: null })),
  listBugReports: vi.fn(async () => ({ reports: [report], nextCursor: null, counts: { all: 1, new: 1, triaged: 0, resolved: 0, capped: false } })),
  getBugReport: vi.fn(async () => ({
    report, reporterEmail: "ada@example.com", note: "", revision: 1, updatedAt: "", updatedByName: "", screenshotUrl: null,
    diagnostics: { appVersion: "1.2", appBuild: "34", osVersion: "iOS 19", deviceModel: "iPhone", locale: "es-MX", screen: "myEvents", installId: "abc" },
  })),
  updateBugReport: vi.fn(),
};

vi.mock("next/navigation", () => ({ usePathname: () => "/bug-reports", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/AppProvider", () => ({ useApp: () => ({ api, session: { uid: "a" } }) }));
vi.mock("@/components/Shell", () => ({
  Shell: ({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) => <div><h1>{title}</h1><p>{subtitle}</p>{children}</div>,
}));

import BugReportsPage from "../../app/bug-reports/page";

beforeEach(() => {
  stubLocalStorage();
  window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
});
afterEach(() => { cleanup(); setLocale("en"); });

describe("bug reports (Spanish)", () => {
  it("pluralizes counts", () => {
    setLocale("es");
    expect(t("bugs.count.matches", { shown: 1 })).toBe("1 reporte coincide");
    expect(t("bugs.count.matches", { shown: 3 })).toBe("3 reportes coinciden");
    expect(t("bugs.count.showingOf", { shown: "1", total: 1 })).toBe("Mostrando 1 de 1 reporte");
  });

  it("renders the page, list and filters in Spanish", async () => {
    setLocale("es");
    render(<BugReportsPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Reportes de errores" })).toBeTruthy();
    expect(await screen.findByText("Button is cut off")).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Clasificado/ })).toBeTruthy();
    expect(screen.getByLabelText("Buscar reportes")).toBeTruthy();
    expect(await screen.findByText(/^(Mostrando 1 de 1 reporte|1 reporte coincide)$/)).toBeTruthy();
    expect(screen.getAllByText("Se ve mal").length).toBeGreaterThan(0);
  });

  it("renders the detail in Spanish and keeps the status id as the option value", async () => {
    setLocale("es");
    render(<BugReportsPage />);
    fireEvent.click(await screen.findByText("Button is cut off"));
    expect(await screen.findByRole("heading", { name: "Clasificación" })).toBeTruthy();
    expect(screen.getByText(/Enviado .* desde Mis eventos al sacudir el teléfono\./)).toBeTruthy();
    expect(screen.getByText("Versión de la app")).toBeTruthy();
    expect(screen.getByText("No hay cambios que guardar")).toBeTruthy();
    const option = screen.getByRole("option", { name: "Resuelto" }) as HTMLOptionElement;
    expect(option.value).toBe("resolved");
    await waitFor(() => expect(screen.getByLabelText("Reporte de error de Ada Lovelace")).toBeTruthy());
  });
});

describe("bug reports (English)", () => {
  it("keeps English unchanged", async () => {
    render(<BugReportsPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Bug reports" })).toBeTruthy();
    expect(await screen.findByText("Showing 1 of 1 report")).toBeTruthy();
    fireEvent.click(await screen.findByText("Button is cut off"));
    expect(await screen.findByText(/Sent .* from My events by shaking the phone\./)).toBeTruthy();
    expect(screen.getByText("No changes to save")).toBeTruthy();
    expect(t("bugs.count.matches", { shown: 1234 })).toBe("1,234 reports match");
  });
});
