// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { KeyboardShortcuts } from "../KeyboardShortcuts";
import { SHORTCUTS_STORAGE, isGoPending, setShortcutsEnabled, useShortcutsEnabled } from "@/lib/shortcuts";
import { stubLocalStorage } from "./storageStub";
import { ignoredKey } from "@/lib/shortcuts";
import { useSlashFocus } from "@/lib/useSlashFocus";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute("open"); };
});
const pages = [{ href: "/events/", label: "Events" }, { href: "/members/", label: "Members" }];
const press = (key: string, init: KeyboardEventInit = {}, target: Window | Element = window) => act(() => { fireEvent.keyDown(target, { key, ...init }); });

beforeEach(() => { push.mockReset(); vi.useFakeTimers(); stubLocalStorage(); act(() => setShortcutsEnabled(true)); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("keyboard shortcuts", () => {
  it("g then a letter goes to that page; an unknown letter or a pause does nothing", () => {
    render(<KeyboardShortcuts pages={pages} />);
    press("g");
    expect(screen.getByRole("status").textContent).toBe("Go to: press a letter");
    press("e");
    expect(push).toHaveBeenCalledWith("/events/");
    press("g"); press("x");
    press("g");
    act(() => { vi.advanceTimersByTime(1600); });
    press("m");
    expect(push).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("one setting for every single-key shortcut: switching it in the list applies to page shortcuts at once", () => {
    function ReviewQueueSwitch() { const [on] = useShortcutsEnabled(); return <p data-testid="queue">{on ? "on" : "off"}</p>; }
    render(<><ReviewQueueSwitch /><KeyboardShortcuts pages={pages} /></>);
    expect(screen.getByTestId("queue").textContent).toBe("on");
    press("?");
    fireEvent.click(screen.getByRole("switch", { name: /Single-key shortcuts/ }));
    expect(screen.getByTestId("queue").textContent).toBe("off");
  });

  it("while g waits for its letter, page shortcuts know to ignore the next key; Caps Lock still works; IME composition is ignored", () => {
    render(<KeyboardShortcuts pages={pages} />);
    press("G");
    expect(isGoPending()).toBe(true);
    press("m");
    expect(push).toHaveBeenCalledWith("/members/");
    expect(isGoPending()).toBe(false);
    press("g", { isComposing: true });
    expect(isGoPending()).toBe(false);
  });

  it("the letter after g is used up even when it goes nowhere, so a page shortcut registered later never sees it", () => {
    render(<KeyboardShortcuts pages={pages} />);
    const seen: string[] = [];
    const queue = (event: KeyboardEvent) => { if (!ignoredKey(event)) seen.push(event.key); };
    window.addEventListener("keydown", queue);
    try {
      press("g"); press("a");
      expect(push).not.toHaveBeenCalled();
      expect(seen).toEqual([]);
      press("a");
      expect(seen).toEqual(["a"]);
    } finally { window.removeEventListener("keydown", queue); }
  });

  it("does nothing while the phone menu is open, and / is switched off with the others", () => {
    function Search() { useSlashFocus("q"); return <input id="q" aria-label="Query" />; }
    const { container } = render(<div className="app" data-nav-open="true"><Search /><KeyboardShortcuts pages={pages} /></div>);
    press("?");
    expect(screen.queryByRole("dialog")).toBeNull();
    container.firstElementChild!.removeAttribute("data-nav-open");
    act(() => setShortcutsEnabled(false));
    press("/");
    expect(document.activeElement).not.toBe(screen.getByLabelText("Query"));
    act(() => setShortcutsEnabled(true));
    press("/");
    expect(document.activeElement).toBe(screen.getByLabelText("Query"));
  });

  it("never fires while typing in a field", () => {
    render(<><input aria-label="Search" /><KeyboardShortcuts pages={pages} /></>);
    const input = screen.getByLabelText("Search");
    press("g", {}, input); press("e", {}, input); press("?", {}, input);
    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("? lists the shortcuts for the pages the role can open; turning them off keeps Ctrl+/ working", () => {
    render(<KeyboardShortcuts pages={pages} />);
    press("?");
    const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    expect(dialog.textContent).toContain("Go to Events");
    expect(dialog.textContent).toContain("Go to Members");
    expect(dialog.textContent).not.toContain("Audit log");
    fireEvent.click(screen.getByRole("switch", { name: /Single-key shortcuts/ }));
    expect(window.localStorage.getItem(SHORTCUTS_STORAGE)).toBe("off");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    press("g"); press("e"); press("?");
    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    press("/", { ctrlKey: true });
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeTruthy();
  });
});
