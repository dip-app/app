"use client";
// @i18n-migrated

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { type Capability, ROLE_LABEL, can, isStaff } from "@/lib/adminTypes";
import { AdminOnly } from "./AdminOnly";
import { badgeLabel, setBugBadge, useBugBadge } from "@/lib/bugBadge";
import { t as tAi } from "@/lib/aiStrings";
import { BRAND, type MessageKey, t } from "@/lib/i18n";
import { Avatar } from "./Avatar";
import { CloudMark } from "./Brand";
import { useApp } from "./AppProvider";
import { Toaster } from "./Toast";
import { KeyboardShortcuts } from "./KeyboardShortcuts";
import { type BackLink, EmptyState, PageHeader } from "@/components/kit";

interface Props {
  title: string;
  subtitle?: string;
  /** Primary page action, shown at the right of the header. */
  action?: React.ReactNode;
  children: React.ReactNode;
  /** Capability this page needs; without it the page explains instead of failing. The backend still decides. */
  requires?: Capability;
  /** Detail pages: the list this page belongs to, shown as a small link above the title. */
  back?: BackLink;
  /** Detail pages: what this page shows about the object ("Attendees"), shown before the title. */
  eyebrow?: string;
  /** A line of facts under the title (dates, counts, status). */
  meta?: React.ReactNode;
}

interface NavItem { href: string; /** Catalog key, or null for the Dipbot item (named by the AI copy). */ labelKey: MessageKey | null; d: string; requires?: Capability; badge?: "bugReports"; /** Pages reached from this item that have no nav entry of their own (Import from Members). */ also?: string[] }
interface NavGroup { id: string; headingKey: MessageKey; items: NavItem[]; /** Home has no visible heading; the group is still labeled for screen readers. */ headless?: boolean }

