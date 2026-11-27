// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/contract";
import { markAllStale, staleOnWrite } from "@/lib/queryCache";

let session: { uid: string; companyId: string; role: string } | null = { uid: "u1", companyId: "c1", role: "admin" };
const listThemes = vi.fn<() => Promise<string[]>>();
const listPage = vi.fn<(cursor: string | null) => Promise<{ items: string[]; nextCursor: string | null; extra: number | null }>>();
const api = { listThemes: () => listThemes(), listPage: (c: string | null) => listPage(c) };
vi.mock("../AppProvider", () => ({ useApp: () => ({ api, session }) }));

import { useLoad } from "../useLoad";
import { usePaged } from "../usePaged";

function Themes({ id = "a" }: { id?: string }) {
  const themes = useLoad((a) => (a as unknown as typeof api).listThemes(), "themes");
  return <p data-testid={id}>{themes.error ? "error" : themes.data ? themes.data.join(",") : "loading"}{themes.refreshing ? " (refreshing)" : ""}{themes.refreshError ? " (refresh failed)" : ""}</p>;
}
function List() {
  const list = usePaged<string, number>((a, cursor) => (a as unknown as typeof api).listPage(cursor), "all", 2);
  return <p data-testid="list">{list.loading ? "loading " : ""}{list.refreshing ? "refreshing " : ""}{list.items.join(",")}</p>;
}

let now = 1_000_000;
beforeEach(() => {
  session = { uid: "u1", companyId: "c1", role: "admin" };
  listThemes.mockReset(); listPage.mockReset();
  now = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("useLoad cache (stale-while-revalidate)", () => {
  it("a revisit shows the last answer at once and refreshes it in the background", async () => {
    listThemes.mockResolvedValueOnce(["fitness"]);
    const first = render(<Themes />);
    expect(screen.getByTestId("a").textContent).toBe("loading");
    await waitFor(() => expect(screen.getByTestId("a").textContent).toBe("fitness"));
    first.unmount();

    now += 10_000;
    let answer: (v: string[]) => void = () => {};
    listThemes.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    render(<Themes />);
    // No skeleton: the cached answer renders on the first frame, marked as refreshing.
    expect(screen.getByTestId("a").textContent).toBe("fitness (refreshing)");
    await act(async () => answer(["fitness", "music"]));
    expect(screen.getByTestId("a").textContent).toBe("fitness,music");
    expect(listThemes).toHaveBeenCalledTimes(2);
  });

  it("readers mounted together share one request, and a recent answer is not fetched again", async () => {
    listThemes.mockResolvedValue(["fitness"]);
    render(<><Themes id="a" /><Themes id="b" /></>);
    await waitFor(() => expect(screen.getByTestId("b").textContent).toBe("fitness"));
    expect(listThemes).toHaveBeenCalledTimes(1);
    cleanup();
    now += 1000;
    render(<Themes />);
    expect(screen.getByTestId("a").textContent).toBe("fitness");
    expect(listThemes).toHaveBeenCalledTimes(1);
  });

  it("a write marks everything stale, so even a recent answer is refetched", async () => {
    listThemes.mockResolvedValue(["fitness"]);
    const first = render(<Themes />);
    await waitFor(() => expect(screen.getByTestId("a").textContent).toBe("fitness"));
    first.unmount();
    const wrapped = staleOnWrite({ updateTheme: async () => "ok", listThemes: async () => [] as string[] });
    await wrapped.updateTheme();
    await wrapped.listThemes();
    render(<Themes />);
    await waitFor(() => expect(listThemes).toHaveBeenCalledTimes(2));
  });

  it("a failed background refresh keeps the data on screen", async () => {
    listThemes.mockResolvedValueOnce(["fitness"]);
    const first = render(<Themes />);
    await waitFor(() => expect(screen.getByTestId("a").textContent).toBe("fitness"));
    first.unmount();
    now += 10_000;
    listThemes.mockRejectedValueOnce(new ApiError("failed-precondition", "busy"));
    render(<Themes />);
    await waitFor(() => expect(screen.getByTestId("a").textContent).toBe("fitness (refresh failed)"));
  });

  it("a write drops answers no screen shows (a just-saved edit never shows its old version) and keeps the ones on screen", async () => {
    listThemes.mockResolvedValue(["fitness"]);
    const first = render(<Themes />);
    await waitFor(() => expect(screen.getByTestId("a").textContent).toBe("fitness"));
    // On screen during the write: kept (stale), so it still renders at once.
    markAllStale();
    first.unmount();
    listThemes.mockReturnValueOnce(new Promise(() => {}));
    const second = render(<Themes />);
    expect(screen.getByTestId("a").textContent).toBe("fitness (refreshing)");
    second.unmount();
    // Not on screen during the write: dropped, so the next visit loads fresh.
    markAllStale();
    listThemes.mockReturnValueOnce(new Promise(() => {}));
    render(<Themes />);
    expect(screen.getByTestId("a").textContent).toBe("loading");
  });

  it("an answer the server now refuses clears the data instead of keeping it on screen", async () => {
    listThemes.mockResolvedValueOnce(["secret"]);
    const first = render(<Themes />);
    await waitFor(() => expect(screen.getByTestId("a").textContent).toBe("secret"));
    first.unmount();
    now += 10_000;
    listThemes.mockRejectedValueOnce(new ApiError("permission-denied", "no"));
    render(<Themes />);
    await waitFor(() => expect(screen.getByTestId("a").textContent).toBe("error"));
  });

  it("never shows one person's answers to another: a new user, role or company starts empty", async () => {
    listThemes.mockResolvedValueOnce(["secret"]);
    const first = render(<Themes />);
    await waitFor(() => expect(screen.getByTestId("a").textContent).toBe("secret"));
    first.unmount();
    session = { uid: "u1", companyId: "c1", role: "organizer" };
    listThemes.mockReturnValueOnce(new Promise(() => {}));
    render(<Themes />);
    expect(screen.getByTestId("a").textContent).toBe("loading");
  });
});

describe("usePaged cache", () => {
  it("an answer that lands after the person changed (sign-out, another role) is never stored for the new one", async () => {
    let answer: (v: { items: string[]; nextCursor: string | null; extra: number | null }) => void = () => {};
    listPage.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    const first = render(<List />);
    first.unmount();
    session = { uid: "u2", companyId: "c2", role: "admin" };
    listPage.mockReturnValueOnce(new Promise(() => {}));
    const second = render(<List />);
    await act(async () => answer({ items: ["old-company-row"], nextCursor: null, extra: 1 }));
    second.unmount();
    listPage.mockReturnValueOnce(new Promise(() => {}));
    render(<List />);
    expect(screen.getByTestId("list").textContent).toBe("loading ");
  });

  it("a revisit shows the cached first page without the busy state, then the fresh one", async () => {
    listPage.mockResolvedValueOnce({ items: ["a", "b"], nextCursor: "c2", extra: 9 });
    const first = render(<List />);
    expect(screen.getByTestId("list").textContent).toBe("loading ");
    await waitFor(() => expect(screen.getByTestId("list").textContent).toBe("a,b"));
    first.unmount();
    now += 10_000;
    let answer: (v: { items: string[]; nextCursor: string | null; extra: number | null }) => void = () => {};
    listPage.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    render(<List />);
    // Cached rows on the first frame, refreshing behind them (never "loading", which dims the table).
    expect(screen.getByTestId("list").textContent).toBe("refreshing a,b");
    await act(async () => answer({ items: ["a", "z"], nextCursor: null, extra: 9 }));
    expect(screen.getByTestId("list").textContent).toBe("a,z");
  });
});
