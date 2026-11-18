// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GeneratedEventDraft } from "@/lib/adminTypes";

const state = vi.hoisted(() => ({ api: { listTags: vi.fn() } as { listTags: ReturnType<typeof vi.fn> }, session: { uid: "u" } as object | null }));
vi.mock("../AppProvider", () => ({ useApp: () => ({ api: state.api, session: state.session }) }));

import { DraftCard } from "../Ideas";
import { TagCatalogProvider, useTags } from "../TagCatalog";

afterEach(() => { cleanup(); state.api = { listTags: vi.fn() }; state.session = { uid: "u" }; });

const LIVE = [{ id: "EAI45AaOrCG7kx6v3nQk", name: "Fitness" }, { id: "q9ZxK2mT0wLpR7vB1cYd", name: "Outdoors" }];
const wrapper = ({ children }: { children: React.ReactNode }) => <TagCatalogProvider>{children}</TagCatalogProvider>;

describe("TagCatalogProvider / useTags", () => {
  it("goes loading -> ready and resolves names and byId", async () => {
    state.api.listTags.mockResolvedValue(LIVE);
    const { result } = renderHook(() => useTags(), { wrapper });
    expect(result.current.status).toBe("loading");
    expect(result.current.nameFor("EAI45AaOrCG7kx6v3nQk")).toBe("…");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.nameFor("EAI45AaOrCG7kx6v3nQk")).toBe("Fitness");
    expect(result.current.byId.get("q9ZxK2mT0wLpR7vB1cYd")?.name).toBe("Outdoors");
    expect(result.current.nameFor("zzz")).toBe("Unknown tag");
  });

  it("reads once for any number of consumers", async () => {
    state.api.listTags.mockResolvedValue(LIVE);
    const seen: string[] = [];
    const Consumer = ({ label }: { label: string }) => { const { nameFor, status } = useTags(); seen.push(`${label}:${status}`); return <span>{label}-{nameFor("EAI45AaOrCG7kx6v3nQk")}</span>; };
    render(<TagCatalogProvider><Consumer label="a" /><Consumer label="b" /><Consumer label="c" /></TagCatalogProvider>);
    await waitFor(() => expect(screen.getByText("c-Fitness")).toBeTruthy());
    expect(screen.getByText("a-Fitness")).toBeTruthy();
    expect(state.api.listTags).toHaveBeenCalledTimes(1);
  });

  it("does not read before sign-in", async () => {
    state.session = null;
    const { result } = renderHook(() => useTags(), { wrapper });
    await act(async () => {});
    expect(state.api.listTags).not.toHaveBeenCalled();
    expect(result.current.status).toBe("loading");
  });

  it("reports an error with 'Unknown tag' names, and reload retries", async () => {
    state.api.listTags.mockRejectedValueOnce(new Error("denied")).mockResolvedValue(LIVE);
    const { result } = renderHook(() => useTags(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.nameFor("EAI45AaOrCG7kx6v3nQk")).toBe("Unknown tag");
    await act(async () => { expect(await result.current.reload()).toBe(true); });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.nameFor("EAI45AaOrCG7kx6v3nQk")).toBe("Fitness");
    expect(state.api.listTags).toHaveBeenCalledTimes(2);
  });
});

const draft: GeneratedEventDraft = {
  title: "Lunchtime Walk and Talk", description: "A short walk.", tagIds: ["EAI45AaOrCG7kx6v3nQk", "q9ZxK2mT0wLpR7vB1cYd", "gone0000000000000000"],
  coverImageURL: "catalog://default/outdoors", suggestedDaypart: "weekday_lunch", durationMinutes: 60, venueType: "park_or_outdoors", venueSearchHint: "park",
  costCents: 0, costNote: "", capacity: 20, isOutdoor: true, rationale: "Fits.",
} as GeneratedEventDraft;

describe("Dipbot DraftCard", () => {
  it("shows tag names, not Firestore IDs, and 'Unknown tag' for a missing ID", async () => {
    state.api.listTags.mockResolvedValue(LIVE);
    const { container } = render(<TagCatalogProvider><DraftCard draft={draft} onOpen={() => {}} /></TagCatalogProvider>);
    await waitFor(() => expect(screen.getByText("Fitness")).toBeTruthy());
    const tagList = screen.getByRole("list", { name: "Tags" });
    expect(tagList.textContent).toContain("Outdoors");
    expect(tagList.textContent).toContain("Unknown tag");
    for (const id of draft.tagIds) expect(container.textContent).not.toContain(id);
  });
});
