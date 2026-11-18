// @vitest-environment jsdom
// Member detail page in Spanish and English: labels, role dialog split sentence, plurals-free slots.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const member = {
  id: "m1", displayName: "Nico Farrow", email: "nico@example.com", role: "member", status: "active", teamIds: [], workLocation: "Austin",
  department: "Ops", jobTitle: "Lead", city: "", pointsBalance: 120, createdAt: "2026-03-02T12:00:00.000Z", revision: 1,
};
const api = {
  getMember: vi.fn().mockResolvedValue(member),
  companyInfo: vi.fn().mockResolvedValue({ teams: [{ id: "t1", name: "Design" }] }),
};

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("id=m1"), usePathname: () => "/members/detail/", useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/components/AppProvider", () => ({ useApp: () => ({ api, session: { uid: "admin1", role: "admin", name: "Ada", email: "a@example.com", companyId: "c" } }) }));
vi.mock("@/components/Shell", () => ({ Shell: ({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) => <main><h1>{title}</h1><p>{subtitle}</p>{children}</main> }));
vi.mock("@/lib/useUnsavedGuard", () => ({ useUnsavedGuard: () => {} }));
vi.mock("@/components/useDelayedShow", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/components/useDelayedShow")>()), useSkeletonGate: () => false }));

import { setLocale, t } from "@/lib/i18n";
import MemberDetailPage from "../../app/members/detail/page";

HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute("open"); };

afterEach(() => {
  cleanup();
  setLocale("en");
});

describe("member detail (Spanish)", () => {
  it("renders the page in Spanish", async () => {
    setLocale("es");
    render(<MemberDetailPage />);
    await waitFor(() => expect(screen.getByText("Todos los miembros")).toBeTruthy());
    expect(screen.getByRole("heading", { level: 1, name: "Miembro" })).toBeTruthy();
    expect(screen.getByText("Activo")).toBeTruthy();
    expect(screen.getByLabelText("Rol")).toBeTruthy();
    expect(screen.getByText("Equipos")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeTruthy();
    expect(screen.getByText("Perfil de participante")).toBeTruthy();
    expect(screen.getByText(/^Se unió el /)).toBeTruthy();
  });

  it("builds the role dialog sentence and confirm label from parts", () => {
    setLocale("es");
    expect(t("memberDetail.role.confirm", { role: "admin" })).toBe("Hacer administrador");
    expect(t("memberDetail.role.title", { name: "Nico" })).toBe("¿Cambiar el rol de Nico?");
    expect(t("memberDetail.pointsDialog.balanceBecomes", { balance: 5, next: 10 })).toBe("Saldo: 5, pasará a 10. No puede bajar de 0.");
  });

  it("opens the role change dialog in Spanish", async () => {
    setLocale("es");
    render(<MemberDetailPage />);
    await waitFor(() => screen.getByLabelText("Rol"));
    fireEvent.change(screen.getByLabelText("Rol"), { target: { value: "organizer" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(screen.getByText("¿Cambiar el rol de Nico Farrow?")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Hacer organizador" })).toBeTruthy();
  });
});

describe("member detail (English)", () => {
  it("keeps the English text", async () => {
    render(<MemberDetailPage />);
    await waitFor(() => expect(screen.getByText("All members")).toBeTruthy());
    expect(screen.getByText("Joined Mar 2, 2026")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "admin" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Make Admin" })).toBeTruthy());
    expect(document.body.textContent).toContain("Nico Farrow goes from Member to Admin.");
  });
});
