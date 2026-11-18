// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreditCost, DipbotAction } from "../DipbotAction";

afterEach(cleanup);

describe("DipbotAction", () => {
  it("structures mark, label, divider and cost, and names itself 'Label, 1 credit'", () => {
    render(<DipbotAction label="Let Dipbot choose" credits={1} />);
    const b = screen.getByRole("button", { name: "Let Dipbot choose, 1 credit" });
    expect(b.querySelector("svg.dipbot-mark")).toBeTruthy();
    expect(b.querySelector(".dip-action-label")?.textContent).toBe("Let Dipbot choose");
    expect(b.querySelector(".credit-cost.has-divider")?.textContent).toBe("1 credit");
    expect(b.getAttribute("type")).toBe("button");
    expect(b.getAttribute("data-variant")).toBe("outline");
    expect(b.getAttribute("data-size")).toBe("md");
  });

  it("pluralises and handles free and no cost", () => {
    const { rerender } = render(<DipbotAction label="Generate drafts" credits={10} />);
    expect(screen.getByRole("button", { name: "Generate drafts, 10 credits" })).toBeTruthy();
    rerender(<DipbotAction label="Go" credits={0} />);
    expect(screen.getByRole("button", { name: "Go" }).querySelector(".credit-cost")).toBeNull();
    rerender(<DipbotAction label="Go" credits={0} showFree />);
    expect(screen.getByRole("button", { name: "Go, Free" })).toBeTruthy();
    rerender(<DipbotAction label="Go" />);
    expect(screen.getByRole("button", { name: "Go" }).querySelector(".credit-cost")).toBeNull();
  });

  it("supports every variant and size", () => {
    for (const variant of ["outline", "solid", "ghost", "link"] as const) {
      const { unmount } = render(<DipbotAction label="Do" variant={variant} size="sm" />);
      const b = screen.getByRole("button", { name: "Do" });
      expect(b.getAttribute("data-variant")).toBe(variant);
      expect(b.getAttribute("data-size")).toBe("sm");
      unmount();
    }
  });

  it("loading: busy, spinner in the mark's place, presses ignored", () => {
    const onClick = vi.fn();
    render(<DipbotAction label="Let Dipbot choose" loadingLabel="Dipbot is choosing…" credits={1} loading onClick={onClick} />);
    const b = screen.getByRole("button", { name: "Dipbot is choosing…, 1 credit" });
    expect(b.getAttribute("aria-busy")).toBe("true");
    expect(b.querySelector(".dip-action-spin")).toBeTruthy();
    expect(b.querySelector("svg")).toBeNull();
    expect(b.textContent).toContain("Dipbot is choosing…");
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("disabled carries the reason as tooltip and description", () => {
    const onClick = vi.fn();
    render(<DipbotAction label="Regenerate" credits={10} disabled disabledReason="Not enough credits" onClick={onClick} />);
    const b = screen.getByRole("button", { name: "Regenerate, 10 credits" }) as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    expect(b.title).toBe("Not enough credits");
    expect(document.getElementById(b.getAttribute("aria-describedby")!)?.textContent).toBe("Not enough credits");
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("keeps the full name when collapsed to the icon or a short label", () => {
    const { rerender } = render(<DipbotAction label="Generate suggestions" shortLabel="Suggest" credits={10} />);
    const b = screen.getByRole("button", { name: "Generate suggestions, 10 credits" });
    expect(b.getAttribute("data-short")).toBe("true");
    expect(b.querySelector(".dip-action-short")?.textContent).toBe("Suggest");
    rerender(<DipbotAction label="Generate suggestions" credits={10} iconOnly />);
    expect(screen.getByRole("button", { name: "Generate suggestions, 10 credits" }).getAttribute("data-icon-only")).toBe("true");
  });

  it("icon override and none", () => {
    const { rerender } = render(<DipbotAction label="A" icon={<i data-testid="x" />} />);
    expect(screen.getByTestId("x")).toBeTruthy();
    rerender(<DipbotAction label="A" icon={null} />);
    expect(document.querySelector(".dip-action-icon")).toBeNull();
  });

  it("forwards refs, clicks and passes aria-describedby through", () => {
    const ref = createRef<HTMLButtonElement | HTMLAnchorElement>();
    const onClick = vi.fn();
    render(<DipbotAction ref={ref} label="Go" onClick={onClick} aria-describedby="note" />);
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    expect(ref.current?.getAttribute("aria-describedby")).toBe("note");
  });

  it("renders a link with href and blocks it while loading", () => {
    const { rerender } = render(<DipbotAction href="/ideas/" label="Open Dipbot" credits={1} />);
    const a = screen.getByRole("link", { name: "Open Dipbot, 1 credit" });
    expect(a.getAttribute("href")).toBe("/ideas/");
    rerender(<DipbotAction href="/ideas/" label="Open Dipbot" credits={1} loading />);
    const busy = screen.getByRole("link", { name: "Open Dipbot, 1 credit" });
    expect(busy.getAttribute("href")).toBeNull();
    expect(busy.getAttribute("aria-disabled")).toBe("true");
  });
});

describe("CreditCost", () => {
  it("renders muted cost text with an optional divider", () => {
    const { container, rerender } = render(<CreditCost credits={1} />);
    expect(container.textContent).toBe("1 credit");
    expect(container.querySelector(".has-divider")).toBeNull();
    rerender(<CreditCost credits={10} divider />);
    expect(container.querySelector(".credit-cost.has-divider")?.textContent).toBe("10 credits");
    rerender(<CreditCost credits={0} />);
    expect(container.textContent).toBe("");
    rerender(<CreditCost credits={0} showFree />);
    expect(container.textContent).toBe("Free");
  });
});
