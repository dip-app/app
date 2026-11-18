// @i18n-migrated
import type { CSSProperties } from "react";

/**
 * The Dipbot action mark: a soft cloud (the cloud of our theme art) with two small four-point sparkles. It replaces the
 * stock AI sparkle on every Dipbot action and label. One colour (currentColor), crisp at 14 to 24 px, and safe on light
 * and dark backgrounds. The mascot avatar stays Dipbot's identity; this mark is the action icon.
 */
export function DipbotMark({ size = 16, strong = false, className, style }: { size?: 14 | 16 | 20 | 24; strong?: boolean; className?: string; style?: CSSProperties }) {
  return (
    <svg className={`dipbot-mark${className ? ` ${className}` : ""}`} style={style} viewBox="0 0 24 24" width={size} height={size} aria-hidden focusable="false">
      <path
        d="M7 19.5a4.5 4.5 0 0 1-.9-8.9A6 6 0 0 1 17.4 11.4 4.1 4.1 0 0 1 17 19.5z"
        fill={strong ? "currentColor" : "none"} fillOpacity={strong ? 0.16 : 0} stroke="currentColor" strokeWidth={size <= 16 ? 2.4 : 1.8} strokeLinecap="round" strokeLinejoin="round"
      />
      <path d="M19.4 .6l1.2 3.2 3.2 1.2-3.2 1.2-1.2 3.2-1.2-3.2-3.2-1.2 3.2-1.2z" fill="currentColor" />
      {size > 16 && <path d="M4.4 2.6l.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8z" fill="currentColor" />}
    </svg>
  );
}
