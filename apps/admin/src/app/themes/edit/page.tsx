"use client";
// @i18n-migrated

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Shell } from "@/components/Shell";
import { ThemeForm } from "@/components/ThemeForm";
import { LoadError, Loading } from "@/components/Ui";
import type { WeeklyTheme } from "@/lib/challenge";
import { ApiError } from "@/lib/contract";
import { useSkeletonGate } from "@/components/useDelayedShow";
import { t } from "@/lib/i18n";

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
      (failure: unknown) => !cancelled && setError(failure instanceof ApiError ? failure : new ApiError("failed-precondition", t("themeForm.edit.loadFailed"))),
    );
    return () => { cancelled = true; };
  }, [api, session, id, version]);

  const reload = useCallback(() => { setTheme(null); setVersion((v) => v + 1); }, []);

  const hold = useSkeletonGate(Boolean(id) && !theme && !error);
  if (!id) return <LoadError error={new ApiError("not-found", t("themeForm.edit.noTheme"))} onRetry={reload} backHref="/themes/" backLabel={t("themeForm.edit.backLabel")} />;
  if (error) return <LoadError error={error} onRetry={reload} backHref="/themes/" backLabel={t("themeForm.edit.backLabel")} />;
  if (!theme || hold) return <Loading label={t("themeForm.edit.loading")} layout="form" />;
  return <ThemeForm key={`${theme.id}-${theme.revision}`} theme={theme} onReload={reload} />;
}

export default function EditThemePage() {
  return (
    <Shell title={t("themeForm.edit.title")} subtitle={t("themeForm.edit.subtitle")} requires="themes.manage">
      <Suspense fallback={<Loading label={t("themeForm.edit.loading")} layout="form" />}><Editor /></Suspense>
    </Shell>
  );
}
