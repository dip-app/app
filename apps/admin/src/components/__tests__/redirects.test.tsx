// @vitest-environment jsdom
// Old portal addresses that moved: Roster -> Members (invitation views), Weekly themes -> Challenges.
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const nav = { search: "", replace: vi.fn() };
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(nav.search), useRouter: () => ({ replace: nav.replace }) }));

import { rosterToMembers, withQuery } from "@/components/Redirect";
import RosterRedirect from "../../app/roster/page";
import ThemesRedirect from "../../app/themes/page";
import NewThemeRedirect from "../../app/themes/new/page";
import EditThemeRedirect from "../../app/themes/edit/page";

afterEach(() => { cleanup(); nav.replace.mockClear(); });

describe("moved pages", () => {
  it("maps roster filters to the Members views and keeps the search", () => {
    expect(rosterToMembers(new URLSearchParams(""))).toBe("/members/?status=invited");
    expect(rosterToMembers(new URLSearchParams("filter=all&q=ana"))).toBe("/members/?status=invited&q=ana");
    expect(rosterToMembers(new URLSearchParams("filter=revoked"))).toBe("/members/?status=revoked");
    expect(rosterToMembers(new URLSearchParams("filter=deactivated"))).toBe("/members/?status=deactivated");
    expect(withQuery("/challenges/", new URLSearchParams(""))).toBe("/challenges/");
  });

  it.each([
    [RosterRedirect, "filter=revoked", "/members/?status=revoked"],
    [ThemesRedirect, "phase=past", "/challenges/?phase=past"],
    [NewThemeRedirect, "", "/challenges/new/"],
    [EditThemeRedirect, "id=t1", "/challenges/edit/?id=t1"],
  ])("replaces the old address (%#)", (Page, search, target) => {
    nav.search = search;
    render(<Page />);
    expect(nav.replace).toHaveBeenCalledWith(target);
  });
});