// Grouped like most admin tools: what you run, who is involved, what you support, what happened. Items a role can't use are hidden.
const NAV: NavGroup[] = [
  { id: "home", headingKey: "shell.group.home", headless: true, items: [
    { href: "/overview/", labelKey: "shell.nav.overview", d: "M4 13.5h4V20H4zM10 4h4v16h-4zM16 9h4v11h-4z", requires: "insights.view" },
  ] },
  { id: "program", headingKey: "shell.group.program", items: [
    { href: "/events/", labelKey: "shell.nav.events", d: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z", requires: "events.manage" },
    { href: "/challenges/", labelKey: "shell.nav.challenges", d: "M12 3.5l2.4 5 5.4.7-4 3.7 1 5.4-4.8-2.7-4.8 2.7 1-5.4-4-3.7 5.4-.7z" },
    { href: "/ideas/", labelKey: null, d: "M7 19.5a4.5 4.5 0 0 1-.9-8.9A6 6 0 0 1 17.4 11.4 4.1 4.1 0 0 1 17 19.5zM19.6 2.4l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z", requires: "ai.generate" },
  ] },
  { id: "people", headingKey: "shell.group.people", items: [
    { href: "/members/", labelKey: "shell.nav.members", d: "M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM20 20v-1.5a3.5 3.5 0 0 0-2.6-3.4M15.5 4.7a3.5 3.5 0 0 1 0 6.6", requires: "members.view", also: ["/import/"] },
  ] },
  { id: "support", headingKey: "shell.group.support", items: [
    { href: "/bug-reports/", labelKey: "shell.nav.bugReports", d: "M9 9V7a3 3 0 0 1 6 0v2M7 9h10v5a5 5 0 0 1-10 0zM4 13h3M17 13h3M5 19l2.5-2.2M19 19l-2.5-2.2M12 9v10", requires: "bugreports.manage", badge: "bugReports" },
  ] },
  { id: "insights", headingKey: "shell.group.insights", items: [
    { href: "/audit/", labelKey: "shell.nav.audit", d: "M7 3.5h8l4 4V20.5H7zM14.5 3.5V8H19M10 13h6M10 17h6", requires: "audit.view" },
  ] },
];

const MOBILE = "(max-width: 900px)";

/** What a loaded detail page puts in the header once it knows its object (see `useShellHeader`). */
export interface HeaderOverride { title: string; eyebrow?: string; meta?: React.ReactNode; /** Changes when `meta` should re-render. */ metaKey?: string }
const HeaderContext = createContext<(next: HeaderOverride | null) => void>(() => undefined);

/**
 * A detail page names its object in the page header once it has loaded: the h1 becomes the object ("Pat Member"), the
 * page's own title moves into the eyebrow above it, and `meta` is the line of facts under it. `null` (or unmounting)
 * puts the page's static title back. Pass a `metaKey` that changes whenever the facts change.
 */
export function useShellHeader(header: HeaderOverride | null) {
  const set = useContext(HeaderContext);
  const latest = useRef(header);
  latest.current = header;
  const key = header ? `${header.title}\u0000${header.eyebrow ?? ""}\u0000${header.metaKey ?? ""}` : "";
  useEffect(() => {
    set(latest.current);
  }, [set, key]);
  useEffect(() => () => set(null), [set]);
}

/** "page" for the item's own page, "true" for pages below it (`/members/` covers `/members/detail/`, never `/membersfoo`). */
function isWithin(pathname: string, href: string): "page" | "true" | undefined {
  const base = href.replace(/\/$/, "");
  if (pathname.replace(/\/$/, "") === base) return "page";
  return pathname.startsWith(`${base}/`) ? "true" : undefined;
}

/** Signed-in frame. Visibility is a convenience only; every command is authorized by the backend. */
export function Shell({ title: pageTitle, subtitle, action, children, requires, back, eyebrow: pageEyebrow, meta: pageMeta }: Props) {
  const [override, setOverride] = useState<HeaderOverride | null>(null);
  const title = override?.title ?? pageTitle;
  const eyebrow = override ? (override.eyebrow ?? pageTitle) : pageEyebrow;
  const meta = override ? override.meta : pageMeta;
  const { session, signOut, api } = useApp();
  const bugBadge = useBugBadge();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const sidebar = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const main = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!session) router.replace("/login/");
  }, [session, router]);

  // Admins see how many bug reports are new. Fetched on sign-in and every few minutes; the Bug reports page keeps it current.
  const isAdmin = can(session?.role, "bugreports.manage");
  useEffect(() => {
    if (!isAdmin) { setBugBadge(null); return; }
    let cancelled = false;
    const refresh = () => {
      api.listBugReports({ query: "", status: "new", category: "all", from: "", to: "" }, null, 1).then(
        (page) => { if (!cancelled && page.counts) setBugBadge({ count: page.counts.new, capped: page.counts.capped }); },
        () => { /* the badge is a convenience; the page reports real errors */ },
      );
    };
    refresh();
    const timer = setInterval(refresh, 5 * 60_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [api, isAdmin]);

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) menuButton.current?.focus();
  }, []);

  // Navigating closes the drawer (the new page is the destination, so focus stays with it).
  useEffect(() => { setOpen(false); }, [pathname]);

  // The page scrolls inside <main>, not the window: a new route starts at the top, and when nothing has focus the scroller does, so
  // Space, PageDown and the arrow keys scroll without a click first (browsers only scroll the focused element's scroller).
  // Only `body` focus is replaced, so a page that focuses its own field keeps it.
  useEffect(() => {
    const el = main.current;
    if (!el) return;
    el.scrollTop = 0;
    const active = document.activeElement;
    if (!active || active === document.body) el.focus({ preventScroll: true });
  }, [pathname, session]);

  useEffect(() => {
    if (!open) return;
    // Drawer open (`.app[data-nav-open]` stops the page scroller): start inside the drawer, keep Tab inside it, close on Escape.
    closeButton.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); close(); return; }
      if (event.key !== "Tab" || !sidebar.current) return;
      const focusable = Array.from(sidebar.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      // Focus that ended up outside the drawer (for example on the body after a click) comes back in.
      if (!sidebar.current.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    // Growing the window past the breakpoint turns the drawer back into the docked sidebar.
    const media = window.matchMedia(MOBILE);
    const onChange = () => { if (!media.matches) setOpen(false); };
    document.addEventListener("keydown", onKey);
    media.addEventListener("change", onChange);
    return () => {
      document.removeEventListener("keydown", onKey);
      media.removeEventListener("change", onChange);
    };
  }, [open, close]);


  if (!session) return null;
  const visible = NAV.map((group) => ({ ...group, items: group.items.filter((item) => !item.requires || can(session.role, item.requires)) })).filter((group) => group.items.length > 0);

  return (
    <div className="app" data-nav-open={open ? "true" : undefined}>
      {/* Each page names itself in the tab and history (React hoists <title> into the head). */}
      <title>{t("shell.docTitle", { title: eyebrow ? t("shell.docTitleDetail", { title, eyebrow }) : title, brand: BRAND })}</title>
      <a className="skip-link" href="#main" onClick={(event) => { event.preventDefault(); const target = document.getElementById("main"); target?.focus(); target?.scrollTo?.({ top: 0 }); }}>{t("shell.skip")}</a>
      <header className="topbar" inert={open}>
        <button type="button" ref={menuButton} className="menu-btn" aria-label={t("shell.openMenu")} aria-expanded={open} aria-controls="sidebar" onClick={() => setOpen(true)}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
        </button>
        <Link href="/overview/" className="brand" aria-label={t("shell.home")}><CloudMark size={28} /><span>{BRAND}</span></Link>
      </header>
      <div className="scrim" data-open={open ? "true" : undefined} onClick={() => close()} aria-hidden />
      <aside id="sidebar" className="sidebar" data-open={open ? "true" : undefined} ref={sidebar} aria-label={open ? t("shell.menu") : t("shell.appNav")} role={open ? "dialog" : undefined} aria-modal={open ? true : undefined}>
        <div className="sidebar-top">
          <Link href="/overview/" className="brand" aria-label={t("shell.home")}><CloudMark size={30} /><span>{BRAND}</span></Link>
          <button type="button" ref={closeButton} className="menu-btn close-btn" aria-label={t("shell.closeMenu")} onClick={() => close()}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <nav aria-label={t("shell.mainNav")}>
          {visible.map((group) => (
            <div className="nav-group" key={group.id} role="group" aria-label={t(group.headingKey)}>
              {!group.headless && <p className="nav-heading" aria-hidden>{t(group.headingKey)}</p>}
              {group.items.map((item) => (
                <Link key={item.href} href={item.href} className="nav-item" aria-current={isWithin(pathname, item.href) ?? (item.also?.some((href) => isWithin(pathname, href)) ? "true" : undefined)} onClick={() => { if (open) close(false); }}>
                  <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"><path d={item.d} /></svg>
                  <span className="label">{item.labelKey ? t(item.labelKey) : tAi("nav.label")}</span>
                  {item.badge === "bugReports" && bugBadge && bugBadge.count > 0 && (
                    <span className="nav-badge">{badgeLabel(bugBadge)}<span className="sr-only">{t("shell.newBadge")}</span></span>
                  )}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="account">
          <Link href="/account/" className="who" aria-current={isWithin(pathname, "/account/")} aria-label={t("shell.settingsLink", { name: session.name, role: ROLE_LABEL[session.role] })} title={t("shell.settings")} onClick={() => { if (open) close(false); }}>
            <Avatar name={session.name} userId={session.uid} size={32} />
            <span className="who-text">
              <strong>{session.name}</strong>
              <span>{ROLE_LABEL[session.role]}</span>
            </span>
          </Link>
          <button type="button" className="nav-item signout" onClick={() => void signOut()}>
            <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10" /></svg>
            <span className="label">{t("shell.signOut")}</span>
          </button>
        </div>
      </aside>
      <main id="main" ref={main} tabIndex={-1} className="content" inert={open}>
        {!isStaff(session.role) ? (
          <EmptyState title={t("shell.noAccess.title")} body={t("shell.noAccess.body")} />
        ) : requires && !can(session.role, requires) ? (
          <AdminOnly page={title} capability={requires} role={session.role} />
        ) : (<>
        <PageHeader title={title} description={override ? undefined : subtitle} actions={action} back={back} eyebrow={eyebrow} meta={meta} />
        <HeaderContext.Provider value={setOverride}>{children}</HeaderContext.Provider>
        </>)}
        {/* "g" then a letter goes to any page in the sidebar; "?" lists the shortcuts. */}
        <KeyboardShortcuts pages={[...visible.flatMap((group) => group.items.map((item) => ({ href: item.href, label: item.labelKey ? t(item.labelKey) : tAi("nav.label") }))), { href: "/account/", label: t("shell.settings") }]} />
      </main>
      <Toaster />
    </div>
  );
}
