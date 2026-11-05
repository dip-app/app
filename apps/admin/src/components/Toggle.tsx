"use client";

/** Switch for yes/no settings (role="switch"); replaces a native checkbox with the portal's pill style. */
export function Toggle({ checked, onChange, label, hint }: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="toggle" onClick={() => onChange(!checked)}>
      <span className="text">
        <span className="label">{label}</span>
        {hint && <span className="hint">{hint}</span>}
      </span>
      <span className="state" aria-hidden>{checked ? "On" : "Off"}</span>
      <span className="track" aria-hidden><span className="knob" /></span>
    </button>
  );
}
