"use client";
// @i18n-migrated

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { TagCatalogProvider } from "./TagCatalog";
import { holdReadsFromQuery } from "@/lib/loadingHold";
import { failFromQuery } from "@/lib/mockFailures";
import { type AdminApi, type PersonaId, type Session, browserStore, createMockApi } from "@/lib/api";
import { Button, EmptyState } from "@/components/kit";
import { BRAND, applyMemberLocale, initLocale, t } from "@/lib/i18n";
import { I18nProvider } from "./I18nProvider";

interface AppState {
  api: AdminApi;
  session: Session | null;
  ready: boolean;
  signIn: (persona?: PersonaId) => Promise<void>;
  signOut: () => Promise<void>;
}

const Context = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  // The mock lives in localStorage, so it is created after mount to keep static export hydration clean.
  const [api, setApi] = useState<AdminApi | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  // Children render only after the stored session is read, so deep links aren't mistaken for signed-out.
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // The language is a browser setting (Your settings, else the browser languages), read before anything renders text.
    initLocale();
    (async () => {
      // Build-time config picks the backend: Firebase when the web app is configured, otherwise the local mock.
      // The Firebase adapter (and the SDK behind it) is fetched only in live mode, so mock and login routes stay small.
      // Variables are referenced statically so Next.js inlines them.
      const configured = Boolean(process.env.NEXT_PUBLIC_FIREBASE_API_KEY && process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID && process.env.NEXT_PUBLIC_FIREBASE_APP_ID);
      let created: AdminApi;
      if (configured) {
        const { createFirebaseApi, readLiveConfig } = await import("@/lib/firebaseAdapter");
        const live = readLiveConfig();
        created = live ? createFirebaseApi(live) : holdReadsFromQuery(createMockApi(browserStore(), () => new Date(), true), window.location.search);
      } else {
        // `?loading=1` (mock only) keeps every page in its loading state for screenshots; `?fail=` forces error states.
        created = await failFromQuery(holdReadsFromQuery(createMockApi(browserStore(), () => new Date(), true), window.location.search), window.location.search);
      }
      if (cancelled) return;
      setApi(created);
      const stored = await created.session();
      if (cancelled) return;
      // A language saved on the member's profile wins over the browser default (localStorage stays the fallback).
      applyMemberLocale(stored?.locale);
      setSession(stored);
      setLoaded(true);
    })().catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);

  const signIn = useCallback(async (persona?: PersonaId) => {
    if (!api) return;
    const signedIn = await api.signIn(persona);
    applyMemberLocale(signedIn.locale);
    setSession(signedIn);
  }, [api]);
  const signOut = useCallback(async () => {
    if (!api) return;
    await api.signOut();
    setSession(null);
  }, [api]);

  const value = useMemo<AppState | null>(
    () => (api && loaded ? { api, session, ready: true, signIn, signOut } : null),
    [api, loaded, session, signIn, signOut],
  );
  if (failed) {
    return (
      <div className="boot-state">
        <EmptyState role="alert" title={t("common.boot.failedTitle")} body={t("common.boot.failedBody")}
          action={<Button variant="primary" onClick={() => window.location.reload()}>{t("common.boot.reload")}</Button>} />
      </div>
    );
  }
  if (!value) return <div className="boot-state" role="status"><title>{BRAND}</title><span className="sr-only">{t("common.boot.loading")}</span></div>;
  return <Context.Provider value={value}><TagCatalogProvider><I18nProvider>{children}</I18nProvider></TagCatalogProvider></Context.Provider>;
}

export function useApp(): AppState {
  const value = useContext(Context);
  if (!value) throw new Error("useApp must be used inside AppProvider");
  return value;
}
