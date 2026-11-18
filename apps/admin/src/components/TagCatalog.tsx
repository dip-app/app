"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Tag } from "@/lib/catalog";
import { createTagResolver } from "@/lib/tagCatalog";
import { useApp } from "./AppProvider";

export type TagCatalogStatus = "loading" | "ready" | "error";

export interface TagCatalogState {
  tags: Tag[];
  byId: ReadonlyMap<string, Tag>;
  status: TagCatalogStatus;
  /**
   * The display name for a tag ID: the catalog name, "…" while the catalog is still loading, and "Unknown tag" for an
   * ID that isn't in it. The raw ID (opaque in production) is never returned.
   */
  nameFor: (id: string) => string;
  has: (id: string) => boolean;
  /**
   * Reads the catalog again. A catalog that already loaded keeps its names on screen while this runs (no flash to "…"
   * or to an empty list); one that never loaded goes back to loading. Resolves true when the read worked.
   */
  reload: () => Promise<boolean>;
}

const Context = createContext<TagCatalogState | null>(null);

/**
 * The tag catalog (`tags/{tagId}`, readable by any verified user) for the whole portal: read once after sign-in
 * (the bundled list in mock mode, through the same `listTags` call), held in memory and shared by every screen.
 */
export function TagCatalogProvider({ children }: { children: React.ReactNode }) {
  const { api, session } = useApp();
  const signedIn = Boolean(session);
  const [state, setState] = useState<{ tags: Tag[]; status: TagCatalogStatus }>({ tags: [], status: "loading" });
  const latest = useRef(0);

  // Only the newest read counts: a reload makes an older, slower answer irrelevant.
  const read = useCallback(async (keepTags: boolean): Promise<boolean> => {
    const mine = ++latest.current;
    try {
      const tags = await api.listTags();
      if (mine === latest.current) setState({ tags, status: "ready" });
      return true;
    } catch {
      if (mine === latest.current) setState((now) => (keepTags && now.status === "ready" ? now : { tags: [], status: "error" }));
      return false;
    }
  }, [api]);

  useEffect(() => {
    if (!signedIn) {
      latest.current++;
      setState({ tags: [], status: "loading" });
      return;
    }
    void read(false);
    const counter = latest;
    return () => { counter.current++; };
  }, [signedIn, read]);

  const reload = useCallback((): Promise<boolean> => {
    setState((now) => (now.status === "ready" ? now : { tags: [], status: "loading" }));
    return read(true);
  }, [read]);

  const value = useMemo<TagCatalogState>(() => {
    const resolver = createTagResolver(state.tags);
    const loading = state.status === "loading";
    return {
      tags: state.tags,
      byId: new Map(state.tags.map((tag) => [tag.id, tag])),
      status: state.status,
      nameFor: (id) => (loading ? "…" : resolver.name(id)),
      has: resolver.has,
      reload,
    };
  }, [state, reload]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useTags(): TagCatalogState {
  const value = useContext(Context);
  if (!value) throw new Error("useTags must be used inside TagCatalogProvider");
  return value;
}
