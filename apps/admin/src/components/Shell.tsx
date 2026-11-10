"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { CloudMark } from "./Brand";
import { useApp } from "./AppProvider";

interface Props {
  title: string;
  subtitle?: string;
  /** Primary page action, shown at the right of the header. */
  action?: React.ReactNode;
  children: React.ReactNode;
}

/** Signed-in frame. Visibility is a convenience only; every command is authorized by the backend. */
export function Shell({ title, subtitle, action, children }: Props) {
  const { session, signOut } = useApp();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!session) router.replace("/login/");
  }, [session, router]);
  if (!session) return null;

  return (
    <div className="app">
      <aside className="sidebar">
        <Link href="/events/" className="brand" aria-label="DIP Admin home">
          <CloudMark size={40} />
          <span>DIP Admin</span>
        </Link>
        <nav aria-label="Main">
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
        </nav>
        <div className="account">
          <div className="who">
            <strong>{session.name}</strong>
            <span>{session.role === "admin" ? "Organizer" : "Member"}</span>
          </div>
          <button className="pill-btn gray" onClick={() => void signOut()}>Sign out</button>
        </div>
      </aside>
      <main className="content">
        {session.role !== "admin" ? (
          <div className="empty" role="alert">
            <h2>No organizer access</h2>
            <p>Your account can use DIP, but it isn’t an organizer for your company. Ask a company admin to assign the organizer role, then sign in again.</p>
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
