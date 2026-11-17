// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Toaster, dismissAllToasts, toast } from "../Toast";

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
    act(() => { vi.advanceTimersByTime(6100); });
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
    expect(screen.queryByText("Checked in.")).toBeNull();
  });

  it("can be dismissed by hand", () => {
    render(<Toaster />);
    act(() => { toast("Saved."); });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    expect(screen.queryByText("Saved.")).toBeNull();
  });

  it("keeps at most four toasts, newest last", () => {
    render(<Toaster />);
    act(() => { for (let i = 1; i <= 6; i += 1) toast(`Message ${i}`); });
    expect(screen.queryByText("Message 2")).toBeNull();
    expect(screen.getByText("Message 3")).toBeTruthy();
    expect(screen.getByText("Message 6")).toBeTruthy();
  });
});
