// @vitest-environment jsdom
import axe from "axe-core";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { localToIso } from "@/lib/when";
import { WhenPicker } from "../WhenPicker";

beforeAll(() => { process.env.TZ = "America/New_York"; });
afterEach(cleanup);

const NOW = new Date(2026, 10, 18, 10, 20); // Wed Nov 18 2026, 10:20 AM local
const START = localToIso("2026-11-18", 11 * 60);
const END = localToIso("2026-11-18", 12 * 60);

function setup(over: Partial<React.ComponentProps<typeof WhenPicker>> = {}) {
  const onChange = vi.fn(), onPreview = vi.fn();
  const view = render(<WhenPicker startTime={START} endTime={END} onChange={onChange} onPreview={onPreview} now={NOW} {...over} />);
  return { ...view, onChange, onPreview };
}
const day = (key: string) => document.querySelector<HTMLButtonElement>(`[data-day="${key}"]`)!;
const pointer = (target: EventTarget, type: string, x: number, y: number) =>
  act(() => { target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y })); });

describe("WhenPicker calendar", () => {
  it("is a labelled grid with the range marked selected", () => {
    setup({ startTime: localToIso("2026-11-18", 11 * 60), endTime: localToIso("2026-11-20", 12 * 60) });
    const grid = screen.getByRole("grid", { name: /november 2026/i });
    expect(within(grid).getAllByRole("columnheader")).toHaveLength(7);
    expect(within(grid).getAllByRole("columnheader")[0].getAttribute("aria-label")).toBe("Sunday");
    const selected = within(grid).getAllByRole("gridcell").filter((c) => c.getAttribute("aria-selected") === "true");
    expect(selected.map((c) => c.textContent)).toEqual(["18", "19", "20"]);
    expect(day("2026-11-18").getAttribute("aria-label")).toBe("Wednesday, November 18, 2026, today, start date");
    expect(screen.getByText(/Wed, Nov 18 to Fri, Nov 20, 3 days/)).toBeTruthy();
  });

  it("two clicks pick a range and emit once, on the second click", () => {
    const { onChange } = setup();
    fireEvent.click(day("2026-11-24"));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/Now choose the end date/)).toBeTruthy();
    fireEvent.mouseEnter(day("2026-11-26"));
    expect(day("2026-11-25").parentElement!.getAttribute("aria-selected")).toBe("true"); // hover preview
    fireEvent.click(day("2026-11-26"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(localToIso("2026-11-24", 11 * 60), localToIso("2026-11-26", 12 * 60));
  });

  it("the same day twice is a one-day event", () => {
    const { onChange } = setup();
    fireEvent.click(day("2026-11-24"));
    fireEvent.click(day("2026-11-24"));
    expect(onChange).toHaveBeenCalledWith(localToIso("2026-11-24", 11 * 60), localToIso("2026-11-24", 12 * 60));
  });

  it("dims and blocks past days on new events, but allows them when editing", () => {
    const first = setup();
    expect(day("2026-11-10").getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(day("2026-11-10"));
    fireEvent.click(day("2026-11-12"));
    expect(first.onChange).not.toHaveBeenCalled();
    cleanup();
    const second = setup({ allowPast: true });
    fireEvent.click(day("2026-11-10"));
    fireEvent.click(day("2026-11-12"));
    expect(second.onChange).toHaveBeenCalledTimes(1);
  });

  it("moves focus with the keyboard and changes month with PageDown", () => {
    setup();
    const start = day("2026-11-18");
    start.focus();
    fireEvent.keyDown(start, { key: "ArrowRight" });
    expect(document.activeElement).toBe(day("2026-11-19"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(day("2026-11-26"));
    fireEvent.keyDown(document.activeElement!, { key: "PageDown" });
    expect(screen.getByRole("grid", { name: /december 2026/i })).toBeTruthy();
    expect(document.activeElement).toBe(day("2026-12-26"));
  });

  it("navigates months and jumps back to today", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByRole("grid", { name: /december 2026/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getByRole("grid", { name: /november 2026/i })).toBeTruthy();
  });
});

describe("WhenPicker dial", () => {
  function stubRect() {
    const svg = document.querySelector("svg.when-clock")!;
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 280, height: 280, right: 280, bottom: 280, x: 0, y: 0, toJSON() {} });
  }

  it("shows the readouts, the duration and two named sliders", () => {
    setup();
    expect(screen.getByText("11:00 AM")).toBeTruthy();
    expect(screen.getByText("12:00 PM")).toBeTruthy();
    expect(document.querySelector(".centre")!.textContent).toBe("1h");
    const sliders = screen.getAllByRole("slider");
    expect(sliders.map((s) => s.getAttribute("aria-label"))).toEqual(["Start time", "End time"]);
    expect(sliders[0].getAttribute("aria-valuetext")).toBe("11:00 AM, Wed, Nov 18");
  });

  it("dragging a handle previews live and commits on release, snapped to 15 minutes", () => {
    const { onChange, onPreview } = setup();
    stubRect();
    const end = document.querySelector("[data-handle=end]")!;
    pointer(end, "pointerdown", 140, 36); // top of the dial
    pointer(window, "pointermove", 240, 141); // about 3 o'clock
    expect(onPreview).toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("3:00 PM")).toBeTruthy();
    expect(document.querySelector(".centre")!.textContent).toBe("4h");
    pointer(window, "pointerup", 240, 141);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(START, localToIso("2026-11-18", 15 * 60));
  });

  it("dragging the end past 12 flips AM/PM", () => {
    const { onChange } = setup({ startTime: localToIso("2026-11-18", 9 * 60), endTime: localToIso("2026-11-18", 11 * 60 + 30) });
    stubRect();
    pointer(document.querySelector("[data-handle=end]")!, "pointerdown", 100, 40);
    pointer(window, "pointermove", 141, 36); // 11:45 AM region
    pointer(window, "pointermove", 142, 36); // just past 12
    pointer(window, "pointerup", 142, 36);
    expect(onChange).toHaveBeenCalledWith(localToIso("2026-11-18", 9 * 60), localToIso("2026-11-18", 12 * 60));
  });

  it("keyboard on a handle changes by 15 minutes and 1 hour and announces the duration", () => {
    const { onChange } = setup();
    const end = document.querySelector<SVGElement>("[data-handle=end]")!;
    fireEvent.keyDown(end, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(START, localToIso("2026-11-18", 12 * 60 + 15));
    fireEvent.keyDown(end, { key: "PageUp" });
    expect(onChange).toHaveBeenLastCalledWith(START, localToIso("2026-11-18", 13 * 60 + 15));
    fireEvent.keyDown(end, { key: "ArrowDown" });
    expect(onChange).toHaveBeenLastCalledWith(START, localToIso("2026-11-18", 13 * 60));
    expect(screen.getByText(/Duration 2 hours/)).toBeTruthy();
  });

  it("an end before the start rolls to the next day on a default range", () => {
    const { onChange } = setup();
    const end = document.querySelector<SVGElement>("[data-handle=end]")!;
    fireEvent.keyDown(end, { key: "End" }); // 11:45 PM, later than 11:00 AM: still the same day
    expect(onChange).toHaveBeenLastCalledWith(START, localToIso("2026-11-18", 23 * 60 + 45));
    fireEvent.keyDown(end, { key: "Home" }); // 12:00 AM is before the start
    expect(onChange).toHaveBeenLastCalledWith(START, localToIso("2026-11-19", 0));
    expect(screen.getByText(/Ends the next day/)).toBeTruthy();
  });

  it("blocks an end before the start after a deliberate one-day pick", () => {
    const { onChange } = setup();
    fireEvent.click(day("2026-11-24"));
    fireEvent.click(day("2026-11-24"));
    const end = document.querySelector<SVGElement>("[data-handle=end]")!;
    fireEvent.keyDown(end, { key: "Home" });
    expect(screen.getByRole("alert").textContent).toMatch(/End has to be after the start/);
    expect(onChange).toHaveBeenLastCalledWith(localToIso("2026-11-24", 11 * 60), localToIso("2026-11-24", 11 * 60 + 15));
  });

  it("typed fields, AM/PM buttons and presets stay in sync", () => {
    const { onChange } = setup();
    const end = screen.getByLabelText("End time", { selector: "input" }) as HTMLInputElement;
    fireEvent.change(end, { target: { value: "2:45 pm" } });
    fireEvent.blur(end);
    expect(onChange).toHaveBeenLastCalledWith(START, localToIso("2026-11-18", 14 * 60 + 45));
    expect(screen.getByText("2:45 PM", { selector: "strong" })).toBeTruthy();
    fireEvent.click(within(screen.getByRole("group", { name: "Start time AM or PM" })).getByRole("button", { name: "PM" }));
    expect(onChange).toHaveBeenLastCalledWith(localToIso("2026-11-18", 23 * 60), expect.any(String));
    fireEvent.click(screen.getByRole("button", { name: /After work/ }));
    expect(onChange).toHaveBeenLastCalledWith(localToIso("2026-11-18", 17 * 60 + 30), localToIso("2026-11-18", 19 * 60 + 30));
    expect(screen.getByRole("button", { name: /After work/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("rejects an unreadable typed time without emitting", () => {
    const { onChange } = setup();
    const start = screen.getByLabelText("Start time", { selector: "input" }) as HTMLInputElement;
    fireEvent.change(start, { target: { value: "soon" } });
    fireEvent.blur(start);
    expect(onChange).not.toHaveBeenCalled();
    expect(start.value).toBe("11:00 AM");
    expect(screen.getByText(/Type a time like 6:30 PM/)).toBeTruthy();
  });

  it("shows the editor's validation messages and ties them to the fields", () => {
    setup({ endError: "End must be after start." });
    expect(screen.getByText("End must be after start.").id).toBe("end-error");
    expect(screen.getByLabelText("End time", { selector: "input" }).getAttribute("aria-describedby")).toContain("end-error");
  });

  it("is inert when the times are locked", () => {
    const { onChange } = setup({ disabled: true });
    fireEvent.click(day("2026-11-24"));
    fireEvent.click(day("2026-11-25"));
    expect((screen.getByLabelText("Start time", { selector: "input" }) as HTMLInputElement).disabled).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("follows new values from the editor", () => {
    const { rerender } = setup();
    rerender(<WhenPicker startTime={localToIso("2026-12-04", 18 * 60)} endTime={localToIso("2026-12-04", 20 * 60)} onChange={() => {}} now={NOW} />);
    expect(screen.getByText("6:00 PM")).toBeTruthy();
    expect(screen.getByRole("grid", { name: /december 2026/i })).toBeTruthy();
  });

  it("has no axe violations", async () => {
    const { container } = setup();
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });
});
