"use client";

import { Button } from "@/components/kit";

/** Route-level error boundary: a rendering failure offers a retry or a way out. */
export default function RouteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="status-page">
      <div className="empty" role="alert">
        <h2>Something went wrong</h2>
        <p>This page couldn’t be shown. Try again, or go back to the Overview.</p>
        <div className="empty-action status-actions">
          <Button variant="primary" onClick={() => reset()}>Try again</Button>
          <Button href="/overview/">Go to Overview</Button>
        </div>
      </div>
    </main>
  );
}
