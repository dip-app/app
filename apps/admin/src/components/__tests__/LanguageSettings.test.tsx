// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEY, setLocale } from "@/lib/i18n";
import { stubLocalStorage } from "./storageStub";

const state = vi.hoisted(() => ({ mode: "mock" as "mock" | "live" }));

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ usePathname: () => "/account/", useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("../AppProvider", () => ({
  useApp: () => ({
    session: { uid: "u1", name: "Ada Lovelace", email: "ada@example.com", companyId: "c", role: "organizer" },
    signOut: vi.fn(),
    api: { mode: state.mode, listBugReports: vi.fn().mockResolvedValue({ counts: null }) },
  }),
}));

import { I18nProvider } from "../I18nProvider";
import { LanguageSettings } from "../LanguageSettings";
import { Shell } from "../Shell";

beforeEach(() => { stubLocalStorage(); state.mode = "mock"; vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US"]); });
afterEach(() => { cleanup(); act(() => setLocale("en")); vi.restoreAllMocks(); });

function Page() {
  return <I18nProvider><Shell title="Your settings"><LanguageSettings /></Shell></I18nProvider>;
}

describe("language picker", () => {
  it("offers the browser default, the shipped languages in their own names, and pseudo outside live mode", () => {
    render(<LanguageSettings />);
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Same as this browser (English)", "English", "Español", "Pseudo (layout test)"]);
    cleanup();
    state.mode = "live";
    render(<LanguageSettings />);
    expect(screen.queryByRole("option", { name: /Pseudo/ })).toBeNull();
  });

  it("switches the whole frame to Spanish, saves the choice in this browser and sets <html lang>", () => {
    render(<Page />);
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
    act(() => { fireEvent.change(screen.getByLabelText("Language"), { target: { value: "es" } }); });
    expect(localStorage.getItem(STORAGE_KEY)).toBe("es");
    expect(document.documentElement.lang).toBe("es");
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Eventos" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Tus ajustes, Ada Lovelace, Organizador/ })).toBeTruthy();
    expect((screen.getByLabelText("Idioma") as HTMLSelectElement).value).toBe("es");
  });

  it("goes back to following the browser", () => {
    localStorage.setItem(STORAGE_KEY, "es");
    act(() => setLocale("es"));
    render(<Page />);
    act(() => { fireEvent.change(screen.getByLabelText("Idioma"), { target: { value: "auto" } }); });
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });
});
