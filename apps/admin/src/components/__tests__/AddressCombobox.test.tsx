// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type LocationProvider, LocationError, type PlaceSuggestion, type ResolvedPlace } from "@/lib/location/types";
import { AddressCombobox, DEBOUNCE_MS, MAX_RESULTS } from "../AddressCombobox";

const sug = (n: number): PlaceSuggestion => ({ placeId: `p${n}`, primary: `Forbes Place ${n}`, secondary: "Pittsburgh, PA", isPlace: false });
const resolved = (id: string): ResolvedPlace => ({ placeId: id, name: null, address: `${id} Forbes Ave`, locality: "Pittsburgh, PA", latitude: 40.4, longitude: -79.9, kind: "other", setting: "unknown" });

type Call = { input: string; sessionToken: string; signal?: AbortSignal; resolve: (v: PlaceSuggestion[]) => void; reject: (e: unknown) => void };
function makeProvider() {
  const calls: Call[] = [];
  const resolveCalls: Array<{ placeId?: string; sessionToken?: string }> = [];
  const provider: LocationProvider = {
    name: "callable",
    autocomplete: (input, options) => new Promise((resolve, reject) => { calls.push({ input, sessionToken: options.sessionToken, signal: options.signal, resolve, reject }); }),
    resolve: async (request) => { resolveCalls.push(request as { placeId?: string }); return "placeId" in request ? resolved(request.placeId) : null; },
  };
  return { provider, calls, resolveCalls };
}

function Harness({ provider, onPick, onUnavailable }: { provider: LocationProvider; onPick?: (p: ResolvedPlace, s: PlaceSuggestion) => void; onUnavailable?: () => void }) {
  const [value, setValue] = useState("");
  return <AddressCombobox id="addr" label="Street address" value={value} provider={provider} onChange={setValue} onUnavailable={onUnavailable} onPick={(p, s) => { setValue(p.address); onPick?.(p, s); }} />;
}

