"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

/**
 * An old portal address that moved. The export is static, so the move happens in the browser: `to` builds the new
 * address from the old query string, and the old entry is replaced in history so Back skips it. Renders nothing (like
 * the portal root), so there is no flash of a page that is about to go away.
 */
export function Redirect({ to }: { to: (params: URLSearchParams) => string }) {
  return <Suspense fallback={null}><Go to={to} /></Suspense>;
}

function Go({ to }: { to: (params: URLSearchParams) => string }) {
  const router = useRouter();
  const params = useSearchParams();
  const target = to(new URLSearchParams(params.toString()));
  useEffect(() => { router.replace(target); }, [router, target]);
  return null;
}

/** `path?query`, without an empty "?". */
export function withQuery(path: string, params: URLSearchParams): string {
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

/** One old Roster filter to its Members view: the roster opened on everyone, which now means its invitations. */
export function rosterFilterStatus(filter: string): "invited" | "active" | "deactivated" | "revoked" {
  return filter === "revoked" || filter === "active" || filter === "deactivated" ? filter : "invited";
}

/** Old Roster filters (`?filter=`) to the Members views (`?status=`). */
export function rosterToMembers(params: URLSearchParams): string {
  const next = new URLSearchParams();
  next.set("status", rosterFilterStatus(params.get("filter") ?? ""));
  const q = params.get("q");
  if (q) next.set("q", q);
  return withQuery("/members/", next);
}
