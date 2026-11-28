// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button, Chip, ChipToggle, EmptyState, ErrorNotice, ErrorSummary, FilterBar, InlineNotice, PageHeader, Panel, SegmentedControl } from "../kit";

afterEach(cleanup);

describe("Button", () => {
  it("maps variants and sizes onto the portal's classes and defaults to type=button", () => {
    const { rerender } = render(<Button>Save</Button>);
    const b = screen.getByRole("button", { name: "Save" });
    expect(b.className).toBe("pill-btn gray");
    expect(b.getAttribute("type")).toBe("button");
    rerender(<Button variant="primary" size="sm" className="x">Save</Button>);
    expect(screen.getByRole("button").className).toBe("pill-btn purple small x");
    rerender(<Button variant="danger">Delete</Button>);
    expect(screen.getByRole("button").className).toBe("pill-btn danger");
    rerender(<Button variant="plain" type="submit">Go</Button>);
    expect(screen.getByRole("button").className).toBe("pill-btn");
    expect(screen.getByRole("button").getAttribute("type")).toBe("submit");
  });

  it("ignores presses and sets aria-busy while loading, forwards ref and disabled", () => {
    const onClick = vi.fn();
    const ref = createRef<HTMLButtonElement>();
    const { rerender } = render(<Button ref={ref} loading onClick={onClick}>Go</Button>);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByRole("button").getAttribute("aria-busy")).toBe("true");
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    // Pending look: the label stays (the accessible name and the width) under a decorative spinner.
    expect(screen.getByRole("button", { name: "Go" }).querySelector(".btn-label")?.textContent).toBe("Go");
    expect(screen.getByRole("button").querySelector(".btn-spin")?.getAttribute("aria-hidden")).toBe("true");
    rerender(<Button onClick={onClick}>Go</Button>);
    expect(screen.getByRole("button").querySelector(".btn-spin")).toBeNull();
    rerender(<Button disabled onClick={onClick}>Go</Button>);
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders a link with href", () => {
    render(<Button href="/events/" variant="primary">All events</Button>);
    const a = screen.getByRole("link", { name: "All events" });
    expect(a.getAttribute("href")).toContain("/events");
    expect(a.className).toBe("pill-btn purple");
  });
});

