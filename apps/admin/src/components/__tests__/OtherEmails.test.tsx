// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emailSwitchesFrom, type EmailSwitch, type EmailSwitches } from "@/lib/adminTypes";
import { createMockApi } from "@/lib/api";
import { ApiError } from "@/lib/contract";
import { stubLocalStorage } from "./storageStub";

const state = vi.hoisted(() => ({
  role: "admin" as string,
  switches: { weekly_themes: false, admin_digest: false } as Record<string, boolean>,
  setEmailSwitch: vi.fn(),
}));

// Stable objects per test, like the real provider (useLoad refetches when the api or session identity changes).
const app = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("../AppProvider", () => ({ useApp: () => app.value }));
vi.mock("../Toast", () => ({ toast: vi.fn() }));

import { OtherEmails } from "../OtherEmails";

beforeEach(() => {
  state.role = "admin";
  state.switches = { weekly_themes: false, admin_digest: false };
  state.setEmailSwitch = vi.fn(async (name: EmailSwitch, on: boolean) => { state.switches[name] = on; return { ...state.switches } as EmailSwitches; });
  setApp();
});
function setApp() {
  app.value = {
    session: { uid: "u1", name: "Ada Lovelace", email: "ada@example.com", companyId: "c", role: state.role },
    api: { emailSwitches: async () => ({ ...state.switches }), setEmailSwitch: (name: EmailSwitch, on: boolean) => state.setEmailSwitch(name, on) },
  };
}
afterEach(cleanup);

describe("Your settings > Other emails", () => {
  it("shows both opt-in switches off by default for an admin, and the notes", async () => {
    render(<OtherEmails />);
    const weekly = await screen.findByRole("switch", { name: /Weekly challenge email/ });
    const digest = screen.getByRole("switch", { name: /Daily roster digest/ });
    expect(weekly.getAttribute("aria-checked")).toBe("false");
    expect(digest.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText(/Profile > Notifications/)).toBeTruthy();
  });

  it("organizers get the weekly challenge switch but not the admin digest", async () => {
    state.role = "organizer";
    setApp();
    render(<OtherEmails />);
    await screen.findByRole("switch", { name: /Weekly challenge email/ });
    expect(screen.queryByRole("switch", { name: /Daily roster digest/ })).toBeNull();
  });

  it("turning a switch on saves only that switch and shows it on", async () => {
    render(<OtherEmails />);
    const digest = await screen.findByRole("switch", { name: /Daily roster digest/ });
    await act(async () => { fireEvent.click(digest); });
    expect(state.setEmailSwitch).toHaveBeenCalledWith("admin_digest", true);
    await waitFor(() => expect(screen.getByRole("switch", { name: /Daily roster digest/ }).getAttribute("aria-checked")).toBe("true"));
    expect(screen.getByRole("switch", { name: /Weekly challenge email/ }).getAttribute("aria-checked")).toBe("false");
  });

  it("a failed save puts the switch back", async () => {
    state.setEmailSwitch = vi.fn(async () => { throw new ApiError("permission-denied", "nope"); });
    render(<OtherEmails />);
    const weekly = await screen.findByRole("switch", { name: /Weekly challenge email/ });
    await act(async () => { fireEvent.click(weekly); });
    await waitFor(() => expect(screen.getByRole("switch", { name: /Weekly challenge email/ }).getAttribute("aria-checked")).toBe("false"));
  });
});

describe("mock adapter email switches", () => {
  beforeEach(() => stubLocalStorage());

  it("are per person, off until set, and only a stored true counts", async () => {
    const api = createMockApi(localStorage);
    await api.signIn("admin");
    expect(await api.emailSwitches()).toEqual({ weekly_themes: false, admin_digest: false });
    expect(await api.setEmailSwitch("weekly_themes", true)).toEqual({ weekly_themes: true, admin_digest: false });
    await api.signIn("organizer");
    expect(await api.emailSwitches()).toEqual({ weekly_themes: false, admin_digest: false });
    expect(emailSwitchesFrom({ weekly_themes: "true", admin_digest: 1 })).toEqual({ weekly_themes: false, admin_digest: false });
    expect(emailSwitchesFrom(null)).toEqual({ weekly_themes: false, admin_digest: false });
  });
});
