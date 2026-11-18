// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QUICK_KEY, takeEditorStash, takeQuick, timePresets } from "@/lib/dipbotTouches";
import { localToIso } from "@/lib/when";

const pickEventCover = vi.fn();
const eventIdeaContext = vi.fn();
const push = vi.fn();
let role = "admin";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("../AppProvider", () => ({
  useApp: () => ({ session: { uid: "u", role }, api: { pickEventCover: (i: unknown) => pickEventCover(i), eventIdeaContext: () => eventIdeaContext(), searchCoverPhotos: vi.fn(), importCoverPhoto: vi.fn() } }),
}));

import { CoverPicker } from "../CoverPicker";
import { EventPreview } from "../EventPreview";
import { GenerateSuggestionsButton } from "../GenerateSuggestionsButton";
import { WhenPicker } from "../WhenPicker";
import { emptyDraft } from "@/lib/contract";
import { registerEditorStash } from "@/lib/dipbotTouches";

beforeEach(() => { pickEventCover.mockReset(); eventIdeaContext.mockReset(); push.mockReset(); role = "admin"; window.sessionStorage.clear(); });
afterEach(cleanup);

// ---------- "Dipbot picked this" on the cover

function CoverHarness({ prefilled = false }: { prefilled?: boolean }) {
  const [value, setValue] = useState(prefilled ? "catalog://cover/theme-music" : "catalog://default/hiking");
  const [by, setBy] = useState<string | null>(prefilled ? "catalog://cover/theme-music" : null);
  return (
    <>
      <CoverPicker value={value} dipbotURL={by} onChange={(u, who) => { setValue(u); setBy(who === "dipbot" ? u : null); }} event={{ title: "Jam night" }} />
      <EventPreview draft={{ ...emptyDraft(), coverImageURL: value }} price="" dipbotCover={!!value && by === value} />
    </>
  );
}
const tags = () => document.querySelectorAll(".dipbot-cover-tag");

describe("cover tag: Dipbot picked this", () => {
  it("is shown on the picker preview and the event preview after Let Dipbot choose", async () => {
    pickEventCover.mockResolvedValue({ coverImageURL: "catalog://cover/theme-music", source: "dipbot", provider: "jev", alternatives: [] });
    render(<CoverHarness />);
    expect(tags()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /^Let Dipbot choose/ }));
    await waitFor(() => expect(tags()).toHaveLength(2));
    expect(document.querySelector(".cp-preview .dipbot-cover-tag")?.textContent).toBe("Dipbot picked this");
    expect(document.querySelector(".preview-card .dipbot-cover-tag")).toBeTruthy();
    // Informational: not a control.
    expect(within(document.querySelector(".cp-preview") as HTMLElement).queryByRole("button")).toBeNull();
  });

  it("shows for a Dipbot draft prefill and disappears on a manual choice", () => {
    render(<CoverHarness prefilled />);
    expect(tags()).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("radio")[0]);
    expect(tags()).toHaveLength(0);
  });

  it("works for a cover found live (new photo) and clears when Dipbot's pick is replaced", async () => {
    pickEventCover.mockResolvedValue({ coverImageURL: "catalog://cover/pixabay-777", source: "dipbot", provider: "jev", alternatives: [], newPhoto: true });
    render(<CoverHarness />);
    fireEvent.click(screen.getByRole("button", { name: /^Let Dipbot choose/ }));
    await waitFor(() => expect(tags().length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByRole("radio")[1]);
    expect(tags()).toHaveLength(0);
  });

  it("is not shown for the default cover or when the pick fails", async () => {
    pickEventCover.mockResolvedValue({ coverImageURL: "catalog://default/hiking", source: "default", provider: "heuristic", alternatives: [] });
    render(<CoverHarness />);
    fireEvent.click(screen.getByRole("button", { name: /^Let Dipbot choose/ }));
    await waitFor(() => expect(screen.getByText("Default cover")).toBeTruthy());
    expect(tags()).toHaveLength(0);
  });

  it("an uncontrolled picker (the drafts list) tracks its own Dipbot pick", async () => {
    pickEventCover.mockResolvedValue({ coverImageURL: "catalog://cover/theme-music", source: "dipbot", provider: "jev", alternatives: [] });
    function Plain() {
      const [value, setValue] = useState("catalog://default/hiking");
      return <CoverPicker value={value} onChange={setValue} event={{ title: "Jam night" }} />;
    }
    render(<Plain />);
    fireEvent.click(screen.getByRole("button", { name: /^Let Dipbot choose/ }));
    await waitFor(() => expect(tags()).toHaveLength(1));
    fireEvent.click(screen.getAllByRole("radio")[2]);
    expect(tags()).toHaveLength(0);
  });
});

// ---------- "Dipbot suggests" time presets

