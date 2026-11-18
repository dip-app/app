"use client";

// @i18n-migrated

import { t } from "@/lib/i18n";

/** Switch for yes/no settings (role="switch"); replaces a native checkbox with the portal's pill style. */
export function Toggle({ checked, onChange, label, hint, badge }: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
  /** A small non-interactive tag shown after the label (for example "Dipbot picked this"). */
  badge?: React.ReactNode;
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="toggle" onClick={() => onChange(!checked)}>
      <span className="text">
        <span className="label">{label}{badge}</span>
        {hint && <span className="hint">{hint}</span>}
      </span>
      <span className="state" aria-hidden>{checked ? t("ui.toggle.on") : t("ui.toggle.off")}</span>
      <span className="track" aria-hidden><span className="knob" /></span>
    </button>
  );
}
