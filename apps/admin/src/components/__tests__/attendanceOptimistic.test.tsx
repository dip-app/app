// @vitest-environment jsdom
// Check-in is optimistic: the row changes at once, rolls back on failure, and overlapping check-ins are never flipped
// back by a refresh that answers with an older list.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/contract";
import type { Attendee } from "@/lib/adminTypes";

const person = (memberId: string, name: string): Attendee => ({ memberId, name, email: `${memberId}@acme.com`, department: "Ops", jobTitle: "Lead", rsvpAt: "2026-11-01T10:00:00Z", checkedIn: false, addedByAdmin: false });
let server: Attendee[] = [];
const listAttendees = vi.fn(async () => server.map((row) => ({ ...row })));
const recordAttendance = vi.fn<(eventId: string, memberId: string, checkedIn: boolean) => Promise<{ pointsAwarded: number; checkedIn: boolean }>>();
const api = {
  getEvent: async () => ({ id: "e1", title: "Game night", capacity: 20, startTime: "2026-11-01T18:00:00Z", endTime: "2026-11-01T20:00:00Z", status: "published" }),
  listAttendees: () => listAttendees(),
  listMembers: async () => [],
  recordAttendance: (e: string, m: string, c: boolean) => recordAttendance(e, m, c),
};
vi.mock("../AppProvider", () => ({ useApp: () => ({ api, session: { uid: "u", companyId: "c", role: "admin" } }) }));
vi.mock("../Shell", () => ({ Shell: ({ children }: { children: ReactNode }) => <main id="main">{children}</main> }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("id=e1"), useRouter: () => ({ replace: () => {} }), usePathname: () => "/events/attendees/" }));

import AttendeesPage from "@/app/events/attendees/page";

const row = (name: string) => screen.getByText(name).closest("tr")!;
const status = (name: string) => within(row(name)).getByText(/Checked in|Not checked in|No-show/).textContent;

beforeEach(() => {
  server = [person("a", "Ana Ruiz"), person("b", "Ben Cho")];
  listAttendees.mockClear();
  recordAttendance.mockReset();
});
afterEach(cleanup);

describe("optimistic check-in", () => {
  it("changes the row at once, keeps focus on its button, and rolls back with the error if the server refuses", async () => {
    render(<AttendeesPage />);
    await waitFor(() => expect(screen.getByText("Ana Ruiz")).toBeTruthy());
    let refuse: (e: unknown) => void = () => {};
    recordAttendance.mockReturnValueOnce(new Promise((_, reject) => { refuse = reject; }));
    const button = screen.getByRole("button", { name: "Check in Ana Ruiz" });
    button.focus();
    fireEvent.click(button);
    expect(status("Ana Ruiz")).toBe("Checked in");
    const pending = within(row("Ana Ruiz")).getAllByRole("button")[0];
    expect(pending.getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(pending);
    await act(async () => refuse(new ApiError("failed-precondition", "Check-in is closed.")));
    expect(status("Ana Ruiz")).not.toBe("Checked in");
    expect(screen.getByRole("alert").textContent).toContain("Check-in is closed.");
  });

  it("two check-ins in a row both stay checked in, even while an older list is still answering", async () => {
    render(<AttendeesPage />);
    await waitFor(() => expect(screen.getByText("Ana Ruiz")).toBeTruthy());
    const answers: Array<() => void> = [];
    recordAttendance.mockImplementation((_e, memberId, checkedIn) => new Promise((resolve) => {
      answers.push(() => { server = server.map((r) => (r.memberId === memberId ? { ...r, checkedIn } : r)); resolve({ pointsAwarded: 0, checkedIn }); });
    }));
    fireEvent.click(screen.getByRole("button", { name: "Check in Ana Ruiz" }));
    fireEvent.click(screen.getByRole("button", { name: "Check in Ben Cho" }));
    expect(status("Ana Ruiz")).toBe("Checked in");
    expect(status("Ben Cho")).toBe("Checked in");
    // Ana's answer arrives first; no refresh starts while Ben's request is still running.
    const reads = listAttendees.mock.calls.length;
    await act(async () => answers[0]());
    expect(listAttendees.mock.calls.length).toBe(reads);
    expect(status("Ben Cho")).toBe("Checked in");
    await act(async () => answers[1]());
    await waitFor(() => expect(listAttendees.mock.calls.length).toBe(reads + 1));
    await waitFor(() => expect(within(row("Ben Cho")).getAllByRole("button")[0].getAttribute("aria-busy")).toBeNull());
    expect(status("Ana Ruiz")).toBe("Checked in");
    expect(status("Ben Cho")).toBe("Checked in");
  });
});
