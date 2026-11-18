// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompanyInsights } from "@/lib/adminTypes";
import { placeTooltip, stepDay, tooltipDay } from "@/lib/insights";
import { Disclosure } from "../Disclosure";
import { ActivityChart } from "../Overview";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

afterEach(cleanup);

// jsdom has no PointerEvent; give it one that carries pointerType so mouse and touch can be told apart.
if (!("PointerEvent" in window)) {
  class PointerEventShim extends MouseEvent { pointerType: string; constructor(type: string, init: MouseEventInit & { pointerType?: string } = {}) { super(type, init); this.pointerType = init.pointerType ?? ""; } }
  Object.defineProperty(window, "PointerEvent", { value: PointerEventShim, configurable: true });
}

const days = ["2025-11-09", "2025-11-10", "2025-11-11", "2025-11-12"];
const data = { activity: days.map((date, i) => ({ date, rsvps: i + 2, photos: i })), unavailable: [] } as unknown as CompanyInsights;
const chart = () => screen.getByRole("group", { name: /Activity chart/ });
const column = (i: number) => document.querySelector(`[data-col="${i}"]`) as SVGRectElement;

describe("placeTooltip", () => {
  const base = { width: 100, height: 50, boundsWidth: 400, boundsHeight: 200 };
  it("sits right of the anchor by default", () => {
    expect(placeTooltip({ ...base, anchorX: 50, anchorY: 20 })).toEqual({ left: 62, top: 20, flipped: false });
  });
  it("flips to the left near the right edge", () => {
    const p = placeTooltip({ ...base, anchorX: 380, anchorY: 20 });
    expect(p.flipped).toBe(true);
    expect(p.left).toBe(268);
    expect(p.left + base.width).toBeLessThanOrEqual(base.boundsWidth);
  });
  it("never leaves the bounds on either side or vertically", () => {
    const left = placeTooltip({ ...base, anchorX: 0, anchorY: -30 });
    expect(left.left).toBeGreaterThanOrEqual(0);
    expect(left.top).toBe(0);
    const low = placeTooltip({ ...base, anchorX: 390, anchorY: 400 });
    expect(low.top).toBe(150);
    expect(placeTooltip({ ...base, boundsWidth: 60, anchorX: 30, anchorY: 0 }).left).toBe(0);
  });
});

describe("stepDay", () => {
  it("steps, clamps, jumps and dismisses", () => {
    expect(stepDay(1, "ArrowRight", 4)).toBe(2);
    expect(stepDay(0, "ArrowLeft", 4)).toBe(0);
    expect(stepDay(3, "ArrowRight", 4)).toBe(3);
    expect(stepDay(null, "ArrowLeft", 4)).toBe(3);
    expect(stepDay(2, "Home", 4)).toBe(0);
    expect(stepDay(1, "End", 4)).toBe(3);
    expect(stepDay(1, "Escape", 4)).toBeNull();
    expect(stepDay(1, "a", 4)).toBeUndefined();
  });
});

describe("ActivityChart hover", () => {
  it("formats the date line like 'Tue, Nov 11'", () => {
    expect(tooltipDay("2025-11-11")).toBe("Tue, Nov 11");
  });

  it("shows the date and both values for the hovered day, and hides on leave", () => {
    render(<ActivityChart insights={data} />);
    expect(screen.queryByTestId("chart-tooltip")).toBeNull();
    fireEvent.pointerEnter(column(2), { pointerType: "mouse" });
    const tip = screen.getByTestId("chart-tooltip");
    expect(tip.textContent).toContain("Tue, Nov 11");
    expect(tip.textContent).toContain("RSVPs 4");
    expect(tip.textContent).toContain("Photos 2");
    fireEvent.pointerLeave(chart(), { pointerType: "mouse" });
    expect(screen.queryByTestId("chart-tooltip")).toBeNull();
  });

  it("moves between days with the arrow keys and announces them", () => {
    render(<ActivityChart insights={data} />);
    const region = chart();
    fireEvent.keyDown(region, { key: "ArrowLeft" });
    expect(screen.getByTestId("chart-tooltip").textContent).toContain("Wed, Nov 12");
    fireEvent.keyDown(region, { key: "ArrowLeft" });
    expect(screen.getByTestId("chart-tooltip").textContent).toContain("Tue, Nov 11");
    expect(screen.getByRole("status").textContent).toBe("Tue, Nov 11: 4 RSVPs, 2 photos");
    fireEvent.keyDown(region, { key: "Home" });
    expect(screen.getByTestId("chart-tooltip").textContent).toContain("Sun, Nov 9");
    fireEvent.keyDown(region, { key: "Escape" });
    expect(screen.queryByTestId("chart-tooltip")).toBeNull();
  });

  it("is a focusable region", () => {
    render(<ActivityChart insights={data} />);
    expect(chart().getAttribute("tabindex")).toBe("0");
  });

  it("shows on tap and dismisses when tapping elsewhere", () => {
    render(<ActivityChart insights={data} />);
    fireEvent.pointerDown(column(1), { pointerType: "touch" });
    expect(screen.getByTestId("chart-tooltip").textContent).toContain("Mon, Nov 10");
    fireEvent.pointerDown(document.body, { pointerType: "touch" });
    expect(screen.queryByTestId("chart-tooltip")).toBeNull();
  });
});

describe("Disclosure", () => {
  it("toggles a named panel with aria-expanded and a chevron", () => {
    render(<Disclosure summary="View as table"><p>rows</p></Disclosure>);
    const button = screen.getByRole("button", { name: "View as table" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    const panel = () => document.getElementById(button.getAttribute("aria-controls") as string) as HTMLElement;
    expect(panel().hasAttribute("hidden")).toBe(true);
    expect(button.querySelector("svg")).not.toBeNull();
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(button.parentElement?.classList.contains("open")).toBe(true);
    expect(panel().hasAttribute("hidden")).toBe(false);
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });
});
