"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
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

/** Signed-in frame. Visibility is a convenience only; every command is authorized by the backend. */
export function Shell({ title, subtitle, action, children, requires }: Props) {
  const { session, signOut } = useApp();
  const router = useRouter();
  const pathname = usePathname();
  const nav = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!session) router.replace("/login/");
  }, [session, router]);
  useEffect(() => {
    // On narrow screens the nav scrolls sideways; keep the current page's item in view.
    const current = nav.current?.querySelector<HTMLElement>("[aria-current=page]");
    if (current && nav.current && nav.current.scrollWidth > nav.current.clientWidth) nav.current.scrollTo({ left: current.offsetLeft - 16 });
  }, [pathname, session]);
  if (!session) return null;

  return (
    <div className="app">
      <aside className="sidebar">
        <Link href="/events/" className="brand" aria-label="DIP Admin home">
          <CloudMark size={40} />
          <span>DIP Admin</span>
        </Link>
        <nav aria-label="Main" ref={nav}>
          <Link href="/events/" className="nav-item" aria-current={pathname.startsWith("/events") ? "page" : undefined}>
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
              <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
              <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
            </svg>
            Events
          </Link>
          <Link href="/themes/" className="nav-item" aria-current={pathname.startsWith("/themes") ? "page" : undefined}>
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round">
              <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" />
              <path d="m12 12.6.95 1.95 2.15.3-1.55 1.5.37 2.13L12 17.47l-1.92 1.01.37-2.13-1.55-1.5 2.15-.3Z" />
            </svg>
            Weekly themes
          </Link>
          {can(session.role, "challenges.review") && <NavLink href="/challenges/" current={pathname.startsWith("/challenges")} label="Challenges" d="M12 3.5l2.4 5 5.4.7-4 3.7 1 5.4-4.8-2.7-4.8 2.7 1-5.4-4-3.7 5.4-.7z" />}
          {can(session.role, "members.view") && <NavLink href="/members/" current={pathname.startsWith("/members")} label="Members" d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM20 20v-1.5a3.5 3.5 0 0 0-2.6-3.4M15.5 4.7a3.5 3.5 0 0 1 0 6.6" />}
          {can(session.role, "roster.manage") && <NavLink href="/roster/" current={pathname.startsWith("/roster")} label="Roster" d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />}
          {can(session.role, "import.run") && <NavLink href="/import/" current={pathname.startsWith("/import")} label="Import" d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" />}
          {can(session.role, "audit.view") && <NavLink href="/audit/" current={pathname.startsWith("/audit")} label="Audit log" d="M7 3.5h8l4 4V20.5H7zM14.5 3.5V8H19M10 13h6M10 17h6" />}
        </nav>
        <div className="account">
          <div className="who">
            <strong>{session.name}</strong>
            <span>{ROLE_LABEL[session.role]}</span>
          </div>
          <button className="pill-btn gray" onClick={() => void signOut()}>Sign out</button>
        </div>
      </aside>
      <main className="content">
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

function NavLink({ href, current, label, d }: { href: string; current: boolean; label: string; d: string }) {
  return (
    <Link href={href} className="nav-item" aria-current={current ? "page" : undefined}>
      <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"><path d={d} /></svg>
      {label}
    </Link>
  );
}
