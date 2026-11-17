"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { type AdminApi, type PersonaId, type Session, browserStore, createMockApi } from "@/lib/api";

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
    (async () => {
      // Build-time config picks the backend: Firebase when the web app is configured, otherwise the local mock.
      // The Firebase adapter (and the SDK behind it) is fetched only in live mode, so mock and login routes stay small.
      // Variables are referenced statically so Next.js inlines them.
      const configured = Boolean(process.env.NEXT_PUBLIC_FIREBASE_API_KEY && process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID && process.env.NEXT_PUBLIC_FIREBASE_APP_ID);
      let created: AdminApi;
      if (configured) {
        const { createFirebaseApi, readLiveConfig } = await import("@/lib/firebaseAdapter");
        const live = readLiveConfig();
        created = live ? createFirebaseApi(live) : createMockApi(browserStore());
      } else {
        created = createMockApi(browserStore());
      }
      if (cancelled) return;
      setApi(created);
      const stored = await created.session();
      if (cancelled) return;
      setSession(stored);
      setLoaded(true);
    })().catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);

  const signIn = useCallback(async (persona?: PersonaId) => {
    if (api) setSession(await api.signIn(persona));
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
        <div className="empty" role="alert">
          <h2>Can’t load DIP Admin</h2>
          <p>Something went wrong while signing you in. Check your connection and try again.</p>
          <div className="empty-action"><button type="button" className="pill-btn purple" onClick={() => window.location.reload()}>Reload</button></div>
        </div>
      </div>
    );
  }
  if (!value) return <div className="boot-state" role="status"><title>DIP Admin</title><span className="sr-only">Loading DIP Admin</span></div>;
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useApp(): AppState {
  const value = useContext(Context);
  if (!value) throw new Error("useApp must be used inside AppProvider");
  return value;
}
