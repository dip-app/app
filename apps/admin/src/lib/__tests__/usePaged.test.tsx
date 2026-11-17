// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../components/AppProvider", () => {
  const value = { api: {}, session: { uid: "u1" } };
  return { useApp: () => value };
});

import { usePaged, type PageResult } from "../../components/usePaged";

afterEach(cleanup);

interface Row { id: string; label: string }
const row = (id: string): Row => ({ id, label: id });
const page = (ids: string[], next: string | null, extra: number | null = null): PageResult<Row, number> => ({ items: ids.map(row), nextCursor: next, extra });

/** A fetcher whose calls resolve when the test says so. */
function controlled() {
  const calls: { cursor: string | null; resolve: (result: PageResult<Row, number>) => void; reject: (error: Error) => void }[] = [];
  const fetchPage = vi.fn((_api: unknown, cursor: string | null) => new Promise<PageResult<Row, number>>((resolve, reject) => { calls.push({ cursor, resolve, reject }); }));
  return { calls, fetchPage };
}

async function loaded(fetcher: ReturnType<typeof controlled>, key = "a") {
  const hook = renderHook(({ queryKey }) => usePaged<Row, number>(fetcher.fetchPage as never, queryKey, 2), { initialProps: { queryKey: key } });
  await waitFor(() => expect(fetcher.calls.length).toBe(1));
  await act(async () => { fetcher.calls[0].resolve(page(["1", "2"], "c1", 10)); });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

describe("usePaged", () => {
  it("loads the first page with its extra data", async () => {
    const fetcher = controlled();
    const { result } = await loaded(fetcher);
    expect(result.current.items.map((r) => r.id)).toEqual(["1", "2"]);
    expect(result.current.extra).toBe(10);
    expect(result.current.hasMore).toBe(true);
  });

  it("ignores a second loadMore while one is running", async () => {
    const fetcher = controlled();
    const { result } = await loaded(fetcher);
    act(() => { result.current.loadMore(); result.current.loadMore(); result.current.loadMore(); });
    expect(fetcher.calls.filter((c) => c.cursor === "c1")).toHaveLength(1);
    expect(result.current.loadingMore).toBe(true);
    await act(async () => { fetcher.calls[1].resolve(page(["3", "4"], null)); });
    expect(result.current.items.map((r) => r.id)).toEqual(["1", "2", "3", "4"]);
    expect(result.current.loadingMore).toBe(false);
    expect(result.current.hasMore).toBe(false);
  });

  it("keeps edits made with mutate while a page was loading", async () => {
    const fetcher = controlled();
    const { result } = await loaded(fetcher);
    act(() => result.current.loadMore());
    act(() => result.current.mutate((rows) => rows.map((r) => (r.id === "1" ? { ...r, label: "edited" } : r))));
    await act(async () => { fetcher.calls[1].resolve(page(["3"], null)); });
    expect(result.current.items).toEqual([{ id: "1", label: "edited" }, row("2"), row("3")]);
  });

  it("drops a late page from an older query and resets the busy flag when the query changes", async () => {
    const fetcher = controlled();
    const { result, rerender } = await loaded(fetcher, "a");
    act(() => result.current.loadMore());
    expect(result.current.loadingMore).toBe(true);

    rerender({ queryKey: "b" });
    await waitFor(() => expect(fetcher.calls.length).toBe(3));
    expect(result.current.loadingMore).toBe(false);
    expect(result.current.hasMore).toBe(false);
    // The previous rows stay visible while the new query loads.
    expect(result.current.loading).toBe(true);
    expect(result.current.items.map((r) => r.id)).toEqual(["1", "2"]);

    await act(async () => { fetcher.calls[1].resolve(page(["old"], null)); });
    expect(result.current.items.map((r) => r.id)).toEqual(["1", "2"]);
    expect(result.current.loadingMore).toBe(false);

    await act(async () => { fetcher.calls[2].resolve(page(["9", "10"], "c9", 1)); });
    expect(result.current.items.map((r) => r.id)).toEqual(["9", "10"]);
    expect(result.current.loading).toBe(false);
    expect(result.current.extra).toBe(1);

    // A new load more is possible for the new query even though the old one never finished cleanly.
    act(() => result.current.loadMore());
    expect(fetcher.calls[3].cursor).toBe("c9");
  });

  it("refuses to export a list that changed meanwhile", async () => {
    const fetcher = controlled();
    const { result, rerender } = await loaded(fetcher, "a");
    let outcome: Promise<Row[]> = Promise.resolve([]);
    act(() => { outcome = result.current.loadAll(); outcome.catch(() => undefined); });
    expect(fetcher.calls[1].cursor).toBe("c1");
    rerender({ queryKey: "b" });
    await act(async () => { fetcher.calls[1].resolve(page(["3"], "c2")); });
    await expect(outcome).rejects.toThrow("The filters changed while exporting. Try again.");
  });

  it("exports everything when nothing changes", async () => {
    const fetcher = controlled();
    const { result } = await loaded(fetcher);
    let all: Promise<Row[]> = Promise.resolve([]);
    act(() => { all = result.current.loadAll(); });
    await act(async () => { fetcher.calls[1].resolve(page(["3"], "c2")); });
    await act(async () => { fetcher.calls[2].resolve(page(["4"], null)); });
    expect((await all).map((r) => r.id)).toEqual(["1", "2", "3", "4"]);
  });

  it("shows an error and no rows when a new query fails", async () => {
    const fetcher = controlled();
    const { result, rerender } = await loaded(fetcher, "a");
    rerender({ queryKey: "b" });
    await waitFor(() => expect(fetcher.calls.length).toBe(2));
    await act(async () => { fetcher.calls[1].reject(new Error("boom")); });
    expect(result.current.items).toEqual([]);
    expect(result.current.error?.message).toMatch(/Couldn’t load this/);
    expect(result.current.loading).toBe(false);
  });
});
