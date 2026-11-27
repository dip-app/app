// @vitest-environment jsdom
// Challenge review page in Spanish and English: statuses, queue, detail, shortcuts and the approve dialog.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const theme = {
  id: "t1", companyId: "acme", title: "Fitness", description: "", tagIds: [], type: "weekly", goal: 3, goalUnit: "workouts",
  coverImageURL: "catalog://theme/fitness", startDate: "2026-11-09T05:00:00.000Z", endDate: "2026-11-16T04:59:59.000Z", pointsReward: 50,
  participantCount: 10, completedCount: 1, createdBy: "u", createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z", revision: 1,
};
const submission = {
  id: "s1", userId: "u1", userName: "Nico Farrow", photoURL: null, avatarId: null, status: "submitted", progress: 3, attempt: 2, caption: "Done!",
  storagePath: null, createdAt: "2026-11-10T15:00:00.000Z", updatedAt: "2026-11-10T16:00:00.000Z", reviewedAt: null, reviewNote: null, pointsAwarded: 0,
};
const api = {
  listThemes: vi.fn().mockResolvedValue([theme]),
  listSubmissions: vi.fn().mockResolvedValue({ submissions: [submission], nextCursor: null }),
  submissionEvidence: vi.fn().mockResolvedValue("blob:x"),
};

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("id=t1"), usePathname: () => "/challenges/review/", useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/components/AppProvider", () => ({ useApp: () => ({ api, session: { uid: "admin1", role: "admin", name: "Ada", email: "a@example.com", companyId: "acme" } }) }));
vi.mock("@/components/Shell", () => import("./shellMock"));
vi.mock("@/components/ThemeArt", () => ({ ThemeArt: () => null }));
vi.mock("@/lib/useQueryState", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/useQueryState")>();
  return { ...real, useQueryState: (defaults: Record<string, string>) => [defaults, vi.fn()] };
});

import { setLocale, t } from "@/lib/i18n";
import ChallengeReviewPage from "../../app/challenges/review/page";

HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) { this.removeAttribute("open"); };

afterEach(() => {
  cleanup();
  setLocale("en");
});

describe("challenge review (Spanish)", () => {
  it("renders the page in Spanish", async () => {
    setLocale("es");
    render(<ChallengeReviewPage />);
    await waitFor(() => expect(screen.getByRole("article", { name: "Participación de Nico Farrow" })).toBeTruthy());
    // The header names the theme once loaded (the page title "Revisar participaciones" is its eyebrow in the real Shell).
    await waitFor(() => expect(screen.getByTestId("page-meta")).toBeTruthy());
    expect(screen.getByText("Retos")).toBeTruthy();
    expect(screen.getAllByText("Pendiente").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Intento 2").length).toBe(2);
    expect(screen.getByRole("button", { name: "Aprobar · 50 puntos" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Solicitar cambios" })).toBeTruthy();
    expect(screen.getByText("1 de 1")).toBeTruthy();
    expect(screen.getByText("Nota del miembro")).toBeTruthy();
    expect(screen.getByLabelText("Presiona J para ir a la siguiente")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Aprobar · 50 puntos" }));
    await waitFor(() => expect(screen.getByText("¿Aprobar a Nico Farrow?")).toBeTruthy());
    expect(screen.getByText("3 de 3 workouts, sin foto.")).toBeTruthy();
    expect(screen.getByText(/se agregan ahora al saldo de Nico Farrow/)).toBeTruthy();
  });

  it("keeps English unchanged", async () => {
    render(<ChallengeReviewPage />);
    await waitFor(() => expect(screen.getByRole("article", { name: "Submission from Nico Farrow" })).toBeTruthy());
    expect(screen.getByRole("button", { name: "Approve · 50 points" })).toBeTruthy();
    expect(screen.getByLabelText("Press A for approve")).toBeTruthy();
    expect(screen.getByLabelText("Press R for request changes")).toBeTruthy();
    expect(screen.getByText("1 of 1")).toBeTruthy();
    expect(t("review.result.approvedOn", { when: "Nov 10, 3:00 PM", points: 50 })).toBe("Approved on Nov 10, 3:00 PM. 50 points awarded. Approvals are final.");
  });
});
