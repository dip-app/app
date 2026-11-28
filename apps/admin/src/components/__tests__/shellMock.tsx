// A light stand-in for Shell in page tests: the title, subtitle, back link label and the header a detail page sets with
// `useShellHeader` (title and meta), without the session, navigation or toaster. Use with
// `vi.mock("@/components/Shell", () => import("./shellMock"))`.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { HeaderOverride } from "../Shell";

const Ctx = createContext<(next: HeaderOverride | null) => void>(() => undefined);

export function useShellHeader(header: HeaderOverride | null) {
  const set = useContext(Ctx);
  const latest = useRef(header);
  latest.current = header;
  const key = header ? `${header.title}|${header.eyebrow ?? ""}|${header.metaKey ?? ""}` : "";
  useEffect(() => { set(latest.current); }, [set, key]);
}

export function Shell({ title, subtitle, back, action, more, children }: { title: string; subtitle?: string; back?: { href: string; label: string }; action?: ReactNode; more?: ReactNode; children: ReactNode }) {
  const [header, setHeader] = useState<HeaderOverride | null>(null);
  return (
    <main>
      {back && <a href={back.href}>{back.label}</a>}
      <h1>{header?.title ?? title}</h1>
      {!header && <p>{subtitle}</p>}
      {(action || more) && <div data-testid="page-actions">{more}{action}</div>}
      {header?.meta && <div data-testid="page-meta">{header.meta}</div>}
      <Ctx.Provider value={setHeader}>{children}</Ctx.Provider>
    </main>
  );
}
