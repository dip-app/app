// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AdminApi, type KeyValueStore, createMockApi } from "@/lib/api";

const NOW = new Date("2026-11-17T12:00:00Z");
const memory = (): KeyValueStore => {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
};
let current: { api: AdminApi } | null = null;

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined }) }));
vi.mock("../AppProvider", () => ({ useApp: () => ({ api: current!.api, session: { uid: "u" } }) }));

import { Ideas } from "../Ideas";
import { TagCatalogProvider } from "../TagCatalog";
import { Toaster } from "../Toast";

async function open(search: string) {
  const api = createMockApi(memory(), () => NOW);
  await api.signIn("admin");
  current = { api };
  window.history.replaceState(null, "", `/${search}`);
  render(<TagCatalogProvider><Ideas /></TagCatalogProvider>);
}

beforeEach(() => { current = null; });
afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });

describe("Dipbot credits in the idea flow", () => {
  it("shows the meter with the balance and a cost on the generate button", async () => {
    await open("?step=5");
    await waitFor(() => expect(screen.getByText("Credits: 412 of 500 this month")).toBeTruthy());
    const generate = (await screen.findByRole("button", { name: "Generate drafts, 10 credits" })) as HTMLButtonElement;
    expect(generate.disabled).toBe(false);
    expect(screen.queryByRole("alert")).toBeNull();
    // The event budget option ("Under $15") is the event's cost per person; the credits UI itself never shows money.
    const meter = document.querySelector(".credits-meter")!;
    expect(`${meter.textContent}${meter.getAttribute("title")}${generate.textContent}`).not.toMatch(/\$|\bUSD\b|dollar|cents|cost|budget/i);
  });

  it("warns calmly under 20% and keeps generating on", async () => {
    await open("?ai=lowcredits&step=5");
    await waitFor(() => expect(screen.getByText("Credits: 60 of 500 this month")).toBeTruthy());
    expect(screen.getByRole("status").textContent).toMatch(/running low on Dipbot credits\. They reset on [A-Z][a-z]{2} 1\./);
    expect(((await screen.findByRole("button", { name: "Generate drafts, 10 credits" })) as HTMLButtonElement).disabled).toBe(false);
  });

  it("out of credits disables the paid action but keeps the note and choices", async () => {
    await open("?ai=nocredits&step=5");
    await waitFor(() => expect(screen.getByText("Credits: 0 of 500 this month")).toBeTruthy());
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/used this month’s Dipbot credits\. They reset on [A-Z][a-z]{2} 1\./);
    expect(((await screen.findByRole("button", { name: "Generate drafts, 10 credits" })) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
    // Nothing was lost: the note field and the step actions are still there.
    expect(screen.getByRole("textbox") instanceof HTMLTextAreaElement).toBe(true);
  });
});

describe("Use suggestions", () => {
  it("visibly selects the suggested card, says so, and is accurate about what was applied", async () => {
    await open("");
    const pick = (await screen.findByRole("button", { name: /^Use suggestions/ })) as HTMLButtonElement;
    expect(pick.disabled).toBe(false);
    const fitness = screen.getByRole("checkbox", { name: /Fitness/ }) as HTMLInputElement;
    expect(fitness.checked).toBe(false);
    expect(screen.queryByText(/selected below/)).toBeNull();
    fireEvent.click(pick);
    expect(fitness.checked).toBe(true);
    expect(fitness.closest(".opt")?.getAttribute("data-flash")).toBe("true");
    expect(screen.getByText(/suggestion is selected/)).toBeTruthy();
    // The state is said once, and the button is gone (no disabled "Picked" pill).
    expect(screen.queryByRole("button", { name: /^Use suggestions/ })).toBeNull();
    // One Dipbot action per step: the old "Let Dipbot choose" card is gone and a hint explains an empty pick.
    expect(screen.queryByText("Let Dipbot choose")).toBeNull();
    expect(screen.getByText("Pick none and any interest can fit.")).toBeTruthy();
    // Declutter: no provider branding, no side rail, the privacy note sits behind a link.
    expect(document.body.textContent).not.toMatch(/Jev|Powered by|Nothing is selected/);
    expect(document.querySelector(".ideas-rail, .rail-card")).toBeNull();
    expect(screen.queryByText(/never sees names/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "What does Dipbot see?" }));
    expect(screen.getByText(/never sees names or personal data/)).toBeTruthy();
  });

  it("applies the suggestions for every step in one click, keeps steps editable and the header has no second row", async () => {
    await open("");
    const pick = await screen.findByRole("button", { name: /^Use suggestions/ });
    // One header row: no separate "Updated ... · Refresh" line; Refresh is a button beside the primary one.
    await waitFor(() => expect(screen.getByRole("button", { name: /^Refresh Dipbot suggestions, 1 credit/ })).toBeTruthy());
    expect(document.querySelector(".sg-meta")).toBeNull();
    const refresh = screen.getByRole("button", { name: /^Refresh Dipbot suggestions/ });
    // "Updated N ago" is inline in the header beside the title (same header as "Ideas for you"), not in a row below.
    const head = pick.closest(".sg-bar")!.querySelector(".sh-head")!;
    expect(head.querySelector(".sh-when")?.textContent).toMatch(/^Updated .+ ago/);
    expect(screen.getAllByText(/^Updated .+ ago/).filter((e) => !e.closest(".ifu"))).toHaveLength(1);
    expect(pick.closest(".sg-bar")).toBe(refresh.closest(".sg-bar"));
    render(<Toaster />);
    fireEvent.click(pick);
    expect(screen.getAllByText("Applied Dipbot’s suggestions to all steps.").length).toBeGreaterThan(0);
    // Stays on the first step; later steps are already filled and the stepper marks them complete.
    expect(screen.getByText(/suggestion is selected/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect((screen.getByRole("radio", { name: /Friendly competition/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(document.querySelectorAll("input[type=radio]:checked").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(document.querySelectorAll("input[type=radio]:checked").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("button", { name: /Generate drafts/ })).toBeTruthy();
    // Each step remains editable.
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    const radios = Array.from(document.querySelectorAll<HTMLInputElement>("input[type=radio]"));
    const other = radios.find((r) => !r.checked)!;
    fireEvent.click(other);
    expect(other.checked).toBe(true);
  });

  it("does not call the API when applying (cached suggestions, no credits)", async () => {
    await open("?step=2");
    await screen.findByRole("button", { name: /^Use suggestions/ });
    expect(document.querySelector(".credits-meter")?.textContent).toContain("412 of 500");
    fireEvent.click(screen.getByRole("button", { name: /^Use suggestions/ }));
    expect((screen.getByRole("radio", { name: /Friendly competition/ }) as HTMLInputElement).checked).toBe(true);
    expect(document.querySelector(".credits-meter")?.textContent).toContain("412 of 500");
  });

  it("with no data it says so honestly: no Applied, no match claim, and the button is disabled with a reason", async () => {
    await open("?ai=nodata");
    await waitFor(() => expect(screen.getByText(/Not enough data yet to suggest interests/)).toBeTruthy());
    const off = screen.getByRole("button", { name: /^Use suggestions/ }) as HTMLButtonElement;
    expect(off.disabled).toBe(true);
    expect(off.getAttribute("title")).toMatch(/no suggestions to apply/);
    expect(screen.queryByText(/Applied|Picked|selected below|match/)).toBeNull();
  });
});
