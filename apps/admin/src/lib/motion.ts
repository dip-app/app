// The motion tokens for code (`src/styles/_motion.scss` holds the same numbers as CSS custom properties). Use these when
// something must wait for a motion to end, such as removing a toast after its exit; never wait for transitionend alone,
// because reduced motion and hidden tabs can skip it.

export const MOTION = {
  /** Hover, color, focus and exits. */
  fast: 140,
  /** Enters, small moves, dialogs. */
  base: 200,
  /** Drawers and large moves. */
  slow: 240,
} as const;

export type MotionToken = keyof typeof MOTION;

/** True when the person asked the system for less motion (always false outside a browser). */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** How long a motion of this token lasts right now: its duration, or 0 under reduced motion. */
export function motionMs(token: MotionToken): number {
  return prefersReducedMotion() ? 0 : MOTION[token];
}
