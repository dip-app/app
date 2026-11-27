// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/contract";
import { Dialog } from "../Dialog";

// jsdom has <dialog> but not showModal/close.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute("open"); };
});
afterEach(cleanup);

const confirmButton = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;

describe("Dialog", () => {
  it("opens modally and names itself", () => {
    render(<Dialog title="Remove Sam?" confirmLabel="Remove" onConfirm={async () => {}} onClose={() => {}}><p>Body text</p></Dialog>);
    const dialog = screen.getByRole("dialog", { name: "Remove Sam?" });
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(dialog.getAttribute("aria-describedby")).toBeTruthy();
  });

  it("keeps confirm disabled until a reason of three characters is typed", () => {
    const onConfirm = vi.fn(async () => {});
    render(<Dialog title="Why?" confirmLabel="Confirm" reasonLabel="Reason" onConfirm={onConfirm} onClose={() => {}} />);
    const confirm = confirmButton("Confirm");
    expect(confirm.disabled).toBe(true);
    const box = screen.getByLabelText("Reason (required)");
    fireEvent.change(box, { target: { value: "ab" } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(box, { target: { value: "  ok! " } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith("ok!");
  });

  it("starts on Cancel for dangerous actions so a stray Enter cannot confirm", () => {
    render(<Dialog danger title="Delete?" confirmLabel="Delete" onConfirm={async () => {}} onClose={() => {}} />);
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
  });

  it("does not move focus to Cancel for ordinary dialogs", () => {
    render(<Dialog title="Save?" confirmLabel="Save" onConfirm={async () => {}} onClose={() => {}} />);
    expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "Cancel" }));
  });

  it("shows the busy label while working and the error if it fails", async () => {
    let fail: (reason: Error) => void = () => {};
    const onConfirm = () => new Promise<void>((_, reject) => { fail = reject; });
    render(<Dialog title="Go" confirmLabel="Apply" busyLabel="Applying…" onConfirm={onConfirm} onClose={() => {}} />);
    fireEvent.click(confirmButton("Apply"));
    // Busy: a spinner and the busy name; both buttons keep focus (not disabled) but ignore presses.
    const busy = confirmButton("Applying…");
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(busy.disabled).toBe(false);
    expect(busy.querySelector(".btn-spin")).toBeTruthy();
    const cancel = screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement;
    expect(cancel.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(cancel);
    fireEvent.click(busy);
    await act(async () => { fail(new ApiError("failed-precondition", "Nope, try again.")); });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Nope, try again."));
    expect(confirmButton("Apply").disabled).toBe(false);
  });

  it("never shows the SDK's raw text: a status-0 callable failure reads as a connection problem", async () => {
    const sdkError = Object.assign(new Error("internal [0]"), { code: "functions/internal" });
    render(<Dialog title="Go" confirmLabel="Apply" onConfirm={() => Promise.reject(sdkError)} onClose={() => {}} />);
    fireEvent.click(confirmButton("Apply"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Can’t reach DIP. Check your connection and try again."));
    expect(screen.getByRole("alert").textContent).not.toMatch(/\[0\]|internal/);
  });

  it("honors confirmDisabled and closes through Cancel", () => {
    const onClose = vi.fn();
    render(<Dialog title="Number" confirmLabel="Apply" confirmDisabled onConfirm={async () => {}} onClose={onClose} />);
    expect(confirmButton("Apply").disabled).toBe(true);
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      // The exit plays first: the dialog is marked closing and the parent is told once it ends.
      expect(screen.getByRole("dialog").getAttribute("data-closing")).toBe("true");
      expect(onClose).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      act(() => { vi.advanceTimersByTime(140); });
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes at once under reduced motion", () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    try {
      const onClose = vi.fn();
      render(<Dialog title="Number" confirmLabel="Apply" onConfirm={async () => {}} onClose={onClose} />);
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      window.matchMedia = original;
    }
  });
});
