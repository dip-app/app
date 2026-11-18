"use client";

import type { ComponentType } from "react";
import { type Capability, can } from "@/lib/adminTypes";
import { useApp } from "./AppProvider";
import { SuggestionsEmail } from "./SuggestionsEmail";

interface SettingsSection {
  id: string;
  title: string;
  description: string;
  /** Hidden for roles without this capability (the backend still decides). */
  requires?: Capability;
  Body: ComponentType;
}

/** Per-user settings, in page order. Add a section here to extend the page; company-wide settings do not belong in this list. */
export const USER_SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "email", title: "Weekly ideas email", description: "A short email with event ideas for your company, every week.", requires: "ai.generate", Body: SuggestionsEmail },
];

export function UserSettings() {
  const { session } = useApp();
  const sections = USER_SETTINGS_SECTIONS.filter((section) => !section.requires || can(session?.role, section.requires));
  if (sections.length === 0) {
    return <div className="empty"><h2>Nothing to set yet</h2><p>Settings for your account will show up here.</p></div>;
  }
  return (
    <div className="user-settings">
      {sections.map(({ id, title, description, Body }) => (
        <section key={id} className="settings-section" aria-labelledby={`settings-${id}`}>
          <header className="settings-section-head">
            <h2 id={`settings-${id}`}>{title}</h2>
            <p className="muted">{description}</p>
          </header>
          <Body />
        </section>
      ))}
    </div>
  );
}
