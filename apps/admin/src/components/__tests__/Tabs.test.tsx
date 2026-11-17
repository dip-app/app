// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Tabs, tabPanelProps } from "../Tabs";

afterEach(cleanup);

const ITEMS = [
  { id: "upcoming", label: "Upcoming", count: 3 },
  { id: "past", label: "Past", count: 0 },
  { id: "cancelled", label: "Canceled" },
];

function Harness({ initial = "upcoming", onChange }: { initial?: string; onChange?: (id: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <Tabs idBase="t" label="Filter events" items={ITEMS} value={value} onChange={(id) => { setValue(id); onChange?.(id); }} />
      <div {...tabPanelProps("t", value)}>panel</div>
    </>
  );
}

describe("Tabs", () => {
  it("exposes a tablist with one selected tab and a roving tab stop", () => {
    render(<Harness />);
    expect(screen.getByRole("tablist", { name: "Filter events" })).toBeTruthy();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
    expect(tabs.map((t) => t.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);
    expect(tabs[0].textContent).toBe("Upcoming (3)");
    expect(tabs[2].textContent).toBe("Canceled");
  });

  it("links the selected tab to its panel", () => {
    render(<Harness />);
    const panel = screen.getByRole("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe("t-tab-upcoming");
    expect(screen.getAllByRole("tab")[0].getAttribute("aria-controls")).toBe(panel.id);
  });

  it("moves and selects with the arrow keys, wrapping at both ends", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const [first, second, third] = screen.getAllByRole("tab");
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("past");
    expect(document.activeElement).toBe(second);
    expect(second.getAttribute("tabindex")).toBe("0");
    expect(first.getAttribute("tabindex")).toBe("-1");

    fireEvent.keyDown(second, { key: "ArrowLeft" });
    fireEvent.keyDown(first, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("cancelled");
    expect(document.activeElement).toBe(third);

    fireEvent.keyDown(third, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("upcoming");
  });

  it("jumps with Home and End", () => {
    render(<Harness initial="past" />);
    const tabs = screen.getAllByRole("tab");
    tabs[1].focus();
    fireEvent.keyDown(tabs[1], { key: "End" });
    expect(tabs[2].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tabs[2], { key: "Home" });
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tabs[0]);
  });

  it("selects on click and ignores unrelated keys", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole("tab", { name: "Past (0)" }));
    expect(onChange).toHaveBeenCalledWith("past");
    onChange.mockClear();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Past (0)" }), { key: "a" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("falls back to the first tab when the value is unknown", () => {
    render(<Harness initial="nope" />);
    expect(screen.getAllByRole("tab")[0].getAttribute("aria-selected")).toBe("true");
  });
});
