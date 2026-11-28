// @i18n-migrated

import type { ReactNode } from "react";

export type StepState = "done" | "current" | "todo";

export interface StepperStep {
  id: string;
  /** The short label in the row ("Budget"). */
  label: ReactNode;
  /** The whole wording, for the tooltip ("Budget and timing"). */
  full?: string;
  state: StepState;
  /** The accessible name of a pressable step ("Step 4: Budget and timing, done"). */
  ariaLabel?: string;
  /** A pressable step that can't be chosen right now. */
  disabled?: boolean;
}

const Check = () => (
  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden focusable="false" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 8.5l3 3 6-7" /></svg>
);

/**
 * Numbered steps of a multi-step flow, one hairline row: a numbered circle and the label per step, the current one
 * underlined. With `onSelect` the steps are buttons (the Dipbot wizard: go back to an answered step); without it they are
 * informational (Import). On phones the labels leave the row (equal numbered cells) and `progress` says where you are in
 * words ("Step 2 of 4: Match columns"); wider screens hide that line because the row already says it. The line is hidden
 * from assistive tech: the list already names every step and marks the current one.
 */
export function Stepper({ label, steps, onSelect, progress, className }: {
  /** The list's accessible name ("Import steps"). */
  label: string;
  steps: StepperStep[];
  onSelect?: (index: number) => void;
  /** One line for phones: "Step 2 of 4: Match columns". */
  progress?: string;
  className?: string;
}) {
  return (
    <div className={`stepper-wrap${className ? ` ${className}` : ""}`}>
      <ol className="stepper" aria-label={label}>
        {steps.map((s, i) => {
          const current = s.state === "current";
          const inner = (
            <>
              <span className="stepper-n" aria-hidden>{s.state === "done" ? <Check /> : i + 1}</span>
              <span className="stepper-label">{s.label}</span>
            </>
          );
          return (
            <li key={s.id}>
              {onSelect ? (
                <button type="button" className="stepper-item" data-state={s.state} aria-current={current ? "step" : undefined}
                  disabled={s.disabled || current} aria-label={s.ariaLabel} title={s.full} onClick={() => onSelect(i)}>{inner}</button>
              ) : (
                <span className="stepper-item" data-state={s.state} aria-current={current ? "step" : undefined} title={s.full}>{inner}</span>
              )}
            </li>
          );
        })}
      </ol>
      {progress && <p className="stepper-progress" aria-hidden="true">{progress}</p>}
    </div>
  );
}
