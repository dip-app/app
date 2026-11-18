// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stubLocalStorage } from "./storageStub";
import type { TagStat } from "@/lib/tagStats";
import { InterestsCard } from "../Overview";

afterEach(cleanup);
// The list view is the table; the grid is the default (see Overview.grid tests).
beforeEach(() => { stubLocalStorage().setItem("dip.admin.interestsView", "list"); });

const tags = [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }, { id: "c", name: "Gamma" }];
const stat = (tagId: string, memberCount: number): TagStat => ({ tagId, memberCount, updatedAt: "2026-11-01T00:00:00.000Z" });

describe("InterestsCard", () => {
  it("shows count and share per interest when the active total is known", () => {
    render(<InterestsCard stats={[stat("a", 15), stat("b", 3)]} tags={tags} activeMembers={30} />);
    const table = screen.getByRole("table", { name: "Members who picked each interest" });
    expect(within(table).getByRole("columnheader", { name: "Share" })).toBeTruthy();
    const alpha = within(table).getByRole("row", { name: /Alpha/ });
    expect(alpha.textContent).toContain("15");
    expect(alpha.textContent).toContain("50%");
    expect(screen.getByRole("region", { name: "Members per interest" })).toBeTruthy();
  });

  it("falls back to relative bars without a share column when the active total is unknown", () => {
    const { container } = render(<InterestsCard stats={[stat("a", 10), stat("b", 5)]} tags={tags} activeMembers={null} />);
    expect(screen.queryByRole("columnheader", { name: "Share" })).toBeNull();
    expect(container.textContent).not.toContain("%");
    const widths = [...container.querySelectorAll<HTMLElement>(".meter > span")].map((el) => el.style.width);
    expect(widths).toEqual(["100%", "50%", "0%"]);
  });

  it("shows the empty line when no interest counts exist yet", () => {
    render(<InterestsCard stats={[]} tags={tags} activeMembers={30} />);
    expect(screen.getByText("Interest counts appear once members pick interests.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
