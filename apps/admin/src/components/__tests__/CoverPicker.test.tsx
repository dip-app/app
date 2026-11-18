// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COVER_LIBRARY } from "@/lib/covers";
import { ApiError } from "@/lib/contract";
import { CoverPicker } from "../CoverPicker";

const pickEventCover = vi.fn();
let failWith: Error | null = null; // a plain rejection, outside the spy, so vitest does not track it
vi.mock("../AppProvider", () => ({ useApp: () => ({ api: { pickEventCover: (input: unknown) => (failWith ? Promise.reject(failWith) : pickEventCover(input)) } }) }));

beforeEach(() => { pickEventCover.mockReset(); failWith = null; });
afterEach(cleanup);

function Harness({ initial = "catalog://default/hiking", title = "Kayak day", onChange }: { initial?: string; title?: string; onChange?: (u: string) => void }) {
  const [value, setValue] = useState(initial);
  return <CoverPicker value={value} onChange={(u) => { setValue(u); onChange?.(u); }} event={{ title, tagIds: ["tag-outdoors"] }} />;
}
const tiles = () => screen.getAllByRole("radio");
const checked = () => tiles().filter((t) => t.getAttribute("aria-checked") === "true").map((t) => t.getAttribute("aria-label"));

describe("CoverPicker", () => {
  it("shows the selected cover, a radiogroup of thumbnails and one tab stop", () => {
    render(<Harness />);
    expect(screen.getByRole("radiogroup", { name: "Cover image" })).toBeTruthy();
    expect(tiles()).toHaveLength(COVER_LIBRARY.length);
    expect(checked()).toEqual(["Mountain trail hike"]);
    expect(screen.getAllByText("Mountain trail hike").length).toBeGreaterThan(0);
    expect(tiles().filter((t) => t.tabIndex === 0)).toHaveLength(1);
    const img = tiles()[0].querySelector("img")!;
    expect(img.getAttribute("loading")).toBe("eager"); // the first screenful is never left blank
    expect(img.getAttribute("decoding")).toBe("async");
    expect(img.getAttribute("src")).toContain("/img/covers/thumbs/");
  });

  it("renders the whole real library, loading only the first screenful eagerly", () => {
    render(<Harness />);
    expect(COVER_LIBRARY.length).toBeGreaterThanOrEqual(150);
    expect(tiles()).toHaveLength(COVER_LIBRARY.length);
    const loading = tiles().map((t) => t.querySelector("img")!.getAttribute("loading"));
    expect(loading.filter((l) => l === "eager")).toHaveLength(16);
    expect(loading.filter((l) => l === "lazy")).toHaveLength(COVER_LIBRARY.length - 16);
    expect(screen.getByLabelText("Search covers").getAttribute("placeholder")).toBe(`Search ${COVER_LIBRARY.length} covers`);
  });

  it("filters by search text and shows an empty state with a clear button", () => {
    render(<Harness />);
    const box = screen.getByLabelText("Search covers") as HTMLInputElement;
    fireEvent.change(box, { target: { value: "kayak" } });
    expect(tiles().map((t) => t.getAttribute("aria-label"))).toContain("Kayaking along the coast");
    expect(tiles().length).toBeLessThan(COVER_LIBRARY.length / 4);
    fireEvent.change(box, { target: { value: "zzzz" } });
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.getByText(/No covers match/).textContent).toContain("zzzz");
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(document.activeElement).toBe(box);
    expect(tiles()).toHaveLength(COVER_LIBRARY.length);
    expect(box.value).toBe("");
  });

  it("filters by theme select and shows counts", () => {
    render(<Harness />);
    const select = screen.getByLabelText("Filter by theme") as HTMLSelectElement;
    const option = (label: RegExp) => screen.getByRole("option", { name: label }) as HTMLOptionElement;
    const musicCount = COVER_LIBRARY.filter((c) => c.themes.includes("music")).length;
    expect(option(new RegExp(`^All themes \\(${COVER_LIBRARY.length}\\)`))).toBeTruthy();
    expect(option(new RegExp(`^Music \\(${musicCount}\\)`))).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search covers"), { target: { value: "kayak" } });
    expect(option(/^Music \(0\)/).disabled).toBe(true); // no match: disabled during a search
    fireEvent.change(screen.getByLabelText("Search covers"), { target: { value: "" } });
    fireEvent.change(select, { target: { value: "music" } });
    expect(tiles()).toHaveLength(musicCount);
    expect(tiles().map((t) => t.getAttribute("aria-label"))).toContain("Music and jam session");
    expect(screen.getByText(`${musicCount} of ${COVER_LIBRARY.length}`)).toBeTruthy();
    fireEvent.change(select, { target: { value: "" } });
    expect(tiles()).toHaveLength(COVER_LIBRARY.length);
  });

  it("moves and selects with arrow keys, Home and End; clicking (Enter or Space) selects a tile", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const group = screen.getByRole("radiogroup");
    const order = () => tiles().map((t) => t.getAttribute("data-url"));
    tiles().find((t) => t.getAttribute("aria-checked") === "true")!.focus();
    fireEvent.keyDown(group, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith(order()[0]);
    expect(document.activeElement).toBe(tiles()[0]);
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(order()[1]);
    fireEvent.keyDown(group, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith(order()[order().length - 1]);
    fireEvent.keyDown(group, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith(order()[order().length - 2]);
    // Enter and Space on a button fire click in browsers; the click handler selects.
    fireEvent.click(tiles()[2]);
    expect(onChange).toHaveBeenLastCalledWith(order()[2]);
    expect(checked()).toHaveLength(1);
  });

  it("lets Dipbot choose: calls the API, selects the result and says what it picked", async () => {
    pickEventCover.mockResolvedValue({ coverImageURL: "catalog://cover/theme-music", source: "dipbot", provider: "jev", alternatives: [] });
    const onChange = vi.fn();
    render(<Harness onChange={onChange} title="Jam night" />);
    fireEvent.click(screen.getByRole("button", { name: /^Let Dipbot choose/ }));
    expect(screen.getByRole("button", { name: /Dipbot is choosing/ }).getAttribute("aria-busy")).toBe("true");
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("catalog://cover/theme-music"));
    expect(pickEventCover).toHaveBeenCalledWith({ title: "Jam night", tagIds: ["tag-outdoors"] });
    await waitFor(() => expect(screen.getByText("Dipbot picked Music and jam session")).toBeTruthy());
    expect(checked()).toEqual(["Music and jam session"]);
  });

  it("shows an error inline and keeps the current cover when the pick fails", async () => {
    failWith = new Error("Dipbot is busy right now.");
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /^Let Dipbot choose/ }));
    expect((await screen.findByRole("alert")).textContent).toBe("Dipbot is busy right now.");
    expect(onChange).not.toHaveBeenCalled();
    expect(checked()).toEqual(["Mountain trail hike"]);
  });

  it("shows the credit cost on the button and the standard exhausted wording", async () => {
    failWith = new ApiError("resource-exhausted", "raw server text", {}, "AI_CREDITS_EXHAUSTED");
    render(<Harness />);
    const button = screen.getByRole("button", { name: /^Let Dipbot choose/ });
    expect(button.textContent).toContain("1 credit");
    fireEvent.click(button);
    expect((await screen.findByRole("alert")).textContent).toMatch(/used this month’s Dipbot credits\. They reset on/);
  });

  it("asks for a title before calling Dipbot", () => {
    render(<Harness title="  " />);
    fireEvent.click(screen.getByRole("button", { name: /^Let Dipbot choose/ }));
    expect(pickEventCover).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("Add a title");
  });
});
