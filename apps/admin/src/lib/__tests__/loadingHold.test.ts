import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminApi } from "../api";
import { holdReadsFromQuery, latencyFromQuery } from "../loadingHold";

const api = { session: async () => null, listThemes: async () => ["a"] } as unknown as AdminApi;
afterEach(() => vi.useRealTimers());

describe("mock latency and loading hold", () => {
  it("reads ?latency= as milliseconds, capped at 10 s, ignoring junk", () => {
    expect(latencyFromQuery("?latency=300")).toBe(300);
    expect(latencyFromQuery("?latency=99999")).toBe(10_000);
    expect(latencyFromQuery("?latency=abc")).toBe(0);
    expect(latencyFromQuery("?latency=-5")).toBe(0);
    expect(latencyFromQuery("")).toBe(0);
  });

  it("returns the same api when no parameter is set", () => {
    expect(holdReadsFromQuery(api, "")).toBe(api);
  });

  it("answers data calls after the latency, but never delays the session", async () => {
    vi.useFakeTimers();
    const slow = holdReadsFromQuery(api, "?latency=500");
    await expect(slow.session()).resolves.toBeNull();
    let value: unknown = null;
    void slow.listThemes().then((v) => { value = v; });
    await vi.advanceTimersByTimeAsync(499);
    expect(value).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(value).toEqual(["a"]);
  });
});
