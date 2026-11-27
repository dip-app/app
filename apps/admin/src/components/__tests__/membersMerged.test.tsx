// @vitest-environment jsdom
// Members after the Roster merge: one page with All, Active, Invited, Deactivated (and Revoked), the invitation actions,
// the invited person's details, and organizers who only look people up.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const member = (id: string, displayName: string, status = "active") => ({
  id, email: `${id}@acme.com`, displayName, role: "member", teamIds: [], workLocation: "", department: "", jobTitle: "", status,
  pointsBalance: 10, createdAt: "2026-11-01T00:00:00.000Z", avatarId: "", city: "", photoURL: "", revision: 1,
});
const invite = (entryId: string, displayName: string, state = "invited") => ({
  entryId, email: `${entryId}@acme.com`, displayName, role: "member", teamIds: [], workLocation: "Lisbon", department: "Design", jobTitle: "", state,
  invitedAt: "2026-11-02T00:00:00.000Z", inviteEmailCount: 1, lastInviteEmailAt: "2026-11-03T00:00:00.000Z",
}) as Record<string, unknown>;

const state = { role: "admin", status: "all" };
const api = {
  companyInfo: vi.fn(),
  listMembersPage: vi.fn(),
  listRosterPage: vi.fn(),
  sendInviteEmail: vi.fn(),
  resendInvite: vi.fn(),
  revokeRosterEntry: vi.fn(),
  reinvite: vi.fn(),
  backfillRoster: vi.fn(),
};

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), usePathname: () => "/members/", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/components/AppProvider", () => ({ useApp: () => ({ api, session: { uid: `u-${state.role}`, role: state.role, name: "Ada", email: "a@acme.com", companyId: "acme" } }) }));
vi.mock("@/components/Shell", () => import("./shellMock"));
vi.mock("@/lib/useQueryState", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/useQueryState")>();
  return { ...real, useQueryState: (defaults: Record<string, string>) => [{ ...defaults, status: state.status }, vi.fn()] };
});

import { resetCache } from "@/lib/queryCache";
import { setLocale } from "@/lib/i18n";
import MembersPage from "../../app/members/page";

HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) { this.removeAttribute("open"); };

beforeEach(() => {
  resetCache();
  api.companyInfo.mockResolvedValue({ name: "Acme", emailDomain: "acme.com", teams: [] });
  api.listMembersPage.mockImplementation(async (q: { status: string }) => {
    const all = [member("m1", "Bea Active"), member("m2", "Cy Gone", "deactivated")];
    const rows = all.filter((m) => q.status === "all" || m.status === q.status);
    return { members: rows, nextCursor: null, total: all.length };
  });
  api.listRosterPage.mockImplementation(async (q: { state: string }) => {
    const rows = [invite("r1", "Dee Invited"), invite("r2", "Eli Revoked", "revoked")].filter((r) => q.state === "all" || r.state === q.state);
    return { rows, nextCursor: null, counts: { all: 4, invited: 1, active: 1, deactivated: 1, revoked: 1 }, inviteEmail: true };
  });
  api.sendInviteEmail.mockResolvedValue({ inviteEmailCount: 2, lastInviteEmailAt: "2026-11-20T00:00:00.000Z" });
});

afterEach(() => {
  cleanup();
  setLocale("en");
  state.role = "admin";
  state.status = "all";
  vi.clearAllMocks();
});

describe("Members (merged with the roster)", () => {
  it("All lists people who joined and, below them, invited people who haven't; tabs carry counts", async () => {
    render(<MembersPage />);
    await waitFor(() => expect(screen.getByText("Bea Active")).toBeTruthy());
    expect(screen.getByRole("tab", { name: "All (3)" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Active (1)" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Invited (1)" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Deactivated (1)" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Revoked (1)" })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("heading", { name: "1 invited person hasn’t joined yet" })).toBeTruthy());
    expect(screen.getByText("Dee Invited")).toBeTruthy();
    const actions = screen.getByTestId("page-actions");
    expect(within(actions).getByRole("button", { name: "Add person" })).toBeTruthy();
    expect(within(actions).getByRole("link", { name: "Import people" }).getAttribute("href")).toBe("/import");
    expect(within(actions).getByRole("button", { name: "Export CSV" })).toBeTruthy();
  });

  it("Invited shows the invitation actions and opens an invited person's details", async () => {
    state.status = "invited";
    render(<MembersPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Send an invite email to Dee Invited" })).toBeTruthy());
    expect(screen.getByRole("button", { name: "Revoke invite for Dee Invited" })).toBeTruthy();
    expect(screen.queryByText("Bea Active")).toBeNull();
    expect(screen.queryByRole("button", { name: "Export CSV" })).toBeNull();
    expect(api.listRosterPage).toHaveBeenCalledWith({ query: "", state: "invited" }, null, 25);

    fireEvent.click(document.querySelector("button.person") as HTMLElement);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("They haven’t signed in yet. They get this role and these teams when they sign in with this email.")).toBeTruthy();
    expect(within(dialog).getByText("Lisbon")).toBeTruthy();
    expect(within(dialog).getByText("Design")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Send invite email" }));
    await waitFor(() => expect(api.sendInviteEmail).toHaveBeenCalledTimes(1));
  });

  it("Revoked offers Invite again", async () => {
    state.status = "revoked";
    render(<MembersPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Invite again: Eli Revoked" })).toBeTruthy());
  });

  it("organizers look people up without invitations: no Invited tab, no roster calls, no invite actions", async () => {
    state.role = "organizer";
    state.status = "invited"; // an old link: falls back to All
    render(<MembersPage />);
    await waitFor(() => expect(screen.getByText("Bea Active")).toBeTruthy());
    expect(screen.queryByRole("tab", { name: /Invited/ })).toBeNull();
    expect(screen.queryByRole("tab", { name: /Revoked/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add person" })).toBeNull();
    expect(api.listRosterPage).not.toHaveBeenCalled();
  });

  it("reads in Spanish", async () => {
    setLocale("es");
    render(<MembersPage />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "Invitados (1)" })).toBeTruthy());
    await waitFor(() => expect(screen.getByRole("heading", { name: "1 persona invitada aún no se une" })).toBeTruthy());
  });
});