const input = () => screen.getByRole("combobox", { name: "Street address" }) as HTMLInputElement;
const type = (text: string) => { fireEvent.focus(input()); fireEvent.change(input(), { target: { value: text } }); };
const settle = async (ms = DEBOUNCE_MS) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const answer = async (call: Call, results: PlaceSuggestion[]) => { await act(async () => { call.resolve(results); await Promise.resolve(); }); };
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("AddressCombobox", () => {
  it("exposes the ARIA 1.2 combobox pattern", async () => {
    const { provider, calls } = makeProvider();
    render(<Harness provider={provider} />);
    expect(input().getAttribute("aria-autocomplete")).toBe("list");
    expect(input().getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById(input().getAttribute("aria-controls")!)?.getAttribute("role")).toBe("listbox");
    type("forb");
    await settle();
    await answer(calls[0], [sug(1), sug(2)]);
    expect(input().getAttribute("aria-expanded")).toBe("true");
    const options = screen.getAllByRole("option");
    expect(input().getAttribute("aria-activedescendant")).toBeNull();
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(input().getAttribute("aria-activedescendant")).toBe(options[0].id);
    expect(options[0].getAttribute("aria-selected")).toBe("true");
    expect(options[1].getAttribute("aria-selected")).toBe("false");
  });

  it("searches only from 3 characters and after a 300 ms pause, once for a burst of typing", async () => {
    const { provider, calls } = makeProvider();
    render(<Harness provider={provider} />);
    type("fo");
    await settle(1000);
    expect(calls).toHaveLength(0);
    type("for");
    await settle(DEBOUNCE_MS - 50);
    type("forb");
    await settle(DEBOUNCE_MS - 50);
    expect(calls).toHaveLength(0);
    await settle(60);
    expect(calls).toHaveLength(1);
    expect(calls[0].input).toBe("forb");
    expect(DEBOUNCE_MS).toBe(300);
  });

  it("ignores a stale answer (callables cannot be cancelled) and aborts on change and unmount", async () => {
    const { provider, calls } = makeProvider();
    const view = render(<Harness provider={provider} />);
    type("forb");
    await settle();
    type("forbes");
    expect(calls[0].signal?.aborted).toBe(true);
    await settle();
    await answer(calls[0], [sug(9)]); // late answer for "forb"
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    await answer(calls[1], [sug(1)]);
    expect(screen.getAllByRole("option")).toHaveLength(1);
    type("forbes a");
    await settle();
    view.unmount();
    expect(calls[2].signal?.aborted).toBe(true);
  });

  it("uses one session token while typing, and a new one after a pick", async () => {
    const { provider, calls, resolveCalls } = makeProvider();
    render(<Harness provider={provider} />);
    type("forb");
    await settle();
    type("forbe");
    await settle();
    expect(calls[1].sessionToken).toBe(calls[0].sessionToken);
    await answer(calls[1], [sug(1)]);
    fireEvent.click(screen.getByRole("option"));
    await flush();
    expect(resolveCalls[0]).toEqual({ placeId: "p1", sessionToken: calls[0].sessionToken }); // the resolve ends the session
    type("forbes");
    await settle();
    expect(calls[2].sessionToken).not.toBe(calls[0].sessionToken);
  });

  it("starts a new session after the field is cleared or abandoned", async () => {
    const { provider, calls } = makeProvider();
    render(<Harness provider={provider} />);
    type("forb");
    await settle();
    const first = calls[0].sessionToken;
    fireEvent.blur(input());
    type("forbe");
    await settle();
    const second = calls[1].sessionToken;
    expect(second).not.toBe(first);
    type("");
    type("forbes");
    await settle();
    expect(calls[2].sessionToken).not.toBe(second);
  });

  it("shows at most 5 results with a pin, a highlighted primary line, a secondary line and the Google Maps attribution", async () => {
    const { provider, calls } = makeProvider();
    const { container } = render(<Harness provider={provider} />);
    type("forbes");
    await settle();
    await answer(calls[0], Array.from({ length: 9 }, (_, i) => sug(i + 1)));
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(MAX_RESULTS);
    expect(MAX_RESULTS).toBe(5);
    expect(options[0].querySelector("svg.ac-pin")).not.toBeNull();
    expect(options[0].querySelector("mark")?.textContent).toBe("Forbes");
    expect(options[0].querySelector(".ac-secondary")?.textContent).toBe("Pittsburgh, PA");
    const credit = container.querySelector(".ac-credit")!;
    expect(credit.textContent).toBe("Google Maps");
    expect(credit.getAttribute("translate")).toBe("no");
    expect(container.textContent).not.toMatch(/Geoapify|OpenStreetMap/);
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });

  it("moves with Arrow Up and Down (wrapping), picks with Enter, resolves, then closes without searching again", async () => {
    const { provider, calls } = makeProvider();
    const picked = vi.fn();
    render(<Harness provider={provider} onPick={picked} />);
    type("forb");
    await settle();
    await answer(calls[0], [sug(1), sug(2), sug(3)]);
    const options = screen.getAllByRole("option");
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    expect(input().getAttribute("aria-activedescendant")).toBe(options[2].id);
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(input().getAttribute("aria-activedescendant")).toBe(options[0].id);
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "Enter" });
    await flush();
    expect(picked).toHaveBeenCalledTimes(1);
    expect(picked.mock.calls[0][0].placeId).toBe("p2");
    expect(picked.mock.calls[0][1].primary).toBe("Forbes Place 2");
    expect(input().value).toBe("p2 Forbes Ave");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    await settle(1000);
    expect(calls).toHaveLength(1);
  });

  it("Enter with nothing active does not submit the form; a click picks", async () => {
    const { provider, calls } = makeProvider();
    const picked = vi.fn();
    render(<form onSubmit={(e) => e.preventDefault()}><Harness provider={provider} onPick={picked} /></form>);
    type("forb");
    await settle();
    await answer(calls[0], [sug(1), sug(2)]);
    expect(fireEvent.keyDown(input(), { key: "Enter" })).toBe(false);
    expect(picked).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("option")[1]);
    await flush();
    expect(picked.mock.calls[0][0].placeId).toBe("p2");
  });

  it("Escape closes the list; a second Escape changes nothing and keeps the text", async () => {
    const { provider, calls } = makeProvider();
    render(<Harness provider={provider} />);
    type("forb");
    await settle();
    await answer(calls[0], [sug(1)]);
    expect(fireEvent.keyDown(input(), { key: "Escape" })).toBe(false);
    expect(input().getAttribute("aria-expanded")).toBe("false");
    expect(fireEvent.keyDown(input(), { key: "Escape" })).toBe(true);
    expect(input().value).toBe("forb");
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(input().getAttribute("aria-expanded")).toBe("true");
  });

  it("Tab leaves without picking and closes the list", async () => {
    const { provider, calls } = makeProvider();
    const picked = vi.fn();
    render(<Harness provider={provider} onPick={picked} />);
    type("forb");
    await settle();
    await answer(calls[0], [sug(1)]);
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(fireEvent.keyDown(input(), { key: "Tab" })).toBe(true);
    fireEvent.blur(input());
    expect(input().getAttribute("aria-expanded")).toBe("false");
    expect(picked).not.toHaveBeenCalled();
    expect(input().value).toBe("forb");
  });

  it("shows loading, empty, error and limit states, and keeps typing possible", async () => {
    const { provider, calls } = makeProvider();
    render(<Harness provider={provider} />);
    type("forb");
    await settle();
    expect(screen.getAllByText("Searching…").length).toBeGreaterThan(0);
    await answer(calls[0], []);
    expect(screen.getAllByText("No matches. Keep typing or enter the address yourself.").length).toBeGreaterThan(0);
    type("forbes");
    await settle();
    await act(async () => { calls[1].reject(new LocationError("failed")); await Promise.resolve(); });
    expect(screen.getAllByText(/Address search isn’t available right now/).length).toBeGreaterThan(0);
    type("forbes a");
    await settle();
    await act(async () => { calls[2].reject(new LocationError("limit")); await Promise.resolve(); });
    expect(screen.getAllByText("Address search is resting for today. Type the address instead.").length).toBeGreaterThan(0);
    expect(input().value).toBe("forbes a");
  });

  it("tells the parent when Places is off (so it can show plain fields)", async () => {
    const { provider, calls } = makeProvider();
    const off = vi.fn();
    render(<Harness provider={provider} onUnavailable={off} />);
    type("forb");
    await settle();
    await act(async () => { calls[0].reject(new LocationError("disabled")); await Promise.resolve(); });
    expect(off).toHaveBeenCalledTimes(1);
  });

  it("never submits the surrounding form on Enter while the popup shows no matches", async () => {
    const { provider, calls } = makeProvider();
    const submitted = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(<form onSubmit={submitted}><Harness provider={provider} /><button type="submit">Save</button></form>);
    type("600 grant");
    await settle();
    await answer(calls[0], []);
    const enter = fireEvent.keyDown(input(), { key: "Enter" });
    expect(enter).toBe(false); // default prevented: no implicit submit
  });

  it("pick-only mode (the office) asks for a pick on no matches and blocks Enter even when closed", async () => {
    const { provider, calls } = makeProvider();
    const select = vi.fn();
    function Office() {
      const [value, setValue] = useState("");
      return <AddressCombobox id="office" label="Office address" value={value} provider={provider} onChange={setValue} onSelect={select} />;
    }
    render(<Office />);
    const office = () => screen.getByRole("combobox", { name: "Office address" });
    fireEvent.focus(office());
    fireEvent.change(office(), { target: { value: "600 grant" } });
    await settle();
    await answer(calls[0], []);
    expect(screen.getAllByText("No matches. Try the street number and name, then pick your office from the list.").length).toBeGreaterThan(0);
    expect(screen.queryByText("No matches. Keep typing or enter the address yourself.")).toBeNull();
    fireEvent.keyDown(office(), { key: "Escape" });
    expect(fireEvent.keyDown(office(), { key: "Enter" })).toBe(false);
    expect(select).not.toHaveBeenCalled();
  });
});
