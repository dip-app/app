"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
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
  reload: () => void;
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
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!signedIn) {
      setState({ tags: [], status: "loading" });
      return;
    }
    let cancelled = false;
    api.listTags().then(
      (tags) => !cancelled && setState({ tags, status: "ready" }),
      () => !cancelled && setState({ tags: [], status: "error" }),
    );
    return () => { cancelled = true; };
  }, [api, signedIn, attempt]);

  const reload = useCallback(() => {
    setState({ tags: [], status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

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
