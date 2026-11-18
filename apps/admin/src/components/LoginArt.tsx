// @i18n-migrated
import type { CSSProperties } from "react";
import type { MessageKey } from "@/lib/i18n";

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
          <img src={`/admin/img/avatars/${a.name}.webp`} alt="" width={192} height={192} decoding="async" draggable={false} />
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

/** The value list on the sign-in page; titles and texts are catalog keys (login.value.<icon>.title / .text). */
export const VALUE_ROWS: { icon: keyof typeof ICONS; title: MessageKey; text: MessageKey }[] = [
  { icon: "events", title: "login.value.events.title", text: "login.value.events.text" },
  { icon: "albums", title: "login.value.albums.title", text: "login.value.albums.text" },
  { icon: "attendees", title: "login.value.attendees.title", text: "login.value.attendees.text" },
  { icon: "roster", title: "login.value.roster.title", text: "login.value.roster.text" },
  { icon: "import", title: "login.value.import.title", text: "login.value.import.text" },
  { icon: "challenges", title: "login.value.challenges.title", text: "login.value.challenges.text" },
];

export function ValueIcon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ICONS[name]}
    </svg>
  );
}

/** Google "G" for the sign-in button (the four-colour mark on a white disc). */
