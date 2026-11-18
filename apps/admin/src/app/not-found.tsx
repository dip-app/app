import { Button } from "@/components/kit";

export default function NotFound() {
  return (
    <main id="main" className="status-page">
      <div className="empty">
        <h1>Page not found</h1>
        <p>That page doesn’t exist or has moved.</p>
        <div className="empty-action status-actions">
          <Button variant="primary" href="/overview/">Go to Overview</Button>
        </div>
      </div>
    </main>
  );
}
