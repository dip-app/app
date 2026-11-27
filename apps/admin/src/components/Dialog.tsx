"use client";

// @i18n-migrated

import { useEffect, useId, useRef, useState } from "react";
import { Button, InlineNotice } from "@/components/kit";
import { t } from "@/lib/i18n";
import { motionMs } from "@/lib/motion";
import { userError } from "@/lib/userError";

interface Props {
  title: string;
  children?: React.ReactNode;
  confirmLabel: string;
  /** Asks for a written reason (recorded in the audit log) before the confirm button works. */
  reasonLabel?: string;
  /** Longest note allowed (default 200, the audit-log limit). */
  reasonMax?: number;
  /** Replaces "Saved in the audit log." under the field. */
  reasonHint?: string;
  /** Destructive actions use the error color so they read differently from a normal save. */
  danger?: boolean;
  /** Start with focus on Cancel (default: on for danger dialogs, so a stray Enter must not confirm a final action). */
  focusCancel?: boolean;
  /** Extra condition (e.g. a valid number inside the dialog body) before confirm is enabled. */
  confirmDisabled?: boolean;
  /** Text of the dismiss button (default "Cancel"; "Close" for a dialog that mostly shows information). */
  cancelLabel?: string;
  /** Confirm button text while the request runs (default "Saving…"). */
  busyLabel?: string;
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
}

/**
 * Modal built on the native <dialog>: focus is trapped, Escape closes, and focus returns to the opener. It fades in
 * (CSS); Cancel and Escape play a short exit before `onClose`. While the confirm request runs, the confirm button shows a
 * spinner and both buttons keep focus but ignore presses.
 */
export function Dialog({ title, children, confirmLabel, reasonLabel, reasonMax = 200, reasonHint = t("common.dialog.reasonHint"), danger, focusCancel = !!danger, confirmDisabled, cancelLabel, busyLabel = t("common.saving"), onConfirm, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [closing, setClosing] = useState(false);
  const id = useId();
  const cancel = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement as HTMLElement | null;
    if (dialog && !dialog.open) dialog.showModal();
    if (focusCancel) cancel.current?.focus();
    return () => {
      dialog?.close();
      // Return focus to the control that opened the dialog; if it is gone (the row was removed), land on the page.
      if (opener && opener !== document.body && document.contains(opener)) opener.focus?.();
      else document.getElementById("main")?.focus();
    };
  // Runs once on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cancel and Escape: the exit plays, then the parent unmounts the dialog. A second request while it plays is ignored.
  function requestClose() {
    if (busy || closing) return;
    const exit = motionMs("fast");
    if (exit === 0) { onClose(); return; }
    setClosing(true);
    setTimeout(onClose, exit);
  }

  async function confirm() {
    if (busy || closing) return;
    setBusy(true);
    setError("");
    try {
      await onConfirm(reason.trim());
    } catch (failure) {
      // A confirm dialog is one action, not a set of changes: a rejected request reads "DIP couldn’t do this."
      const shown = userError(failure, { fallback: t("common.genericError") });
      setError(shown.kind === "validation" && shown.generic ? t("failure.rejectedAction") : shown.message);
      setBusy(false);
    }
  }

  const needsReason = reasonLabel !== undefined;
  return (
    <dialog ref={ref} className="dialog" role={danger ? "alertdialog" : undefined} aria-labelledby={`${id}-t`} aria-describedby={`${id}-b`} data-closing={closing ? "true" : undefined} onCancel={(event) => { event.preventDefault(); requestClose(); }}>
      <h2 id={`${id}-t`}>{title}</h2>
      <div className="dialog-body" id={`${id}-b`}>{children}</div>
      {needsReason && (
        <div className="field">
          <label htmlFor={`${id}-r`}>{t("common.dialog.reasonRequired", { label: reasonLabel })}</label>
          <textarea id={`${id}-r`} value={reason} maxLength={reasonMax} rows={3} onChange={(e) => setReason(e.target.value)} aria-describedby={`${id}-h`} />
          <span className="hint" id={`${id}-h`}>{reason.trim().length < 3 ? t("common.dialog.reasonNeeded") : ""}{reasonHint} {t("common.dialog.reasonCount", { count: reason.trim().length, max: reasonMax })}</span>
        </div>
      )}
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      <div className="actions">
        {/* Busy: a spinner, not disabled (disabling the focused button would drop focus out of the modal). */}
        <Button variant={danger ? "danger" : "primary"} loading={busy} aria-label={busy ? busyLabel : undefined} disabled={!busy && (!!confirmDisabled || (needsReason && reason.trim().length < 3))} onClick={() => void confirm()}>
          {confirmLabel}
        </Button>
        <Button ref={cancel} aria-disabled={busy || undefined} onClick={requestClose}>{cancelLabel ?? t("common.cancel")}</Button>
      </div>
    </dialog>
  );
}
