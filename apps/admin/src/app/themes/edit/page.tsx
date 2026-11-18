"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Shell } from "@/components/Shell";
import { ThemeForm } from "@/components/ThemeForm";
import { LoadError, Loading } from "@/components/Ui";
import type { WeeklyTheme } from "@/lib/challenge";
import { ApiError } from "@/lib/contract";
import { useSkeletonGate } from "@/components/useDelayedShow";

const NO_THEME = new ApiError("not-found", "No theme was selected. Pick one from the weekly themes list.");

function Editor() {
  const { api, session } = useApp();
  const id = useSearchParams().get("id") ?? "";
  const [theme, setTheme] = useState<WeeklyTheme | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!session || !id) return;
    let cancelled = false;
    setTheme(null);
    setError(null);
    api.getTheme(id).then(
      (loaded) => !cancelled && (setTheme(loaded), setError(null)),
      (failure: unknown) => !cancelled && setError(failure instanceof ApiError ? failure : new ApiError("failed-precondition", "Couldn’t load this theme. Check your connection and try again.")),
    );
    return () => { cancelled = true; };
  }, [api, session, id, version]);

  const reload = useCallback(() => { setTheme(null); setVersion((v) => v + 1); }, []);

  const hold = useSkeletonGate(Boolean(id) && !theme && !error);
  if (!id) return <LoadError error={NO_THEME} onRetry={reload} backHref="/themes/" backLabel="Back to weekly themes" />;
  if (error) return <LoadError error={error} onRetry={reload} backHref="/themes/" backLabel="Back to weekly themes" />;
  if (!theme || hold) return <Loading label="Loading theme" layout="form" />;
  return <ThemeForm key={`${theme.id}-${theme.revision}`} theme={theme} onReload={reload} />;
}

export default function EditThemePage() {
  return (
    <Shell title="Edit theme" subtitle="Changes appear in the app as soon as you save." requires="themes.manage">
      <Suspense fallback={<Loading label="Loading theme" layout="form" />}><Editor /></Suspense>
    </Shell>
  );
}
