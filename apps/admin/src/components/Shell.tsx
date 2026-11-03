"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useApp } from "./AppProvider";

/** Signed-in frame. Visibility is a convenience only; every command is authorized by the backend. */
export function Shell({ children }: { children: React.ReactNode }) {
  const { session, signOut } = useApp();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!session) router.replace("/login/");
  }, [session, router]);
  if (!session) return null;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span>DIP</span> Admin
        </div>
        <nav aria-label="Main">
          <Link href="/events/" aria-current={pathname.startsWith("/events") ? "page" : undefined}>
            Events
          </Link>
        </nav>
        <div className="who">
          <div>
            <strong>{session.name}</strong>
            {session.email} · {session.role === "admin" ? "Organizer" : "Member"}
          </div>
          <button className="btn ghost" style={{ color: "white", borderColor: "#4a4f63" }} onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
