/** Near-duplicate detection of cover photos by their 64-bit difference hash (16 hex characters; same algorithm as scripts/covers/pixabay.ts). */
export const NEAR_DUPLICATE_MAX_DISTANCE = 6;
const HEX64 = /^[0-9a-f]{16}$/i;

/** Number of differing bits between two 16-hex-character hashes; 64 (maximally different) when either is malformed. */
export function hammingHex(a: string, b: string): number {
  if (!HEX64.test(a) || !HEX64.test(b)) return 64;
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
}

/** The first stored hash within NEAR_DUPLICATE_MAX_DISTANCE bits of `dHash`, or null. */
export function findNearDuplicate(dHash: string, stored: ReadonlyArray<{ key: string; dHash: string }>): string | null {
  for (const item of stored) if (hammingHex(dHash, item.dHash) <= NEAR_DUPLICATE_MAX_DISTANCE) return item.key;
  return null;
}
