// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TagStat } from "@/lib/tagStats";
import { InterestsCard } from "../Overview";
import { stubLocalStorage } from "./storageStub";

const tags = [{ id: "a", name: "Fitness" }, { id: "b", name: "Cooking" }, { id: "c", name: "Zzz Unknown Thing" }];
const stat = (tagId: string, memberCount: number): TagStat => ({ tagId, memberCount, updatedAt: "2026-11-01T00:00:00.000Z" });

let storage: Storage;
beforeEach(() => { storage = stubLocalStorage(); });
afterEach(cleanup);

describe("Interests grid (default view)", () => {
  it("shows image-led cards with name, blurb, count, share and a bar, most members first", () => {
    const { container } = render(<InterestsCard stats={[stat("a", 15), stat("b", 3)]} tags={tags} activeMembers={30} />);
    const list = screen.getByRole("list", { name: "Members per interest" });
    const cards = within(list).getAllByRole("listitem");
    expect(cards).toHaveLength(3);
    expect(cards[0].querySelector(".tag-card-name")!.textContent).toBe("Fitness");
    expect(cards[0].querySelector(".tag-card-blurb")!.textContent!.length).toBeGreaterThan(3);
    expect(cards[0].querySelector(".tag-card-meta")!.textContent).toBe("15 members · 50%");
    expect(cards[1].querySelector(".tag-card-meta")!.textContent).toBe("3 members · 10%");
    expect(cards[0].querySelector(".tag-card-art img")).not.toBeNull();
    expect((cards[0].querySelector(".tag-card-bar > span") as HTMLElement).style.width).toBe("50%");
    expect(container.querySelector("table")).toBeNull();
  });

  it("without the active total the share is left out and bars are relative", () => {
    const { container } = render(<InterestsCard stats={[stat("a", 10), stat("b", 5)]} tags={tags} activeMembers={null} />);
    expect(container.textContent).not.toContain("%");
    expect([...container.querySelectorAll<HTMLElement>(".tag-card-bar > span")].map((el) => el.style.width)).toEqual(["100%", "50%", "0%"]);
  });

  it("the switch has two labelled icon buttons, toggles the view and remembers it", () => {
    const { container, unmount } = render(<InterestsCard stats={[stat("a", 15)]} tags={tags} activeMembers={30} />);
    const group = screen.getByRole("group", { name: "Interests layout" });
    const grid = within(group).getByRole("button", { name: "Grid view" });
    const list = within(group).getByRole("button", { name: "List view" });
    expect(grid.getAttribute("title")).toBe("Grid view");
    expect(grid.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(list);
    expect(list.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector("table.interest-table")).not.toBeNull();
    expect(storage.getItem("dip.admin.interestsView")).toBe("list");
    unmount();
    render(<InterestsCard stats={[stat("a", 15)]} tags={tags} activeMembers={30} />);
    expect(document.querySelector("table.interest-table")).not.toBeNull(); // next visit starts in the saved view
  });

  it("hides the switch when there is nothing to show", () => {
    render(<InterestsCard stats={[]} tags={tags} activeMembers={30} />);
    expect(screen.queryByRole("group", { name: "Interests layout" })).toBeNull();
  });
});
