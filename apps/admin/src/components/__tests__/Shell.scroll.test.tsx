// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pathname: "/overview/" }));
const session = { uid: "u1", name: "Ada Lovelace", email: "ada@example.com", companyId: "c", role: "admin" };

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname, useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("../AppProvider", () => ({ useApp: () => ({ session, signOut: vi.fn(), api: { listBugReports: vi.fn().mockResolvedValue({ counts: null }) } }) }));

import { Shell } from "../Shell";

afterEach(cleanup);

// jsdom has no layout, so the static-sidebar rules are guarded at the source, and the scroll behaviour of <main> is tested directly.
const nav = readFileSync(join(__dirname, "..", "..", "styles", "_nav.scss"), "utf8");

describe("app shell scrolling", () => {
  it("the document never scrolls and the sidebar is not sticky; <main> is the scroller", () => {
    expect(nav).toMatch(/html:has\(\.app\) \{ overflow: hidden; overscroll-behavior: none;/);
    expect(nav).toMatch(/\.app \{ height: 100dvh; overflow: clip;/);
    expect(nav).not.toMatch(/position: sticky/);
    expect(nav).toMatch(/overflow-y: auto; overscroll-behavior-y: auto; scrollbar-gutter: stable;/);
  });

  it("<main> takes focus when nothing has it (keyboard scrolling) and scrolls to the top on a new route", () => {
    const { rerender } = render(<Shell title="Overview"><p>body</p></Shell>);
    const main = document.getElementById("main")!;
    expect(document.activeElement).toBe(main);
    main.scrollTop = 400;
    state.pathname = "/events/";
    rerender(<Shell title="Events"><p>body</p></Shell>);
    expect(main.scrollTop).toBe(0);
  });

  it("does not take focus from an element that already has it", () => {
    render(<Shell title="Overview"><input aria-label="field" autoFocus /></Shell>);
    expect(document.activeElement).toBe(screen.getByLabelText("field"));
  });

  it("the drawer locks the page scroller through the shell, not the body", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    render(<Shell title="Overview"><p>body</p></Shell>);
    const app = document.querySelector(".app")!;
    expect(app.getAttribute("data-nav-open")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(app.getAttribute("data-nav-open")).toBe("true");
    expect(document.body.style.overflow).toBe("");
    expect(nav).toContain('.app[data-nav-open="true"] .content { overflow-y: hidden; }');
    fireEvent.keyDown(document, { key: "Escape" });
    expect(app.getAttribute("data-nav-open")).toBeNull();
  });
});