const NOW = new Date(2026, 10, 18, 10, 20); // Wed Nov 18 2026
const START = localToIso("2026-11-18", 9 * 60);
const END = localToIso("2026-11-18", 10 * 60);

describe("Dipbot suggests: time presets", () => {
  it("labels the row and puts the mark before each default chip", () => {
    render(<WhenPicker startTime={START} endTime={END} onChange={vi.fn()} now={NOW} />);
    const group = screen.getByRole("group", { name: "Dipbot suggests" });
    const chips = within(group).getAllByRole("button");
    expect(chips.map((c) => c.textContent)).toEqual(["Lunch 12:00 to 1:00 PM", "After work 5:30 to 7:30 PM"]);
    chips.forEach((chip) => expect(chip.firstElementChild?.classList.contains("dipbot-mark")).toBe(true));
    expect(document.querySelector(".when-suggest-label")?.textContent).toBe("Dipbot suggests");
  });

  it("uses the data-driven slot when there is one, and its weekday moves the date to the next such day", () => {
    const onChange = vi.fn();
    render(<WhenPicker startTime={START} endTime={END} onChange={onChange} now={NOW} presets={timePresets({ timing: "weekday_lunch", weekday: 4 })} />);
    const chips = within(screen.getByRole("group", { name: "Dipbot suggests" })).getAllByRole("button");
    expect(chips.map((c) => c.textContent)).toEqual(["Thu 12:00 to 1:00 PM", "After work 5:30 to 7:30 PM"]);
    fireEvent.click(chips[0]);
    expect(onChange).toHaveBeenLastCalledWith(localToIso("2026-11-19", 12 * 60), localToIso("2026-11-19", 13 * 60));
    expect(chips[0].getAttribute("aria-pressed")).toBe("true");
    // A preset without a weekday keeps the chosen date.
    fireEvent.click(chips[1]);
    expect(onChange).toHaveBeenLastCalledWith(localToIso("2026-11-19", 17 * 60 + 30), localToIso("2026-11-19", 19 * 60 + 30));
  });

  it("does nothing when the times are locked", () => {
    const onChange = vi.fn();
    render(<WhenPicker startTime={START} endTime={END} onChange={onChange} now={NOW} disabled />);
    const chip = screen.getByRole("button", { name: /Lunch/ }) as HTMLButtonElement;
    expect(chip.disabled).toBe(true);
    fireEvent.click(chip);
    expect(onChange).not.toHaveBeenCalled();
  });
});

// ---------- Header button

const context = (over: Record<string, unknown> = {}) => ({ enabled: true, credits: { creditCost: { generate: 10 } }, ...over });
const flush = () => act(async () => { await Promise.resolve(); });

describe("Generate suggestions button", () => {
  it("shows the cost on the button, and sets the one-time token before opening quick mode", async () => {
    eventIdeaContext.mockResolvedValue(context());
    render(<GenerateSuggestionsButton />);
    const button = (await screen.findByRole("button", { name: "Generate suggestions, 10 credits" })) as HTMLButtonElement;
    expect(button.textContent).toContain("Generate suggestions");
    expect(button.textContent).toContain("Suggest"); // the phone label, swapped in by CSS
    expect(button.textContent).toContain("10 credits");
    expect(button.querySelector(".dipbot-mark")).toBeTruthy();
    expect(button.disabled).toBe(false);
    expect(window.sessionStorage.getItem(QUICK_KEY)).toBeNull(); // viewing the page arms nothing
    fireEvent.click(button);
    expect(push).toHaveBeenCalledWith("/ideas/?quick=1");
    expect(takeQuick(window.sessionStorage)).toBe(true);
    // A second click while leaving does nothing.
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("keeps a partly filled form for the way back", async () => {
    eventIdeaContext.mockResolvedValue(context());
    registerEditorStash(() => window.sessionStorage.setItem("dip.eventDraftStash.v1", JSON.stringify({ value: { draft: { title: "Half done" } }, savedAt: Date.now() })));
    render(<GenerateSuggestionsButton />);
    fireEvent.click(await screen.findByRole("button", { name: /Generate suggestions/ }));
    expect(takeEditorStash<{ draft: { title: string } }>(window.sessionStorage)?.draft.title).toBe("Half done");
    registerEditorStash(null);
  });

  it("is hidden while loading, for organizers and when Dipbot is off", async () => {
    eventIdeaContext.mockReturnValue(new Promise(() => undefined));
    const loading = render(<GenerateSuggestionsButton />);
    await flush();
    expect(screen.queryByRole("button")).toBeNull();
    loading.unmount();

    role = "organizer";
    eventIdeaContext.mockResolvedValue(context());
    const organizer = render(<GenerateSuggestionsButton />);
    await flush();
    expect(screen.queryByRole("button")).toBeNull();
    organizer.unmount();

    role = "admin";
    eventIdeaContext.mockResolvedValue(context({ enabled: false }));
    render(<GenerateSuggestionsButton />);
    await flush();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
