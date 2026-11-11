import type { CSSProperties } from "react";

/**
 * Login hero: the app's own avatar characters (exported from the iOS asset catalog and Figma, see
 * scripts/export-admin-avatars.py) floating on a flat purple stage with two informational chips.
 * Decorative: hidden from assistive tech. Motion is CSS only and switched off for Reduce Motion.
 */
interface Av {
  name: string;
  x: number; // centre, % of the stage width
  y: number; // centre, % of the stage height
  size: number; // % of the stage width
  amp: number; // float amplitude in px
}

// Different characters and colours, one big and a few small, so the cluster reads as a lively group.
const AVATARS: Av[] = [
  { name: "orange", x: 48, y: 50, size: 28, amp: 10 },
  { name: "purple", x: 20, y: 31, size: 20, amp: 8 },
  { name: "pink", x: 74, y: 26, size: 15, amp: 12 },
  { name: "red", x: 90, y: 38, size: 12, amp: 7 },
  { name: "blue", x: 80, y: 62, size: 20, amp: 9 },
  { name: "lime", x: 18, y: 70, size: 20, amp: 11 },
  { name: "green", x: 56, y: 79, size: 20, amp: 8 },
  { name: "teal", x: 34, y: 84, size: 13, amp: 10 },
];

export function LoginArt() {
  return (
    <div className="login-stage" aria-hidden>
      <span className="shape disc-white" />
      {AVATARS.map((a, i) => (
        <span
          key={a.name}
          className={`av av-${a.name}`}
          style={{ left: `${a.x}%`, top: `${a.y}%`, width: `${a.size}%`, "--i": i, "--amp": `${a.amp}px` } as CSSProperties}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/admin/img/avatars/${a.name}.webp`} alt="" width={192} height={192} decoding="async" />
        </span>
      ))}
    </div>
  );
}

const ICONS = {
  events: <><rect x="3.5" y="5" width="17" height="15" rx="3" /><path d="M8 3v4M16 3v4M3.5 10h17" /></>,
  albums: <><rect x="3.5" y="4.5" width="17" height="15" rx="3" /><circle cx="9" cy="10" r="1.6" /><path d="m4.5 17.5 4.5-4.5 3.5 3.5 2.5-2.5 4.5 4" /></>,
  attendees: <><circle cx="9" cy="8.5" r="3.2" /><path d="M3.5 19.5c.4-3.3 2.7-5.2 5.5-5.2s5.1 1.9 5.5 5.2" /><circle cx="17" cy="9.5" r="2.4" /><path d="M16.5 14.6c2.3.1 3.8 1.7 4 4.2" /></>,
  roster: <><rect x="3.5" y="4.5" width="17" height="15" rx="3" /><circle cx="9" cy="11" r="2" /><path d="M5.8 16.2c.5-1.6 1.7-2.3 3.2-2.3s2.7.7 3.2 2.3M14.5 9.5h3.5M14.5 13h3.5" /></>,
  import: <><path d="M12 15V4m0 0-4 4m4-4 4 4" /><path d="M4 14v3.5A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5V14" /></>,
  challenges: <><circle cx="12" cy="12" r="8.5" /><path d="m8.2 12.3 2.6 2.6 5-5.4" /></>,
} as const;

export const VALUE_ROWS: { icon: keyof typeof ICONS; title: string; text: string }[] = [
  { icon: "events", title: "Events", text: "Create, edit and cancel" },
  { icon: "albums", title: "Albums and moderation", text: "Keep photos on brand" },
  { icon: "attendees", title: "Attendees", text: "See who is going" },
  { icon: "roster", title: "Members and roster", text: "Invite and manage people" },
  { icon: "import", title: "Bulk import", text: "Add a whole team at once" },
  { icon: "challenges", title: "Challenge review", text: "Approve submissions" },
];

export function ValueIcon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ICONS[name]}
    </svg>
  );
}

/** Google "G" for the sign-in button (the four-colour mark on a white disc). */
export function GoogleG() {
  return (
    <svg viewBox="0 0 48 48" width="28" height="28" aria-hidden className="g-mark">
      <circle cx="24" cy="24" r="24" fill="#fff" />
      <g transform="translate(10 10) scale(.58)">
        <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z" />
        <path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z" />
        <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.9 2.3-8.5 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
      </g>
    </svg>
  );
}
