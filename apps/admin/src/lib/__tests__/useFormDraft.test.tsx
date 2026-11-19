// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DRAFT_DEBOUNCE_MS, DRAFT_TTL_MS, type DraftStore, draftKey, readDraft, writeDraft } from "../formDraft";
import { useFormDraft } from "../useFormDraft";

interface V { text: string }
const scope = { uid: "u1", companyId: "c1" };
const key = draftKey("event", scope);
const parse = (raw: unknown): V | null => (raw && typeof (raw as V).text === "string" ? (raw as V) : null);

function memory(): DraftStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, String(v)); }, removeItem: (k) => { data.delete(k); } };
}

let clockNow = 1_000_000;
function setup(store: DraftStore | null, initial: Partial<{ value: V; touched: boolean; meaningful: boolean; enabled: boolean }> = {}) {
  return renderHook((props: { value: V; touched: boolean; meaningful: boolean; enabled: boolean }) =>
    useFormDraft<V>({ kind: "event", scope, enabled: props.enabled, value: props.value, touched: props.touched, meaningful: props.meaningful, parse, store, now: () => clockNow }),
  { initialProps: { value: { text: "" }, touched: false, meaningful: false, enabled: true, ...initial } });
}

beforeEach(() => { vi.useFakeTimers(); clockNow = 1_000_000; });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("useFormDraft", () => {
  it("writes once, ~800 ms after the last change", () => {
    const store = memory();
    const spy = vi.spyOn(store, "setItem");
    const { rerender, result } = setup(store);
    rerender({ value: { text: "a" }, touched: true, meaningful: true, enabled: true });
    act(() => { vi.advanceTimersByTime(DRAFT_DEBOUNCE_MS - 100); });
    rerender({ value: { text: "ab" }, touched: true, meaningful: true, enabled: true });
    act(() => { vi.advanceTimersByTime(DRAFT_DEBOUNCE_MS - 100); });
    expect(spy).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(200); });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(readDraft(store, key, parse, clockNow)?.data).toEqual({ text: "ab" });
    expect(result.current.status).toBe("saved");
  });

  it("never writes an untouched or empty form", () => {
    const store = memory();
    const { rerender } = setup(store);
    rerender({ value: { text: "defaults" }, touched: false, meaningful: true, enabled: true });
    act(() => { vi.advanceTimersByTime(5000); });
    rerender({ value: { text: "" }, touched: true, meaningful: false, enabled: true });
    act(() => { vi.advanceTimersByTime(5000); });
    expect(store.data.size).toBe(0);
  });

  it("removes the draft the form wrote once everything is emptied again", () => {
    const store = memory();
    const { rerender, result } = setup(store);
    rerender({ value: { text: "a" }, touched: true, meaningful: true, enabled: true });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(store.data.size).toBe(1);
    rerender({ value: { text: "" }, touched: true, meaningful: false, enabled: true });
    expect(store.data.size).toBe(0);
    expect(result.current.status).toBe("idle");
  });

  it("writes a waiting change when the tab is hidden or closed, and on unmount", () => {
    const store = memory();
    const { rerender, unmount } = setup(store);
    rerender({ value: { text: "a" }, touched: true, meaningful: true, enabled: true });
    act(() => { window.dispatchEvent(new Event("pagehide")); });
    expect(readDraft(store, key, parse, clockNow)?.data.text).toBe("a");
    rerender({ value: { text: "ab" }, touched: true, meaningful: true, enabled: true });
    unmount();
    expect(readDraft(store, key, parse, clockNow)?.data.text).toBe("ab");
  });

  it("offers an earlier draft, and leaves it alone until answered", () => {
    const store = memory();
    writeDraft(store, key, { text: "old" }, clockNow - 60_000);
    const { result, rerender } = setup(store);
    expect(result.current.offer?.data).toEqual({ text: "old" });
    expect(result.current.offer?.savedAt).toBe(clockNow - 60_000);
    // Not editing yet and leaving: nothing changes.
    rerender({ value: { text: "" }, touched: false, meaningful: false, enabled: true });
    act(() => { vi.advanceTimersByTime(5000); });
    expect(readDraft(store, key, parse, clockNow)?.data.text).toBe("old");
    let taken: ReturnType<typeof result.current.acceptOffer> = null;
    act(() => { taken = result.current.acceptOffer(); });
    expect(taken).toMatchObject({ data: { text: "old" } });
    expect(result.current.offer).toBeNull();
  });

  it("start fresh deletes the earlier draft, but not one the form has since rewritten", () => {
    const store = memory();
    writeDraft(store, key, { text: "old" }, clockNow);
    const a = setup(store);
    act(() => { a.result.current.declineOffer(); });
    expect(store.data.size).toBe(0);
    a.unmount();

    writeDraft(store, key, { text: "old" }, clockNow);
    const b = setup(store);
    b.rerender({ value: { text: "new" }, touched: true, meaningful: true, enabled: true });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(b.result.current.offer).not.toBeNull(); // the banner stays until answered
    act(() => { b.result.current.declineOffer(); });
    expect(readDraft(store, key, parse, clockNow)?.data.text).toBe("new");
  });

  it("ignores an expired draft", () => {
    const store = memory();
    writeDraft(store, key, { text: "old" }, clockNow - DRAFT_TTL_MS - 5);
    expect(setup(store).result.current.offer).toBeNull();
    expect(store.data.size).toBe(0);
  });

  it("clear deletes the draft and stops further saving (after publish)", () => {
    const store = memory();
    const { rerender, result } = setup(store);
    rerender({ value: { text: "a" }, touched: true, meaningful: true, enabled: true });
    act(() => { vi.advanceTimersByTime(1000); });
    act(() => { result.current.clear(); });
    expect(store.data.size).toBe(0);
    rerender({ value: { text: "ab" }, touched: true, meaningful: true, enabled: true });
    act(() => { vi.advanceTimersByTime(2000); window.dispatchEvent(new Event("pagehide")); });
    expect(store.data.size).toBe(0);
  });

  it("leaving with keepOffer does not delete an earlier draft that was never answered", () => {
    const store = memory();
    writeDraft(store, key, { text: "old" }, clockNow);
    const { result } = setup(store);
    act(() => { result.current.clear({ keepOffer: true }); });
    expect(store.data.size).toBe(1);
  });

  it("falls back gracefully when storage is unavailable, and asks before the page is left", () => {
    const full: DraftStore = { getItem: () => null, removeItem: () => {}, setItem: () => { throw new DOMException("full", "QuotaExceededError"); } };
    const { rerender, result } = setup(full);
    rerender({ value: { text: "a" }, touched: true, meaningful: true, enabled: true });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current.status).toBe("unavailable");
    expect(result.current.unsaved).toBe(true);
    const none = setup(null);
    none.rerender({ value: { text: "a" }, touched: true, meaningful: true, enabled: true });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(none.result.current.status).toBe("unavailable");
  });

  it("reports a draft that outgrew the size cap", () => {
    const store = memory();
    const { rerender, result } = setup(store);
    rerender({ value: { text: "x".repeat(70_000) }, touched: true, meaningful: true, enabled: true });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current.status).toBe("too-large");
    expect(result.current.unsaved).toBe(true);
  });

  it("does nothing for a form that edits a saved record", () => {
    const store = memory();
    writeDraft(store, key, { text: "old" }, clockNow);
    const { rerender, result } = setup(store, { enabled: false });
    rerender({ value: { text: "a" }, touched: true, meaningful: true, enabled: false });
    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current.offer).toBeNull();
    expect(readDraft(store, key, parse, clockNow)?.data.text).toBe("old");
  });

  it("another tab: shows its draft as an offer when untouched; marks the change when this tab has edits; follows its clear", () => {
    const store = memory();
    const view = setup(store);
    act(() => {
      writeDraft(store, key, { text: "from tab two" }, clockNow);
      window.dispatchEvent(new StorageEvent("storage", { key, newValue: "x" }));
    });
    expect(view.result.current.offer?.data.text).toBe("from tab two");
    act(() => { window.dispatchEvent(new StorageEvent("storage", { key, newValue: null })); });
    expect(view.result.current.offer).toBeNull();

    view.rerender({ value: { text: "mine" }, touched: true, meaningful: true, enabled: true });
    act(() => { vi.advanceTimersByTime(1000); });
    act(() => { window.dispatchEvent(new StorageEvent("storage", { key, newValue: "x" })); });
    expect(view.result.current.status).toBe("other-tab");
    expect(view.result.current.offer).toBeNull();
    // Last write wins: the next change here saves over it.
    view.rerender({ value: { text: "mine!" }, touched: true, meaningful: true, enabled: true });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(view.result.current.status).toBe("saved");
    expect(readDraft(store, key, parse, clockNow)?.data.text).toBe("mine!");
    // An event for another key is ignored.
    act(() => { window.dispatchEvent(new StorageEvent("storage", { key: "something-else", newValue: "x" })); });
    expect(view.result.current.status).toBe("saved");
  });
});
