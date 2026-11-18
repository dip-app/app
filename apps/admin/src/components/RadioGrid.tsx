"use client";

// @i18n-migrated

import { useRef } from "react";

export interface RadioOption { value: string; label: string; content: React.ReactNode; /** DOM id (used to focus the first invalid control). */ id?: string }

/**
 * Picture picker (cover images, themes) as one radio group: a single tab stop, arrow keys move and select,
 * Home/End jump. Reuses the `.covers` / `.cover-option` look.
 */
export function RadioGrid({ label, options, value, onChange, optionClassName = "", describedBy, invalid }: {
  label: string;
  options: readonly RadioOption[];
  value: string;
  onChange: (value: string) => void;
  optionClassName?: string;
  describedBy?: string;
  invalid?: boolean;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const checked = options.some((option) => option.value === value) ? value : undefined;
  const stop = checked ?? options[0]?.value;

  function onKeyDown(event: React.KeyboardEvent) {
    const at = options.findIndex((option) => option.value === (checked ?? stop));
    let next = -1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (at + 1) % options.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (at - 1 + options.length) % options.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = options.length - 1;
    if (next < 0) return;
    event.preventDefault();
    const to = options[next].value;
    onChange(to);
    refs.current[to]?.focus();
  }

  return (
    <div className="covers" role="radiogroup" aria-label={label} aria-describedby={describedBy} aria-invalid={invalid || undefined} onKeyDown={onKeyDown}>
      {options.map((option) => (
        <button
          key={option.value}
          ref={(node) => { refs.current[option.value] = node; }}
          id={option.id}
          type="button"
          role="radio"
          className={`cover-option ${optionClassName}`.trim()}
          aria-checked={option.value === checked}
          tabIndex={option.value === stop ? 0 : -1}
          onClick={() => onChange(option.value)}
        >
          {option.content}
        </button>
      ))}
    </div>
  );
}
