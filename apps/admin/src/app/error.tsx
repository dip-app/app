"use client";

import Link from "next/link";

/** Route-level error boundary: a rendering failure offers a retry or a way out. */
export default function RouteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="status-page">
      <div className="empty" role="alert">
        <h2>Something went wrong</h2>
        <p>This page couldn’t be shown. Try again, or go back to the Overview.</p>
        <div className="empty-action status-actions">
          <button type="button" className="pill-btn purple" onClick={() => reset()}>Try again</button>
          <Link className="pill-btn gray" href="/overview/">Go to Overview</Link>
        </div>
      </div>
    </main>
  );
}
