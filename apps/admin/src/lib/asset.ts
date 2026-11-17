/** The portal is served under /admin; static files in public/ must carry that prefix. */
export const BASE_PATH = "/admin";

/** Prefixes a root-absolute public path (`/img/...`) with the base path. Already-prefixed and relative paths pass through. */
export function asset(path: string): string {
  return path.startsWith(`${BASE_PATH}/`) || !path.startsWith("/") ? path : `${BASE_PATH}${path}`;
}
