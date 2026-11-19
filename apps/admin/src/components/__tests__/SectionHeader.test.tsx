// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SectionHeader } from "../kit";

afterEach(cleanup);

describe("SectionHeader", () => {
  it("renders the mark, title, updated text and actions in one row, without a toggle by default", () => {
    render(<SectionHeader title="Dipbot suggests 2 choices" headingLevel={3} updated="Updated 3 hours ago" end={<button type="button">Use suggestions</button>} />);
    expect(screen.getByRole("heading", { level: 3, name: "Dipbot suggests 2 choices" })).toBeTruthy();
    expect(screen.getByText("Updated 3 hours ago").className).toBe("sh-when");
    expect(screen.getByRole("button", { name: "Use suggestions" })).toBeTruthy();
    expect(document.querySelector(".sh-toggle")).toBeNull();
    expect(document.querySelectorAll(".sh-head > svg, .sh-head > .sh-mark").length).toBeGreaterThan(0);
  });

  it("shows the stale hint inline beside the updated text, and nothing when fresh", () => {
    const { rerender } = render(<SectionHeader title="Dipbot suggests 2 choices" headingLevel={3} updated="Updated 3 days ago" staleHint="New data available" />);
    const when = document.querySelector(".sh-when")!;
    expect(when.textContent).toContain("Updated 3 days ago");
    expect(when.querySelector(".sh-stale")?.textContent).toContain("New data available");
    expect(document.querySelectorAll(".sh-head > *").length).toBeGreaterThan(0);
    rerender(<SectionHeader title="Dipbot suggests 2 choices" headingLevel={3} updated="Updated just now" />);
    expect(document.querySelector(".sh-stale")).toBeNull();
  });

  it("an optional toggle is a labelled aria-expanded button", () => {
    const onToggle = vi.fn();
    render(<SectionHeader title="Ideas for you" toggle={{ collapsed: false, controls: "body", label: "Collapse ideas", onToggle }} />);
    const toggle = screen.getByRole("button", { name: "Collapse ideas" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.getAttribute("aria-controls")).toBe("body");
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
