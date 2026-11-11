"use client";

import { useEffect, useId, useRef, useState } from "react";

interface Props {
  title: string;
  children?: React.ReactNode;
  confirmLabel: string;
  /** Asks for a written reason (recorded in the audit log) before the confirm button works. */
  reasonLabel?: string;
  /** Destructive actions use the error color so they read differently from a normal save. */
  danger?: boolean;
  /** Extra condition (e.g. a valid number inside the dialog body) before confirm is enabled. */
  confirmDisabled?: boolean;
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
}

/** Modal built on the native <dialog>: focus is trapped, Escape closes, and focus returns to the opener. */
export function Dialog({ title, children, confirmLabel, reasonLabel, danger, confirmDisabled, onConfirm, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const id = useId();

  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement as HTMLElement | null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      dialog?.close();
      opener?.focus?.(); // return focus to the control that opened the dialog
    };
  }, []);

  async function confirm() {
    setBusy(true);
    setError("");
    try {
      await onConfirm(reason.trim());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That didn’t go through. Try again.");
      setBusy(false);
    }
  }

  const needsReason = reasonLabel !== undefined;
  return (
    <dialog ref={ref} className="dialog" role={danger ? "alertdialog" : undefined} aria-labelledby={`${id}-t`} aria-describedby={`${id}-b`} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
      <h2 id={`${id}-t`}>{title}</h2>
      <div className="dialog-body" id={`${id}-b`}>{children}</div>
      {needsReason && (
        <div className="field">
          <label htmlFor={`${id}-r`}>{reasonLabel} (required)</label>
          <textarea id={`${id}-r`} value={reason} maxLength={200} rows={3} onChange={(e) => setReason(e.target.value)} aria-describedby={`${id}-h`} />
          <span className="hint" id={`${id}-h`}>{reason.trim().length < 3 ? "Add a reason to continue. " : ""}Saved in the audit log. {reason.trim().length}/200</span>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions">
        <button className={`pill-btn ${danger ? "danger" : "dark"}`} disabled={busy || !!confirmDisabled || (needsReason && reason.trim().length < 3)} onClick={() => void confirm()}>
          {busy ? "Working…" : confirmLabel}
        </button>
        <button className="pill-btn gray" disabled={busy} onClick={onClose}>Cancel</button>
      </div>
    </dialog>
  );
}
