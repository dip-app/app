// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TableRegion } from "../TableRegion";

afterEach(cleanup);

describe("TableRegion", () => {
  it("is a named, focusable region around the table", () => {
    render(<TableRegion label="Company members"><table><tbody><tr><td>x</td></tr></tbody></table></TableRegion>);
    const region = screen.getByRole("region", { name: "Company members" });
    expect(region.getAttribute("tabindex")).toBe("0");
    expect(region.classList.contains("table-wrap")).toBe(true);
    expect(region.hasAttribute("aria-busy")).toBe(false);
  });

  it("marks the rows busy while a new query loads", () => {
    render(<TableRegion label="Roster" busy><span>rows</span></TableRegion>);
    expect(screen.getByRole("region", { name: "Roster" }).getAttribute("aria-busy")).toBe("true");
  });
});
