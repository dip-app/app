"use client";
// @i18n-migrated

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/kit";
import { t } from "@/lib/i18n";
import { GO_KEYS, GO_TIMEOUT_MS, ignoredKey, setGoPending, useShortcutsEnabled } from "@/lib/shortcuts";
import { isTypingTarget } from "@/lib/useSlashFocus";
import { Toggle } from "./Toggle";

export interface ShortcutPage { href: string; label: string }

/**
 * Portal-wide shortcuts, mounted once by Shell: "g" then a letter goes to a page the role can open, "?" or Ctrl/Cmd+/
 * lists every shortcut. Never while typing in a field or while another dialog is open. Single-key shortcuts can be
 * turned off in the list (WCAG 2.1.4); Ctrl/Cmd+/ still opens it.
 */
export function KeyboardShortcuts({ pages }: { pages: ShortcutPage[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [going, setGoing] = useState(false);
  const [enabled, setEnabled] = useShortcutsEnabled();
  const goTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pagesRef = useRef(pages);
  const routerRef = useRef(router);
  routerRef.current = router;
  pagesRef.current = pages;

  useEffect(() => {
    const stopGoing = () => { if (goTimer.current) clearTimeout(goTimer.current); goTimer.current = null; setGoPending(false); setGoing(false); };
    function onKey(event: KeyboardEvent) {
      if (ignoredKey(event) || isTypingTarget(event.target)) return;
      // The phone menu is open: its own keys (Tab, Escape) win, and nothing navigates behind it.
      if (document.querySelector(".app[data-nav-open]")) return;
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key === "/") {
        if (document.querySelector("dialog[open]")) return;
        event.preventDefault(); setOpen(true); return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || !enabled) return;
      if (document.querySelector("dialog[open]")) return;
      if (goTimer.current) {
        // Shift or Caps Lock on their own keep waiting; Tab and Escape cancel and keep their usual job.
        if (event.key === "Shift" || event.key === "CapsLock") return;
        if (event.key === "Tab" || event.key === "Escape") { stopGoing(); return; }
        const letter = event.key.toLowerCase();
        const page = pagesRef.current.find((item) => GO_KEYS[item.href] === letter);
        stopGoing();
        // The letter after "g" is used up even when it goes nowhere, so a page shortcut (the review queue's A) never fires.
        event.preventDefault();
        if (page) routerRef.current.push(page.href);
        return;
      }
      if (event.key === "?") { event.preventDefault(); setOpen(true); return; }
      // Lower-cased so Caps Lock doesn't break it; Shift+G is left alone.
      if (event.key.toLowerCase() === "g" && !event.shiftKey) {
        event.preventDefault();
        setGoPending(true);
        setGoing(true);
        goTimer.current = setTimeout(stopGoing, GO_TIMEOUT_MS);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); stopGoing(); };
  }, [enabled]);

  return (
    <>
      <div className="go-hint" role="status" aria-live="polite">{going ? t("shell.keys.goPending") : ""}</div>
      {open && <ShortcutList pages={pages} enabled={enabled} onEnabled={setEnabled} onClose={() => setOpen(false)} />}
    </>
  );
}

/** `sequence`: pressed one after another ("G then E"); otherwise separate keys listed side by side. */
function Keys({ keys, sequence = false }: { keys: string[]; sequence?: boolean }) {
  return (
    <span className="keys-combo">
      {keys.map((key, index) => (
        <span key={`${key}-${index}`}>{index > 0 && sequence && <span className="keys-then">{t("shell.keys.then")}</span>}<kbd>{key}</kbd></span>
      ))}
    </span>
  );
}

function ShortcutList({ pages, enabled, onEnabled, onClose }: { pages: ShortcutPage[]; enabled: boolean; onEnabled: (on: boolean) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const mod = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement as HTMLElement | null;
    if (dialog && !dialog.open) dialog.showModal?.();
    // Start at the top of the list (the browser would focus the switch at the bottom and scroll there on phones).
    dialog?.querySelector<HTMLElement>("h2")?.focus();
    return () => {
      dialog?.close?.();
      if (opener && opener !== document.body && document.contains(opener)) opener.focus?.();
      else document.getElementById("main")?.focus();
    };
  }, []);
  const rows: { keys: string[]; label: string }[] = [
    { keys: [`${mod} /`], label: t("shell.keys.helpAlways") },
    { keys: ["?"], label: t("shell.keys.help") },
    { keys: ["/"], label: t("shell.keys.search") },
    { keys: ["Esc"], label: t("shell.keys.escape") },
    { keys: ["J", "K", "A", "R"], label: t("shell.keys.review") },
  ];
  return (
    <dialog ref={ref} className="dialog keys-dialog" aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`} onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <h2 id={`${id}-t`} tabIndex={-1}>{t("shell.keys.title")}</h2>
      <p className="muted" id={`${id}-d`}>{t("shell.keys.intro")}</p>
      <Toggle checked={enabled} onChange={onEnabled} label={t("shell.keys.toggle")} hint={t("shell.keys.toggleHint")} />
      <h3>{t("shell.keys.section.anywhere")}</h3>
      <dl className="keys-list">
        {rows.map((row) => (
          <div key={row.label}><dt><Keys keys={row.keys} /></dt><dd>{row.label}</dd></div>
        ))}
      </dl>
      <h3>{t("shell.keys.section.pages")}</h3>
      <dl className="keys-list">
        {pages.filter((page) => GO_KEYS[page.href]).map((page) => (
          <div key={page.href}><dt><Keys sequence keys={["G", GO_KEYS[page.href].toUpperCase()]} /></dt><dd>{t("shell.keys.goTo", { page: page.label })}</dd></div>
        ))}
      </dl>
      <div className="actions"><Button variant="primary" onClick={onClose}>{t("shell.keys.close")}</Button></div>
    </dialog>
  );
}
