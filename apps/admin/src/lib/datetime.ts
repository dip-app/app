/** `datetime-local` values are local wall-clock time; the contract stores RFC 3339 UTC. */
export function localInputToIso(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export function isoToLocalInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Dollars typed by a person to integer cents; NaN when the text is not a valid amount. */
export function dollarsToCents(text: string): number {
  const trimmed = text.trim();
  if (trimmed === "") return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return Number.NaN;
  return Math.round(Number(trimmed) * 100);
}

export function centsToDollars(cents: number): string {
  return cents === 0 ? "" : (cents / 100).toFixed(2);
}
