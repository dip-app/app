// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  api: { listBugReports: () => Promise.resolve({ counts: null }), emailSwitches: () => Promise.resolve({ weekly_themes: false, admin_digest: false }) },
  pathname: "/overview/",
  session: { uid: "u1", name: "Ada Lovelace", email: "ada@example.com", companyId: "c", role: "admin" } as { uid: string; name: string; email: string; companyId: string; role: string },
}));

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname, useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("../AppProvider", () => ({ useApp: () => ({ session: state.session, signOut: vi.fn(), api: state.api }) }));
vi.mock("../SuggestionsEmail", () => ({ SuggestionsEmail: () => <div data-testid="email-settings" /> }));

import { Shell } from "../Shell";
import { UserSettings } from "../UserSettings";

beforeEach(() => { state.pathname = "/overview/"; state.session = { ...state.session, role: "admin" }; });
afterEach(cleanup);

describe("name block in the nav", () => {
  it("links to the settings page and names the user and role", () => {
    render(<Shell title="Overview"><p>body</p></Shell>);
    const link = screen.getByRole("link", { name: /Your settings, Ada Lovelace/ });
    expect(link.getAttribute("href")).toBe("/account/");
    expect(link.getAttribute("aria-current")).toBeNull();
    expect(link.textContent).toContain("Ada Lovelace");
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });

  it("is highlighted on the settings page", () => {
    state.pathname = "/account/";
    render(<Shell title="Your settings"><p>body</p></Shell>);
    expect(screen.getByRole("link", { name: /Your settings, Ada Lovelace/ }).getAttribute("aria-current")).toBe("page");
  });

  it("no longer lists the email page in the main nav", () => {
    render(<Shell title="Overview"><p>body</p></Shell>);
    expect(screen.queryByRole("link", { name: "Weekly ideas email" })).toBeNull();
  });
});

describe("UserSettings", () => {
  it("shows Language first, then the weekly email section for admins, then the other emails note", () => {
    render(<UserSettings />);
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Language", "Weekly ideas email", "Other emails from DIP"]);
    expect(screen.getByTestId("email-settings")).toBeTruthy();
  });

  it("hides sections the role cannot use; everyone gets the language picker", () => {
    state.session = { ...state.session, role: "member" };
    render(<UserSettings />);
    expect(screen.queryByTestId("email-settings")).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "Language" })).toBeTruthy();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Language", "Other emails from DIP"]);
  });
});
