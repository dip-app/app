/* eslint-disable @next/next/no-img-element -- static export: next/image has no optimizer; Google photos need referrerPolicy and a plain <img> */
"use client";

import { useState } from "react";
import { asset } from "@/lib/asset";
import { CREW_INK, PALETTE_FILL, generatedAvatarFor, type GeneratedAvatar } from "@/lib/generatedAvatar";

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join("");
}

/** Mascot art in public/img/avatars (see scripts/export-admin-avatars.py), in the order `avatar-01`..`avatar-08` index them. */
const MASCOTS = ["pink", "red", "purple", "teal", "green", "orange", "lime", "blue"] as const;

/** The mascot for a stored avatarId: a colour name, or `avatar-NN` (1-based, wrapping). Unknown or empty ids have none. */
export function mascotFor(avatarId: string | undefined): string | null {
  const id = (avatarId ?? "").trim().toLowerCase();
  if (!id) return null;
  if ((MASCOTS as readonly string[]).includes(id)) return id;
  const numbered = /^avatar[-_]?0*([1-9]\d*)$/.exec(id);
  return numbered ? MASCOTS[(Number(numbered[1]) - 1) % MASCOTS.length] : null;
}

/**
 * Google photo URLs are stored size-less; the requested size is a suffix (`=s96-c`: 96 px, cropped square).
 * Only Google image hosts (what the server stores) and same-origin assets render; any other URL falls through to the next stage.
 */
export function photoSrc(photoURL: string | undefined, px = 96): string | null {
  if (!photoURL) return null;
  // Same-origin assets (the mock's local photos) are allowed; any other host is not rendered.
  if (photoURL.startsWith("/") && !photoURL.startsWith("//")) return asset(photoURL);
  let url: URL;
  try { url = new URL(photoURL); } catch { return null; }
  if (url.protocol === "https:" && /(^|\.)(googleusercontent|ggpht)\.com$/i.test(url.hostname)) {
    return /=[swh]\d+[-a-z0-9]*$/i.test(url.pathname) ? photoURL : `${photoURL}=s${px}-c`;
  }
  return null;
}

/**
 * The app's Crew character (a port of DIPCrewFace) in a 100-unit box: a coloured figure with a simple face on a dark disc,
 * the figure 82 wide and pushed down 16. `pill` is a capsule in a square frame, so it draws as a circle, as in the app.
 * The round clip comes from the `.avatar` styles (border-radius with overflow hidden).
 */
export function CrewFace({ avatar, size }: { avatar: GeneratedAvatar; size: number }) {
  const { figure, mood, palette } = avatar;
  const fill = PALETTE_FILL[palette];
  const eyeY = 55.52, mouthY = 70.64, eye = 4.86;
  return (
    <svg className="avatar crew" viewBox="0 0 100 100" width={size} height={size} aria-hidden focusable="false" style={{ width: size, height: size }} data-avatar={`crew-${figure}-${mood}-${palette}`}>
      <circle cx="50" cy="50" r="50" fill={CREW_INK} />
      {figure === "square" ? <rect x="9" y="25" width="82" height="82" rx="20" fill={fill} /> : <circle cx="50" cy="66" r="41" fill={fill} />}
      <g fill="none" stroke={CREW_INK} strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round">
        <path d={`M40.28 ${eyeY - eye / 2}V${eyeY + eye / 2}`} />
        <path d={mood === "wink" ? `M${59.72 - eye / 1.5} ${eyeY}H${59.72 + eye / 1.5}` : `M59.72 ${eyeY - eye / 2}V${eyeY + eye / 2}`} />
        <path d={mood === "calm" ? `M42.44 ${mouthY}H57.56` : `M42.44 ${mouthY}Q50 ${(mouthY + 8.64).toFixed(2)} 57.56 ${mouthY}`} />
      </g>
    </svg>
  );
}

interface AvatarProps {
  name: string;
  /** The member's user id: without a stored photo or avatar it picks the same generated character the app shows. */
  userId?: string;
  /** The member's stored photo (Google base URL) and app avatar id; both optional (real accounts start with both empty). */
  photoURL?: string;
  avatarId?: string;
  /** Rendered size in px (the list default is 32, the detail header uses 64). */
  size?: number;
}

/**
 * Round person avatar, the one component for every person in the portal. Decorative: the name always sits next to it, so
 * the image has an empty alt. Fallback chain: Google photo (a load error falls through), the stored avatar id's mascot art,
 * the character the app generates from the user id, and initials only when the user id is unknown too.
 */
export function Avatar({ name, userId, photoURL, avatarId, size }: AvatarProps) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const [mascotFailed, setMascotFailed] = useState(false);
  const px = size ?? 32;
  const style = size ? { width: size, height: size, fontSize: Math.round(size * 0.36) } : undefined;
  const photo = photoFailed ? null : photoSrc(photoURL, px >= 48 ? 192 : 96);
  const mascot = mascotFailed ? null : mascotFor(avatarId);
  if (photo) {
    return <img className="avatar photo" src={photo} alt="" width={px} height={px} loading="lazy" decoding="async" referrerPolicy="no-referrer" style={style} onError={() => setPhotoFailed(true)} />;
  }
  if (mascot) {
    return <img className="avatar mascot" src={asset(`/img/avatars/${mascot}.webp`)} alt="" width={px} height={px} loading="lazy" decoding="async" style={style} onError={() => setMascotFailed(true)} />;
  }
  if (userId) return <CrewFace avatar={generatedAvatarFor(userId)} size={px} />;
  return <span className="avatar" aria-hidden style={style}>{initials(name)}</span>;
}
