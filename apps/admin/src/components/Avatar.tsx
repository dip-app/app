/* eslint-disable @next/next/no-img-element -- static export: next/image has no optimizer; Google photos need referrerPolicy and a plain <img> */
"use client";

import { useState } from "react";
import { asset } from "@/lib/asset";

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
 * Only Google image hosts (what the server stores) and same-origin assets render; any other URL falls through to the mascot.
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

interface AvatarProps {
  name: string;
  /** The member's stored photo (Google base URL) and app avatar id; both optional. */
  photoURL?: string;
  avatarId?: string;
  /** Rendered size in px (the list default is 32, the detail header uses 64). */
  size?: number;
}

/**
 * Round person avatar. Decorative: the name always sits next to it, so the image has an empty alt.
 * Fallback chain: Google photo, then the member's mascot art, then initials on a neutral background.
 */
export function Avatar({ name, photoURL, avatarId, size }: AvatarProps) {
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
  return <span className="avatar" aria-hidden style={style}>{initials(name)}</span>;
}
