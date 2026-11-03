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
        <header className="page-header">
          <div className="titles">
            <h1 className="title-pill">{title}</h1>
            {subtitle && <p className="subtitle">{subtitle}</p>}
          </div>
          {action && <div className="header-action">{action}</div>}
        </header>
        {children}
      </main>
    </div>
  );
}
