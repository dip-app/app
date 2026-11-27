// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Toaster, dismissAllToasts, toast, toastError } from "../Toast";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  act(() => dismissAllToasts());
  cleanup();
  vi.useRealTimers();
});

describe("Toast", () => {
  it("announces successes politely and errors as alerts", () => {
    render(<Toaster />);
    act(() => { toast("Saved."); toast("Export failed.", { tone: "error" }); });
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toContain("Saved.");
    expect(screen.getByRole("alert").textContent).toContain("Export failed.");
    expect(status.textContent).not.toContain("Export failed.");
  });

  it("dismisses itself after six seconds", () => {
    render(<Toaster />);
    act(() => { toast("Saved."); });
    act(() => { vi.advanceTimersByTime(5900); });
    expect(screen.queryByText("Saved.")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(200); });
    // Leaving: hidden from assistive tech while it fades, then removed once the exit has played.
    expect(screen.getByText("Saved.").closest(".toast-slot")?.getAttribute("data-leaving")).toBe("true");
    act(() => { vi.advanceTimersByTime(400); });
    expect(screen.queryByText("Saved.")).toBeNull();
  });

  it("pauses while hovered or focused and resumes afterwards", () => {
    render(<Toaster />);
    act(() => { toast("Saved."); });
    const item = screen.getByText("Saved.").closest(".toast")!;
    fireEvent.mouseEnter(item);
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(screen.queryByText("Saved.")).toBeTruthy();
    fireEvent.mouseLeave(item);
    act(() => { vi.advanceTimersByTime(6500); });
    expect(screen.queryByText("Saved.")).toBeNull();

    act(() => { toast("Again."); });
    const second = screen.getByText("Again.").closest(".toast")!;
    fireEvent.focus(second.querySelector("button")!);
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(screen.queryByText("Again.")).toBeTruthy();
  });

  it("runs the action once and closes the toast", () => {
    const undo = vi.fn();
    render(<Toaster />);
    act(() => { toast("Checked in.", { action: { label: "Undo", onClick: undo } }); });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(undo).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(400); });
    expect(screen.queryByText("Checked in.")).toBeNull();
  });

  it("can be dismissed by hand", () => {
    render(<Toaster />);
    act(() => { toast("Saved."); });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    act(() => { vi.advanceTimersByTime(400); });
    expect(screen.queryByText("Saved.")).toBeNull();
  });

  it("plays an exit before removal, and removes at once under reduced motion", () => {
    render(<Toaster />);
    act(() => { toast("Saved."); });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    const slot = screen.getByText("Saved.").closest(".toast-slot")!;
    expect(slot.getAttribute("data-leaving")).toBe("true");
    expect(slot.getAttribute("aria-hidden")).toBe("true");
    act(() => { vi.advanceTimersByTime(339); });
    expect(screen.queryByText("Saved.")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(2); });
    expect(screen.queryByText("Saved.")).toBeNull();

    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    try {
      act(() => { toast("Again."); });
      fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
      expect(screen.queryByText("Again.")).toBeNull();
    } finally {
      window.matchMedia = original;
    }
  });

  it("keeps error toasts until dismissed, with the error mark, and replaces a repeat instead of stacking", () => {
    render(<Toaster />);
    act(() => { toast("Export failed.", { tone: "error" }); toast("Export failed.", { tone: "error" }); });
    expect(screen.getAllByText("Export failed.")).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(60_000); });
    const item = screen.getByText("Export failed.").closest(".toast")!;
    expect(item.querySelector("svg.alert-icon")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("toastError words any thrown value in plain language", () => {
    render(<Toaster />);
    act(() => { toastError(Object.assign(new Error("Invalid request. [400]"), { code: "functions/invalid-argument" })); });
    expect(screen.getByRole("alert").textContent).toBe("DIP couldn’t accept these changes. Check them and try again; if it keeps happening, contact support.");
    act(() => { toastError(new Error("weird"), "The export didn’t finish. Try again."); });
    expect(screen.getByRole("alert").textContent).toContain("The export didn’t finish. Try again.");
  });

  it("keeps at most four toasts, newest last", () => {
    render(<Toaster />);
    act(() => { for (let i = 1; i <= 6; i += 1) toast(`Message ${i}`); });
    expect(screen.queryByText("Message 2")).toBeNull();
    expect(screen.getByText("Message 3")).toBeTruthy();
    expect(screen.getByText("Message 6")).toBeTruthy();
  });
});
