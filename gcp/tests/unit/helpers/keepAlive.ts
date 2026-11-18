/**
 * AbortSignal.timeout() uses an unref'd timer, so a fake fetch that only waits for the abort leaves nothing keeping the event
 * loop alive; on a fast, quiet runner node:test then fails with "Promise resolution is still pending but the event loop has
 * already resolved". Hold a ref'd handle until the signal aborts.
 */
export function keepAliveUntilAbort(signal: AbortSignal | null | undefined): void {
  if (!signal || signal.aborted) return;
  const handle = setInterval(() => {}, 1_000);
  signal.addEventListener("abort", () => clearInterval(handle), { once: true });
}
