"use client";

/** Last-resort boundary when the root layout itself fails: no app styles are guaranteed, so it is self-contained. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", color: "#1e212b", background: "#fff" }}>
        <main style={{ maxWidth: 480, margin: "0 auto", padding: "96px 20px", textAlign: "center" }}>
          <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>Something went wrong</h1>
          <p style={{ margin: "0 0 20px", color: "#4b4f66" }}>DIP Admin couldn’t load. Try again, or reload the page.</p>
          <button type="button" onClick={() => reset()} style={{ minHeight: 40, padding: "0 16px", borderRadius: 6, border: 0, background: "#5562dc", color: "#fff", font: "inherit", fontWeight: 600, cursor: "pointer" }}>Try again</button>
        </main>
      </body>
    </html>
  );
}
