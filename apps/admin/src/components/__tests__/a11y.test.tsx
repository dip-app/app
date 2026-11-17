// @vitest-environment jsdom
import axe from "axe-core";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "@/lib/contract";
import { Dialog } from "../Dialog";
import { RadioGrid } from "../RadioGrid";
import { Tabs, tabPanelProps } from "../Tabs";
import { TableRegion } from "../TableRegion";
import { Toaster, toast } from "../Toast";
import { Empty, LoadError, LoadMore, Loading, ResultCount, SearchBox } from "../Ui";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute("open"); };
});
afterEach(cleanup);

// jsdom has no layout or paint, so contrast and landmark-region checks can't run here.
async function violations(container: HTMLElement) {
  const result = await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

describe("accessibility (axe)", () => {
  it("tabs with a panel", async () => {
    const { container } = render(
      <>
        <Tabs idBase="x" label="Filter" value="a" onChange={() => {}} items={[{ id: "a", label: "One", count: 1 }, { id: "b", label: "Two" }]} />
        <div {...tabPanelProps("x", "a")}>content</div>
      </>,
    );
    expect(await violations(container)).toEqual([]);
  });

  it("table region with a table", async () => {
    const { container } = render(
      <TableRegion label="Members">
        <table className="table">
          <caption className="sr-only">Members</caption>
          <thead><tr><th scope="col">Name</th><th scope="col">Role</th></tr></thead>
          <tbody><tr><th scope="row">Ana</th><td>Admin</td></tr></tbody>
        </table>
      </TableRegion>,
    );
    expect(await violations(container)).toEqual([]);
  });

  it("search, result count and load more", async () => {
    const { container } = render(
      <>
        <SearchBox value="" onChange={() => {}} label="Search people" />
        <ResultCount>Showing 25 of 140 people</ResultCount>
        <LoadMore shown={25} total={140} loading={false} onClick={() => {}} />
      </>,
    );
    expect(await violations(container)).toEqual([]);
  });

  it("radio picker", async () => {
    const { container } = render(
      <RadioGrid label="Cover image" value="a" onChange={() => {}} options={[{ value: "a", label: "A", content: <span>A</span> }, { value: "b", label: "B", content: <span>B</span> }]} />,
    );
    expect(await violations(container)).toEqual([]);
  });

  it("dialog with a reason field", async () => {
    const { container } = render(
      <Dialog danger title="Remove Sam?" confirmLabel="Remove" reasonLabel="Why?" onConfirm={async () => {}} onClose={() => {}}><p>They lose their place.</p></Dialog>,
    );
    expect(await violations(container)).toEqual([]);
  });

  it("empty and error states", async () => {
    const { container } = render(
      <>
        <Empty title="No one matches" body="Clear a filter." />
        <LoadError error={new ApiError("not-found", "That event doesn’t exist.")} onRetry={() => {}} backHref="/events/" backLabel="Back to events" />
        <LoadError error={new ApiError("failed-precondition", "Couldn’t load this.")} onRetry={() => {}} />
        <Loading label="Loading members" />
      </>,
    );
    expect(await violations(container)).toEqual([]);
  });

  it("toasts", async () => {
    const { container } = render(<Toaster />);
    toast("Saved.", { action: { label: "Undo", onClick: () => {} } });
    toast("Export failed.", { tone: "error" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.querySelectorAll(".toast").length).toBe(2);
    expect(await violations(container)).toEqual([]);
  });
});
