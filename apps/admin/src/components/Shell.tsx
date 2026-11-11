"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Capability, ROLE_LABEL, can, isStaff } from "@/lib/adminTypes";
import { CloudMark } from "./Brand";
import { useApp } from "./AppProvider";

interface Props {
  title: string;
  subtitle?: string;
  /** Primary page action, shown at the right of the header. */
  action?: React.ReactNode;
  children: React.ReactNode;
  /** Capability this page needs; without it the page explains instead of failing. The backend still decides. */
  requires?: Capability;
}

interface NavItem { href: string; label: string; d: string; requires?: Capability }
interface NavGroup { heading: string; items: NavItem[] }

// Grouped like most admin tools: what you run, what you review, who is involved, what happened. Items a role can't use are hidden.
const NAV: NavGroup[] = [
  { heading: "Programme", items: [
    { href: "/events/", label: "Events", d: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z", requires: "events.manage" },
  ] },
  { heading: "Challenges", items: [
    { href: "/themes/", label: "Weekly themes", d: "M4 5.5h16V20H4zM4 10h16M8 3v4M16 3v4" },
    { href: "/challenges/", label: "Review submissions", d: "M12 3.5l2.4 5 5.4.7-4 3.7 1 5.4-4.8-2.7-4.8 2.7 1-5.4-4-3.7 5.4-.7z", requires: "challenges.review" },
  ] },
  { heading: "People", items: [
    { href: "/members/", label: "Members", d: "M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM20 20v-1.5a3.5 3.5 0 0 0-2.6-3.4M15.5 4.7a3.5 3.5 0 0 1 0 6.6", requires: "members.view" },
    { href: "/roster/", label: "Roster", d: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01", requires: "roster.manage" },
    { href: "/import/", label: "Import people", d: "M12 4v11m0 0-4-4m4 4 4-4M5 19h14", requires: "import.run" },
  ] },
  { heading: "Insights", items: [
    { href: "/audit/", label: "Audit log", d: "M7 3.5h8l4 4V20.5H7zM14.5 3.5V8H19M10 13h6M10 17h6", requires: "audit.view" },
  ] },
];

const MOBILE = "(max-width: 900px)";

/** "page" for the item's own page, "true" for pages below it (`/members/` covers `/members/detail/`, never `/membersfoo`). */
function isWithin(pathname: string, href: string): "page" | "true" | undefined {
  const base = href.replace(/\/$/, "");
  if (pathname.replace(/\/$/, "") === base) return "page";
  return pathname.startsWith(`${base}/`) ? "true" : undefined;
}

/** Signed-in frame. Visibility is a convenience only; every command is authorized by the backend. */
export function Shell({ title, subtitle, action, children, requires }: Props) {
  const { session, signOut } = useApp();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const sidebar = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!session) router.replace("/login/");
  }, [session, router]);

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) menuButton.current?.focus();
  }, []);

  // Navigating closes the drawer (the new page is the destination, so focus stays with it).
  useEffect(() => { setOpen(false); }, [pathname]);

  useEffect(() => {
    if (!open) return;
    // Drawer open: lock page scroll, start inside the drawer, keep Tab inside it, close on Escape.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
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
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
      media.removeEventListener("change", onChange);
    };
  }, [open, close]);

  if (!session) return null;
  const visible = NAV.map((group) => ({ ...group, items: group.items.filter((item) => !item.requires || can(session.role, item.requires)) })).filter((group) => group.items.length > 0);

  return (
    <div className="app">
      <header className="topbar" inert={open}>
        <button ref={menuButton} className="menu-btn" aria-label="Open menu" aria-expanded={open} aria-controls="sidebar" onClick={() => setOpen(true)}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
        </button>
        <Link href="/events/" className="brand" aria-label="DIP Admin home"><CloudMark size={28} /><span>DIP Admin</span></Link>
      </header>
      <div className="scrim" data-open={open ? "true" : undefined} onClick={() => close()} aria-hidden />
      <aside id="sidebar" className="sidebar" data-open={open ? "true" : undefined} ref={sidebar} aria-label="Sidebar" role={open ? "dialog" : undefined} aria-modal={open ? true : undefined}>
        <div className="sidebar-top">
          <Link href="/events/" className="brand" aria-label="DIP Admin home"><CloudMark size={30} /><span>DIP Admin</span></Link>
          <button ref={closeButton} className="menu-btn close-btn" aria-label="Close menu" onClick={() => close()}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <nav aria-label="Main">
          {visible.map((group) => (
            <div className="nav-group" key={group.heading} role="group" aria-label={group.heading}>
              <p className="nav-heading" aria-hidden>{group.heading}</p>
              {group.items.map((item) => (
                <Link key={item.href} href={item.href} className="nav-item" title={item.label} aria-current={isWithin(pathname, item.href)} onClick={() => { if (open) close(false); }}>
                  <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"><path d={item.d} /></svg>
                  <span className="label">{item.label}</span>
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="account">
          <div className="who" title={`${session.name}, ${ROLE_LABEL[session.role]}`}>
            <strong>{session.name}</strong>
            <span>{ROLE_LABEL[session.role]}</span>
          </div>
          <button className="nav-item signout" onClick={() => void signOut()}>
            <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10" /></svg>
            <span className="label">Sign out</span>
          </button>
        </div>
      </aside>
      <main className="content" inert={open}>
        {!isStaff(session.role) ? (
          <div className="empty" role="alert">
            <h2>No organizer access</h2>
            <p>Your account can use DIP, but it isn’t an organizer for your company. Ask a company admin to assign the organizer role, then sign in again.</p>
          </div>
        ) : requires && !can(session.role, requires) ? (
          <div className="empty" role="alert">
            <h2>Admins only</h2>
            <p>This page is for company admins. Organizers can manage events, weekly themes, albums and attendees.</p>
          </div>
        ) : (<>
        <header className="page-header">
          <div className="titles">
            <h1 className="title-pill">{title}</h1>
            {subtitle && <p className="subtitle">{subtitle}</p>}
          </div>
          {action && <div className="header-action">{action}</div>}
        </header>
        {children}
        </>)}
      </main>
    </div>
  );
}
