import { buildPreview, genericPreview, parseEventIdFromPath, renderSharePage, type ShareEvent } from "../domain/sharePage";

/** Port: finds a shareable event by its opaque id only. Returns just the allowlisted fields, or null. */
export interface ShareEventStore {
  findEvent(eventId: string): Promise<ShareEvent | null>;
}

export interface SharePageResult {
  html: string;
  /** Short cache for transient failures so a hiccup is not pinned in the CDN for ten minutes. */
  transientFailure: boolean;
}

const DEFAULT_TIMEOUT_MS = 4000;

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Renders the share page for a request path. Unknown, malformed, cancelled, draft and deleted events all
 * produce the same generic DIP page, so the response never reveals whether an id exists.
 */
export async function getSharePage(store: ShareEventStore, path: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<SharePageResult> {
  const eventId = parseEventIdFromPath(path);
  if (!eventId) return { html: renderSharePage(genericPreview(null)), transientFailure: false };
  try {
    const event = await withTimeout(store.findEvent(eventId), timeoutMs);
    return { html: renderSharePage(buildPreview(eventId, event)), transientFailure: false };
  } catch {
    return { html: renderSharePage(genericPreview(eventId)), transientFailure: true };
  }
}