describe("Chip and ChipToggle", () => {
  it("chip is informational with a tone", () => {
    const { container } = render(<Chip tone="ok">Active</Chip>);
    expect(container.querySelector("span.info-pill.ok")?.textContent).toBe("Active");
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("toggle chip is aria-pressed, shows a count and toggles", () => {
    const onClick = vi.fn();
    render(<ChipToggle pressed count={24} onClick={onClick}>Fitness</ChipToggle>);
    const b = screen.getByRole("button", { name: /Fitness/ });
    expect(b.getAttribute("aria-pressed")).toBe("true");
    expect(b.querySelector(".chip-count")?.textContent).toBe("24");
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalled();
  });
});

describe("InlineNotice", () => {
  it("error is an alert banner with an action; the rest are status notices", () => {
    const { container, rerender } = render(<InlineNotice tone="error" action={<button>Try again</button>}>Broke</InlineNotice>);
    expect(screen.getByRole("alert").className).toBe("banner error");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    rerender(<InlineNotice tone="success">Saved</InlineNotice>);
    expect(container.querySelector(".notice.success")?.getAttribute("role")).toBe("status");
    rerender(<InlineNotice tone="warn">Careful</InlineNotice>);
    expect(container.querySelector(".notice.warn")).toBeTruthy();
    rerender(<InlineNotice>Info</InlineNotice>);
    expect(container.querySelector(".notice")?.className).toBe("notice");
  });

  it("error has the decorative mark, an optional title, and can take focus instead of announcing", () => {
    const ref = createRef<HTMLDivElement>();
    const { rerender } = render(<InlineNotice tone="error" title="Couldn’t save">Someone else changed this.</InlineNotice>);
    const alert = screen.getByRole("alert");
    expect(alert.querySelector("svg.alert-icon")?.getAttribute("aria-hidden")).toBe("true");
    expect(alert.querySelector(".alert-title")?.textContent).toBe("Couldn’t save");
    expect(alert.textContent).toBe("Couldn’t saveSomeone else changed this.");
    rerender(<InlineNotice tone="error" ref={ref} announce={false}>Broke</InlineNotice>);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(ref.current?.getAttribute("tabindex")).toBe("-1");
  });
});

describe("ErrorNotice", () => {
  const sdk = (code: string, message: string) => Object.assign(new Error(message), { code: `functions/${code}` });

  it("words any thrown value and never shows the code", () => {
    render(<ErrorNotice error={sdk("internal", "internal [0]")} onRetry={() => {}} />);
    expect(screen.getByRole("alert").textContent).toBe("Can’t reach DIP. Check your connection and try again.Try again");
  });

  it("offers Try again only when retrying can help, and Sign in for an ended session", () => {
    const retry = vi.fn();
    const { rerender } = render(<ErrorNotice error={sdk("unavailable", "unavailable [503]")} onRetry={retry} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
    rerender(<ErrorNotice error={sdk("permission-denied", "permission-denied [403]")} onRetry={retry} />);
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<ErrorNotice error={sdk("unauthenticated", "unauthenticated [401]")} onRetry={retry} />);
    expect(screen.getByRole("link", { name: "Sign in" })).toBeTruthy();
  });
});

describe("ErrorSummary", () => {
  it("lists each field once as a link that focuses it, and can take focus itself", () => {
    const ref = createRef<HTMLDivElement>();
    render(<>
      <ErrorSummary ref={ref} title="Fix these to create the event" items={[
        { target: "cover", label: "Cover image", message: "Pick a cover image." },
        { target: "vaddr", label: "Street address", message: "Add the street address." },
        { target: "vaddr", label: "Street address", message: "Coordinates are off." },
      ]} />
      <input id="cover" aria-label="cover" /><input id="vaddr" aria-label="street" />
    </>);
    const alert = ref.current!;
    expect(alert.getAttribute("role")).toBeNull(); // focus announces it once; not a live region
    expect(alert.tabIndex).toBe(-1);
    expect(screen.getByText("Fix these to create the event")).toBeTruthy();
    const links = screen.getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual(["Cover image: Pick a cover image.", "Street address: Add the street address."]);
    Element.prototype.scrollIntoView ??= () => undefined;
    fireEvent.click(links[1]);
    expect(document.activeElement?.id).toBe("vaddr");
  });

  it("renders nothing without items", () => {
    const { container } = render(<ErrorSummary title="Fix" items={[]} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("EmptyState, PageHeader and Panel", () => {
  it("empty state has a heading, body and one action", () => {
    render(<EmptyState title="Nothing yet" body="Come back later" action={<Button>Do it</Button>} />);
    expect(screen.getByRole("heading", { name: "Nothing yet" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Do it" })).toBeTruthy();
  });
  it("page header has one h1, a description and an action slot", () => {
    render(<PageHeader title="Events" description="All of them" actions={<Button>New</Button>} />);
    expect(screen.getByRole("heading", { level: 1, name: "Events" })).toBeTruthy();
    expect(screen.getByText("All of them").className).toBe("subtitle");
    expect(screen.getByRole("button", { name: "New" })).toBeTruthy();
  });
  it("a dense header folds `more` behind a More actions disclosure that Escape and choosing an action close", () => {
    const onExport = vi.fn();
    const { container } = render(<PageHeader dense title="Members" description="Everyone" more={<Button onClick={onExport}>Export CSV</Button>} actions={<Button variant="primary">Add person</Button>} />);
    expect(container.querySelector(".page-header")?.className).toBe("page-header dense");
    const toggle = screen.getByRole("button", { name: "More actions" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById(toggle.getAttribute("aria-controls")!)?.textContent).toBe("Export CSV");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle);
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    expect(onExport).toHaveBeenCalledOnce();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    // Wide screens: the primary action comes after the secondary ones, in reading order.
    expect([...container.querySelectorAll(".header-action button")].map((b) => b.textContent)).toEqual(["", "Export CSV", "Add person"]);
  });
  it("filter bar: one Filters toggle with the number set, the fields it controls, and Clear as the last cell", () => {
    const onClear = vi.fn();
    render(<FilterBar active={2} onClear={onClear} search={<input aria-label="Search" />}><div className="field"><label htmlFor="r">Role</label><select id="r" /></div></FilterBar>);
    const toggle = screen.getByRole("button", { name: /^Filters\s*, 2 filters set$/ });
    const fields = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(fields.getAttribute("role")).toBe("group");
    expect(fields.lastElementChild?.className).toBe("filters-clear");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.closest(".filter-bar")?.getAttribute("data-open")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(onClear).toHaveBeenCalledOnce();
  });
  it("panel labels its section and swaps the body for error, empty and loading states", () => {
    const { rerender } = render(<Panel id="p" title="People" actions={<Button>Add</Button>}><p>Body</p></Panel>);
    expect(screen.getByRole("region", { name: "People" })).toBeTruthy();
    expect(screen.getByText("Body")).toBeTruthy();
    rerender(<Panel id="p" title="People" error="Failed"><p>Body</p></Panel>);
    expect(screen.getByRole("alert").textContent).toBe("Failed");
    expect(screen.queryByText("Body")).toBeNull();
    rerender(<Panel id="p" title="People" empty="No people"><p>Body</p></Panel>);
    expect(screen.getByText("No people")).toBeTruthy();
    rerender(<Panel id="p" title="People" loading><p>Body</p></Panel>);
    expect(screen.getByRole("region", { name: "People" }).getAttribute("aria-busy")).toBe("true");
  });
});

describe("SegmentedControl", () => {
  function Demo({ variant }: { variant: "tabs" | "pill" | "icon" }) {
    const [v, setV] = useState<"a" | "b">("a");
    return <SegmentedControl variant={variant} label="Layout" value={v} onChange={setV} options={[{ value: "a", label: "Grid", iconPath: "M0 0" }, { value: "b", label: "List", iconPath: "M1 1" }]} />;
  }
  it("is a labelled group of aria-pressed buttons in every variant", () => {
    for (const variant of ["tabs", "pill", "icon"] as const) {
      const { unmount } = render(<Demo variant={variant} />);
      const group = screen.getByRole("group", { name: "Layout" });
      expect(group.querySelectorAll("button")).toHaveLength(2);
      const list = screen.getByRole("button", { name: "List" });
      expect(list.getAttribute("aria-pressed")).toBe("false");
      fireEvent.click(list);
      expect(screen.getByRole("button", { name: "List" }).getAttribute("aria-pressed")).toBe("true");
      expect(screen.getByRole("button", { name: "Grid" }).getAttribute("aria-pressed")).toBe("false");
      unmount();
    }
  });
});
