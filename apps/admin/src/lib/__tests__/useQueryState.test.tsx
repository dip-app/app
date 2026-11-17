// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A tiny router: the URL lives in a store, `replace` updates it (immediately or on demand), `useSearchParams` follows it.
const nav = vi.hoisted(() => {
  const state = { query: "", deferred: false, queue: [] as string[], replace: null as unknown as ReturnType<typeof import("vitest")["vi"]["fn"]> };
  const listeners = new Set<() => void>();
  return {
    state,
    listeners,
    set(query: string) { state.query = query; listeners.forEach((l) => l()); },
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => "/members/",
  useRouter: () => ({ replace: nav.state.replace }),
  useSearchParams: () => {
    const query = useSyncExternalStore((l) => { nav.listeners.add(l); return () => { nav.listeners.delete(l); }; }, () => nav.state.query, () => nav.state.query);
    return new URLSearchParams(query);
  },
}));

import { oneOf, useQueryState } from "../useQueryState";

const DEFAULTS = { q: "", status: "all" };

beforeEach(() => {
  nav.state.query = "";
  nav.state.deferred = false;
  nav.state.queue = [];
  nav.state.replace = vi.fn((url: string) => {
    const query = url.includes("?") ? url.split("?")[1] : "";
    if (nav.state.deferred) nav.state.queue.push(query);
    else act(() => nav.set(query));
  });
});
afterEach(cleanup);

describe("useQueryState", () => {
  it("reads values from the URL and falls back to defaults", () => {
    nav.state.query = "status=active";
    const { result } = renderHook(() => useQueryState(DEFAULTS));
    expect(result.current[0]).toEqual({ q: "", status: "active" });
  });

  it("writes changes with replace and no scroll, omitting defaults", () => {
    const { result } = renderHook(() => useQueryState(DEFAULTS));
    act(() => result.current[1]({ q: "ana" }));
    expect(nav.state.replace).toHaveBeenLastCalledWith("/members/?q=ana", { scroll: false });
    act(() => result.current[1]({ status: "active" }));
    expect(nav.state.replace).toHaveBeenLastCalledWith("/members/?q=ana&status=active", { scroll: false });
    act(() => result.current[1]({ q: "", status: "all" }));
    expect(nav.state.replace).toHaveBeenLastCalledWith("/members/", { scroll: false });
    expect(result.current[0]).toEqual(DEFAULTS);
  });

  it("keeps parameters it does not own", () => {
    nav.state.query = "id=abc";
    const { result } = renderHook(() => useQueryState({ status: "submitted" }));
    act(() => result.current[1]({ status: "approved" }));
    expect(nav.state.replace).toHaveBeenLastCalledWith("/members/?id=abc&status=approved", { scroll: false });
    act(() => result.current[1]({ status: "submitted" }));
    expect(nav.state.replace).toHaveBeenLastCalledWith("/members/?id=abc", { scroll: false });
  });

  it("restores state when the URL changes from outside (back and forward)", () => {
    const { result } = renderHook(() => useQueryState(DEFAULTS));
    act(() => result.current[1]({ q: "ana" }));
    act(() => nav.set("status=invited"));
    expect(result.current[0]).toEqual({ q: "", status: "invited" });
    act(() => nav.set(""));
    expect(result.current[0]).toEqual(DEFAULTS);
  });

  it("does not drop characters typed while the router is still catching up", () => {
    nav.state.deferred = true;
    const { result } = renderHook(() => useQueryState(DEFAULTS));
    act(() => result.current[1]({ q: "a" }));
    act(() => result.current[1]({ q: "ab" }));
    act(() => result.current[1]({ q: "abc" }));
    expect(result.current[0].q).toBe("abc");
    // The router reports the older URLs first; the field must keep what was typed.
    act(() => nav.set(nav.state.queue[0]));
    expect(result.current[0].q).toBe("abc");
    act(() => nav.set(nav.state.queue[1]));
    act(() => nav.set(nav.state.queue[2]));
    expect(result.current[0].q).toBe("abc");
    expect(nav.state.replace).toHaveBeenLastCalledWith("/members/?q=abc", { scroll: false });
  });

  it("does not call the router when nothing changes", () => {
    const { result } = renderHook(() => useQueryState(DEFAULTS));
    act(() => result.current[1]({ q: "" }));
    expect(nav.state.replace).not.toHaveBeenCalled();
  });
});

describe("oneOf", () => {
  it("keeps allowed values and replaces anything else", () => {
    expect(oneOf("past", ["upcoming", "past"] as const, "upcoming")).toBe("past");
    expect(oneOf("<script>", ["upcoming", "past"] as const, "upcoming")).toBe("upcoming");
  });
});
