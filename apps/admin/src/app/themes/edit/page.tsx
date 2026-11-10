"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Shell } from "@/components/Shell";
import { ThemeForm } from "@/components/ThemeForm";
import type { WeeklyTheme } from "@/lib/challenge";
import { ApiError } from "@/lib/contract";

function Editor() {
  const { api, session } = useApp();
  const id = useSearchParams().get("id") ?? "";
  const [theme, setTheme] = useState<WeeklyTheme | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!session || !id) return;
    let cancelled = false;
    api.getTheme(id).then(
      (loaded) => !cancelled && (setTheme(loaded), setError(null)),
      (failure: unknown) => !cancelled && setError(failure instanceof ApiError ? failure : new ApiError("failed-precondition", "Couldn’t load this theme.")),
    );
    return () => { cancelled = true; };
  }, [api, session, id, version]);

  const reload = useCallback(() => { setTheme(null); setVersion((v) => v + 1); }, []);

  return (
    <>
      {!id ? <div className="banner error" role="alert">No theme was selected.</div>
        : error ? <div className="banner error" role="alert">{error.message}</div>
        : !theme ? <div className="skeleton-list" role="status" aria-label="Loading theme"><div className="skeleton" /></div>
        : <ThemeForm key={`${theme.id}-${theme.revision}`} theme={theme} onReload={reload} />}
    </>
  );
}

export default function EditThemePage() {
  return (
    <Shell title="Edit Theme" subtitle="Changes appear in the app as soon as you save.">
      <Suspense fallback={<div className="skeleton-list" role="status" aria-label="Loading theme"><div className="skeleton" /></div>}><Editor /></Suspense>
    </Shell>
  );
}
