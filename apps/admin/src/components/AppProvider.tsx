"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { type AdminApi, type PersonaId, type Session, browserStore, createMockApi } from "@/lib/api";
import { createFirebaseApi, readLiveConfig } from "@/lib/firebaseAdapter";

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

  useEffect(() => {
    // Build-time config picks the backend: Firebase when the web app is configured, otherwise the local mock.
    const live = readLiveConfig();
    const created = live ? createFirebaseApi(live) : createMockApi(browserStore());
    setApi(created);
    void created.session().then((stored) => {
      setSession(stored);
      setLoaded(true);
    });
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
  if (!value) return null;
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useApp(): AppState {
  const value = useContext(Context);
  if (!value) throw new Error("useApp must be used inside AppProvider");
  return value;
}
